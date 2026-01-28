/**
 * processorWorker.ts - Web Worker 스크립트
 *
 * Web Worker에서 실행되는 데이터 처리 스크립트입니다.
 * 메시지를 받아 엔진을 통해 처리하고 결과를 반환합니다.
 *
 * 지원 엔진:
 * - 'aq': Arquero (기본값)
 * - 'db': DuckDB-Wasm
 *
 * 메시지 프로토콜:
 * - 요청: { id: string, type: string, payload: any }
 * - 응답: { id: string, type: 'SUCCESS' | 'ERROR', result?: any, error?: string }
 */

import type { IEngine, EngineType } from './engines/IEngine';
import { ArqueroEngine } from './engines/ArqueroEngine';
import type { Row } from '../types/data.types';
import type { SortState, FilterState } from '../types/state.types';
import type { AggregateQueryOptions } from '../types/processor.types';
import type { PivotConfig, PivotRow } from '../types/pivot.types';
import type { ApiConfig } from '../types/field.types';

// ==========================================================================
// 메시지 타입 정의
// ==========================================================================

/** Worker 요청 메시지 타입 */
type WorkerRequestType =
  | 'INIT'
  | 'LOAD_DATA'
  | 'FILTER'
  | 'SORT'
  | 'QUERY'
  | 'AGGREGATE'
  | 'PIVOT'
  | 'GET_ROWS'
  | 'GET_ALL_ROWS'
  | 'GET_UNIQUE_VALUES'
  | 'FETCH_VISIBLE_ROWS'
  | 'FETCH_DATA'
  | 'CLEANUP';

/** Worker 요청 메시지 */
interface WorkerRequest {
  id: string;
  type: WorkerRequestType;
  payload?: any;
}

/** Worker 응답 메시지 */
interface WorkerResponse {
  id: string;
  type: 'SUCCESS' | 'ERROR';
  result?: any;
  error?: string;
  sentTime?: number;
}

// ==========================================================================
// Worker 상태
// ==========================================================================

/** 현재 엔진 인스턴스 */
let engine: IEngine | null = null;

/** 현재 엔진 타입 */
let currentEngineType: EngineType = 'aq';

/** 현재 필터/정렬된 인덱스 배열 (fetchVisibleRows에서 사용) */
let currentIndices: Uint32Array | null = null;

/** 현재 피벗 데이터 (Worker에만 존재) */
let pivotData: PivotRow[] | null = null;

/** 피벗 세대 카운터 (동시 요청 구분용) */
let pivotGeneration: number = 0;

// ==========================================================================
// 엔진 생성
// ==========================================================================

/**
 * 엔진 생성 (동적 임포트로 Tree-shaking 지원)
 */
async function createEngine(_engineType: EngineType): Promise<IEngine> {
  // [DEPRECATED] DuckDB 엔진 비활성화 - Arquero가 더 빠름
  // if (engineType === 'db') {
  //   const { DuckDBEngine } = await import('./engines/DuckDBEngine');
  //   return new DuckDBEngine();
  // }
  return new ArqueroEngine();
}

// ==========================================================================
// 메시지 핸들러
// ==========================================================================

