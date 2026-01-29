/**
 * WorkerProcessor - Web Worker 경유 프로세서
 *
 * IDataProcessor 인터페이스를 구현하며, 선택한 엔진(Arquero/DuckDB)을
 * Web Worker에서 실행합니다.
 *
 * 특징:
 * - UI 블로킹 방지 (메인 스레드 분리)
 * - 대용량 데이터 처리에 적합
 * - Transferable을 사용한 효율적인 데이터 전송
 *
 * 권장 사용 케이스:
 * - 10만 건 이상의 대용량 데이터
 * - 무거운 연산 (피벗, 복잡한 집계)
 * - UI 응답성이 중요한 경우
 */

import type { IDataProcessor, ProcessorResult, QueryOptions, AggregateQueryOptions, AggregateResult } from '../types/processor.types';
import type { Row } from '../types/data.types';
import type { SortState, FilterState } from '../types/state.types';
import type { PivotConfig, PivotResult } from '../types/pivot.types';
import type { ApiConfig } from '../types/field.types';
import type { EngineType } from './engines/IEngine';

// ==========================================================================
// 메시지 타입
// ==========================================================================

/** Worker 요청 메시지 */
interface WorkerRequest {
  id: string;
  type: string;
  payload?: any;
}

/** Worker 응답 메시지 */
interface WorkerResponse {
  id: string;
  type: 'SUCCESS' | 'ERROR';
  result?: any;
  error?: string;
}

/** 대기 중인 요청 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/** 통계 업데이트 콜백 */
export type StatsCallback = (stats: { transferTime: number }) => void;

/** Worker 응답 메시지 (보낼 때와 동일하게 정의) */
interface WorkerResponse {
  id: string;
  type: 'SUCCESS' | 'ERROR';
  result?: any;
  error?: string;
  sentTime?: number;
}

/**
 * Web Worker 경유 프로세서
 */
export class WorkerProcessor implements IDataProcessor {
  /** Web Worker 인스턴스 */
  private worker: Worker | null = null;

  /** 대기 중인 요청들 */
  private pendingRequests: Map<string, PendingRequest> = new Map();

  /** 엔진 타입 */
  private engineType: EngineType;

  /** 초기화 완료 여부 */
  private initialized: boolean = false;

  /** 행 수 (캐시) */
  private rowCount: number = 0;

  /** 필터/정렬 후 보이는 행 수 (캐시) */
  private visibleRowCount: number = 0;

  /** 컬럼 키 목록 (캐시) */
  private columnKeys: string[] = [];

  /** 통계 업데이트 콜백 */
  private onStatsUpdate: StatsCallback | null = null;

  /** 현재 피벗 세대 ID (워커와 동기화) */
  private pivotGeneration: number | null = null;

  /** 최근 전송 시간 기록 (이동 평균용) */
  private transferTimes: number[] = [];
  private readonly MAX_HISTORY = 20;

  constructor(engineType: EngineType = 'aq') {
    this.engineType = engineType;
  }

  // ==========================================================================
  // 초기화 / 정리
  // ==========================================================================

  async initialize(data: Row[]): Promise<void> {
    // Worker 생성
    if (!this.worker) {
      await this.createWorker();
    }

    // 데이터 로드
    const result = await this.sendMessage('LOAD_DATA', { data });
    this.rowCount = result.rowCount;
    this.visibleRowCount = result.rowCount; // 초기에는 전체 행이 보임
    this.columnKeys = result.columnKeys;
    this.initialized = true;
  }

  /**
   * API를 통해 데이터 페칭 및 로드
   */
  async fetchData(config: ApiConfig): Promise<void> {
    // Worker 생성
    if (!this.worker) {
      await this.createWorker();
    }

    const result = await this.sendMessage('FETCH_DATA', { config });
    this.rowCount = result.rowCount;
    this.visibleRowCount = result.rowCount;
    this.columnKeys = result.columnKeys;
    this.initialized = true;
  }