/**
 * 메시지 수신 핸들러
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    let result: any;

    switch (type) {
      // 초기화
      case 'INIT':
        currentEngineType = payload.engineType || 'aq';
        engine = await createEngine(currentEngineType);
        result = { success: true, engineType: currentEngineType };
        break;

      // 데이터 로드
      case 'LOAD_DATA':
        if (!engine) {
          engine = await createEngine(currentEngineType);
        }
        await engine.loadData(payload.data as Row[]);
        pivotData = null; // 피벗 상태 초기화
        // 초기 인덱스 배열 생성 (전체 행)
        currentIndices = new Uint32Array(
          Array.from({ length: engine.getRowCount() }, (_, i) => i)
        );
        result = {
          success: true,
          rowCount: engine.getRowCount(),
          columnKeys: engine.getColumnKeys(),
        };
        break;

      // 필터
      case 'FILTER':
        ensureEngine();
        pivotData = null; // 피벗 상태 초기화
        result = await engine!.filter(payload.filters as FilterState[]);
        // 현재 인덱스 저장 (fetchVisibleRows에서 사용)
        // 복사본을 저장해야 함 — Transferable 전송 시 원본 buffer가 detach됨
        currentIndices = new Uint32Array(result.indices);
        result = {
          indices: result.indices,
          totalCount: result.totalCount,
          filteredCount: result.filteredCount,
        };
        break;

      // 정렬
      case 'SORT':
        ensureEngine();
        pivotData = null; // 피벗 상태 초기화
        result = await engine!.sort(payload.sorts as SortState[]);
        // 복사본 저장 (Transferable detach 방지)
        currentIndices = new Uint32Array(result.indices);
        result = {
          indices: result.indices,
          totalCount: result.totalCount,
          filteredCount: result.filteredCount,
        };
        break;

      // 복합 쿼리
      case 'QUERY':
        ensureEngine();
        pivotData = null; // 피벗 상태 초기화
        result = await engine!.query({
          filters: payload.filters as FilterState[],
          sorts: payload.sorts as SortState[],
        });
        // 복사본 저장 (Transferable detach 방지)
        currentIndices = new Uint32Array(result.indices);
        result = {
          indices: result.indices,
          totalCount: result.totalCount,
          filteredCount: result.filteredCount,
        };
        break;

      // 집계
      case 'AGGREGATE':
        ensureEngine();
        result = await engine!.aggregate(payload as AggregateQueryOptions);
        break;

      // 피벗
      case 'PIVOT': {
        ensureEngine();

        // 새 피벗 연산 시작 전에 이전 캐시 즉시 무효화
        pivotData = null;
        const generation = ++pivotGeneration;

        const pivotResult = await engine!.pivot(payload.config as PivotConfig);

        // 연산 중 더 새로운 PIVOT 요청이 들어왔으면 이 결과는 버림
        if (generation !== pivotGeneration) {
          result = { stale: true };
          break;
        }

        // 피벗 데이터 캐싱 (Worker 내부에만 보관)
        pivotData = pivotResult.pivotedData;

        // 메인 스레드로 보낼 결과에서는 대용량 데이터 제거 (Lazy Loading)
        // 대신 행 수 정보와 세대 ID 추가
        result = {
          ...pivotResult,
          pivotedData: [], // 데이터 제거
          pivotRowCount: pivotData.length, // 행 수 전달
          pivotGeneration: generation, // 세대 ID
        };
        break;
      }

      // 특정 행 조회
      case 'GET_ROWS':
        ensureEngine();
        result = await engine!.getRows(payload.indices as number[]);
        break;

      // 전체 행 조회
      case 'GET_ALL_ROWS':
        ensureEngine();
        result = await engine!.getAllRows();
        break;

      // 유니크 값 조회
      case 'GET_UNIQUE_VALUES':
        ensureEngine();
        result = await engine!.getUniqueValues(payload.columnKey as string);
        break;

      // 가시 영역 행 조회 (가상 데이터 로딩용)
      case 'FETCH_VISIBLE_ROWS': {
        ensureEngine();
        const { startIndex, endIndex, pivotGeneration: requestedGeneration } = payload as {
          startIndex: number;
          endIndex: number;
          pivotGeneration?: number;
        };

        // 1. 피벗 모드인 경우
        if (pivotData) {
          // 세대 불일치 시 빈 결과 반환 (stale 요청 방지)
          if (requestedGeneration !== undefined && requestedGeneration !== pivotGeneration) {
            result = [];
            break;
          }

          // 범위 내 피벗 행 추출
          const sliced = pivotData.slice(startIndex, endIndex);

          // 평탄화 (PivotRow -> Row)
          result = sliced.map(pivotRow => ({
            ...pivotRow.rowHeaders,
            ...pivotRow.values,
            __pivotType: pivotRow.type,
          }));
        }
        // 2. 일반 모드인 경우
        else {
          // 현재 인덱스 배열이 없으면 전체 데이터 기준
          const indices = currentIndices ?? new Uint32Array(
            Array.from({ length: engine!.getRowCount() }, (_, i) => i)
          );

          // 범위 내 인덱스 추출
          const rangeIndices: number[] = [];
          for (let i = startIndex; i < Math.min(endIndex, indices.length); i++) {
            rangeIndices.push(indices[i]!);
          }

          // 해당 행들 조회
          result = await engine!.getRows(rangeIndices);
        }
        break;
      }

      // API 데이터 페칭
      case 'FETCH_DATA': {
        const config = payload.config as ApiConfig;

        try {
          const response = await fetch(config.url, {
            method: config.method || 'GET',
            headers: config.headers,
            body: config.method !== 'GET' ? JSON.stringify(config.body) : undefined,
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
          }

          const json = await response.json();

          // 데이터 추출 (dataProperty가 있으면 해당 경로 사용, 없으면 json 자체)
          let data: any[] = json;
          if (config.dataProperty) {
            const properties = config.dataProperty.split('.');
            let current = json;
            for (const prop of properties) {
              if (current && typeof current === 'object' && prop in current) {
                current = current[prop];
              } else {
                throw new Error(`Property '${config.dataProperty}' not found in response`);
              }
            }
            if (!Array.isArray(current)) {
              throw new Error(`Property '${config.dataProperty}' is not an array`);
            }
            data = current;
          } else if (!Array.isArray(data)) {
            throw new Error('API response is not an array');
          }

          if (!engine) {
            engine = await createEngine(currentEngineType);
          }
          await engine.loadData(data as Row[]);
          pivotData = null; // 피벗 상태 초기화

          // 초기 인덱스 배열 생성
          currentIndices = new Uint32Array(
            Array.from({ length: engine.getRowCount() }, (_, i) => i)
          );

          result = {
            success: true,
            rowCount: engine.getRowCount(),
            columnKeys: engine.getColumnKeys(),
          };
        } catch (err) {
          throw new Error(`Data fetch failed: ${(err as Error).message}`);
        }
        break;
      }

      // 정리
      case 'CLEANUP':
        if (engine) {
          await engine.cleanup();
          engine = null;
          pivotData = null;
        }
        result = { success: true };
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // 성공 응답
    const response: WorkerResponse = {
      id,
      type: 'SUCCESS',
      result,
      sentTime: Date.now()
    };

    // Uint32Array가 있으면 Transferable로 전송
    if (result?.indices instanceof Uint32Array) {
      self.postMessage(response, [result.indices.buffer]);
    } else {
      self.postMessage(response);
    }
  } catch (error) {
    // 에러 응답
    const response: WorkerResponse = {
      id,
      type: 'ERROR',
      error: (error as Error).message,
    };
    self.postMessage(response);
  }
};

/**
 * 엔진 초기화 확인
 */
function ensureEngine(): void {
  if (!engine) {
    throw new Error('Engine not initialized. Send INIT or LOAD_DATA message first.');
  }
}

// ==========================================================================
// 에러 핸들러
// ==========================================================================

self.onerror = (event) => {
  console.error('Worker error:', event);
};

self.onmessageerror = (event) => {
  console.error('Worker message error:', event);
};