  destroy(): void {
    if (this.worker) {
      // 정리 메시지 전송 (응답 대기 안함)
      this.worker.postMessage({ id: 'cleanup', type: 'CLEANUP' });
      this.worker.terminate();
      this.worker = null;
    }

    // 대기 중인 요청 모두 reject
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();
    this.initialized = false;
    this.rowCount = 0;
    this.visibleRowCount = 0;
    this.columnKeys = [];
    this.pivotGeneration = null;
  }

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.sendMessage('SORT', { sorts });
    this.visibleRowCount = result.filteredCount;
    return {
      indices: new Uint32Array(result.indices),
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
    };
  }

  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.sendMessage('FILTER', { filters });
    this.visibleRowCount = result.filteredCount;
    return {
      indices: new Uint32Array(result.indices),
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
    };
  }

  async query(options: QueryOptions): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.sendMessage('QUERY', options);
    this.visibleRowCount = result.filteredCount;
    return {
      indices: new Uint32Array(result.indices),
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
    };
  }

  // ==========================================================================
  // 집계
  // ==========================================================================

  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    this.ensureInitialized();
    return this.sendMessage('AGGREGATE', options);
  }

  // ==========================================================================
  // 피벗 (확장 기능)
  // ==========================================================================

  /**
   * 피벗 연산
   */
  async pivot(config: PivotConfig): Promise<PivotResult> {
    this.ensureInitialized();
    const result = await this.sendMessage('PIVOT', { config });

    // stale 응답이면 빈 결과 반환 (더 최신 피벗이 진행 중)
    if (result.stale) {
      return {
        columnHeaderTree: { value: '__root__', label: '', level: -1, children: [], colspan: 0, isLeaf: false, path: [] },
        headerLevelCount: 0,
        rowMergeInfo: {},
        rowHeaderColumns: [],
        columns: [],
        pivotedData: [],
        pivotRowCount: 0,
        meta: { totalRows: 0, totalColumns: 0, uniqueValues: {} },
      };
    }

    // 워커에서 받은 세대 ID 저장
    this.pivotGeneration = result.pivotGeneration ?? null;
    return result;
  }

  // ==========================================================================
  // 데이터 조회 (확장 기능)
  // ==========================================================================

  /**
   * 특정 인덱스의 Row들 반환
   */
  async getRows(indices: number[]): Promise<Row[]> {
    this.ensureInitialized();
    return this.sendMessage('GET_ROWS', { indices });
  }

  /**
   * 전체 데이터 Row 배열로 반환
   */
  async getAllRows(): Promise<Row[]> {
    this.ensureInitialized();
    return this.sendMessage('GET_ALL_ROWS', {});
  }

  /**
   * 특정 컬럼의 유니크 값 조회
   */
  async getUniqueValues(columnKey: string): Promise<unknown[]> {
    this.ensureInitialized();
    return this.sendMessage('GET_UNIQUE_VALUES', { columnKey });
  }

  // ==========================================================================
  // 가상 데이터 로딩 (Worker 최적화)
  // ==========================================================================

  /**
   * 가시 영역의 행 데이터를 가져옵니다.
   *
   * Worker에서 현재 필터/정렬 상태의 해당 범위만 요청합니다.
   * 전체 데이터를 전송하지 않고 보이는 행만 전송하여 메모리 효율적입니다.
   *
   * @param startIndex - 시작 인덱스 (필터/정렬 후 순서, inclusive)
   * @param endIndex - 끝 인덱스 (exclusive)
   * @returns 해당 범위의 Row 배열
   */
  async fetchVisibleRows(startIndex: number, endIndex: number): Promise<Row[]> {
    this.ensureInitialized();
    return this.sendMessage('FETCH_VISIBLE_ROWS', {
      startIndex,
      endIndex,
      pivotGeneration: this.pivotGeneration,
    });
  }



  /**
   * 현재 필터/정렬 후 총 행 수 (스크롤바 계산용)
   */
  getVisibleRowCount(): number {
    return this.visibleRowCount;
  }

  // ==========================================================================
  // 메타데이터 (확장 기능)
  // ==========================================================================

  /**
   * 전체 행 수 (필터 적용 전)
   */
  getRowCount(): number {
    return this.rowCount;
  }

  /**
   * 컬럼 키 목록
   */
  getColumnKeys(): string[] {
    return this.columnKeys;
  }

  /**
   * 엔진 타입 반환
   */
  getEngineType(): EngineType {
    return this.engineType;
  }

  /**
   * 통계 콜백 설정
   */
  setStatsCallback(callback: StatsCallback): void {
    this.onStatsUpdate = callback;
  }

  // ==========================================================================
  // 내부 헬퍼
  // ==========================================================================

  /** Worker 생성 */
  private async createWorker(): Promise<void> {
    // Vite/Webpack 호환 Worker 생성
    this.worker = new Worker(new URL('./processorWorker.ts', import.meta.url), {
      type: 'module',
    });

    // 메시지 핸들러 설정
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

    // 엔진 초기화
    await this.sendMessage('INIT', { engineType: this.engineType });
  }

  /** 메시지 수신 핸들러 */
  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const { id, type, result, error, sentTime } = event.data;

    // 전송 시간 측정 및 보고
    if (sentTime) {
      const now = Date.now();
      const transferTime = now - sentTime;

      this.transferTimes.push(transferTime);
      if (this.transferTimes.length > this.MAX_HISTORY) {
        this.transferTimes.shift();
      }

      // 평균 계산
      const list = this.transferTimes;
      const average = list.reduce((a, b) => a + b, 0) / list.length;

      // 콜백 호출
      if (this.onStatsUpdate) {
        this.onStatsUpdate({ transferTime: average });
      }
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) {
      console.warn(`Unknown message id: ${id}`);
      return;
    }

    this.pendingRequests.delete(id);

    if (type === 'ERROR') {
      pending.reject(new Error(error || 'Unknown worker error'));
    } else {
      pending.resolve(result);
    }
  }

  /** 에러 핸들러 */
  private handleError(event: ErrorEvent): void {
    console.error('Worker error:', event.message);

    // 모든 대기 중인 요청 reject
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error(`Worker error: ${event.message}`));
      this.pendingRequests.delete(id);
    }
  }

  /** 메시지 전송 */
  private sendMessage(type: string, payload: any): Promise<any> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not created'));
    }

    const id = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request: WorkerRequest = { id, type, payload };

      // 대용량 데이터는 Transferable로 전송
      if (payload?.data && Array.isArray(payload.data)) {
        // Row[] 데이터는 일반 전송 (구조화된 클론)
        this.worker!.postMessage(request);
      } else if (payload?.indices instanceof Uint32Array) {
        // Uint32Array는 Transferable로 전송
        this.worker!.postMessage(request, [payload.indices.buffer]);
      } else {
        this.worker!.postMessage(request);
      }
    });
  }

  /** 초기화 확인 */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WorkerProcessor not initialized. Call initialize() first.');
    }
  }
}
