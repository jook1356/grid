/**
 * Web Worker 엔트리포인트
 *
 * 이 파일은 별도 스레드에서 실행됩니다.
 * 메인 스레드와 postMessage/onmessage로 통신합니다.
 *
 * Web Worker의 특징:
 * 1. 메인 스레드와 별도로 실행 (UI 블로킹 없음)
 * 2. DOM 접근 불가 (window, document 없음)
 * 3. 자체 전역 객체: self
 * 4. postMessage로 데이터 주고받음
 *
 * 통신 흐름:
 * ┌────────────┐  postMessage   ┌────────────┐
 * │ Main Thread │ ───────────→  │   Worker   │
 * │             │               │            │
 * │ WorkerBridge│ ←───────────  │ worker.ts  │
 * └────────────┘  postMessage   └────────────┘
 */

import { ArqueroProcessor } from './ArqueroProcessor';
import type { PivotOptions } from './ArqueroProcessor';
import type {
  WorkerRequest,
  WorkerResponse,
  Row,
  SortState,
  FilterState,
  QueryOptions,
  AggregateQueryOptions,
} from '../types';

// 프로세서 인스턴스 (Worker 전역)
const processor = new ArqueroProcessor();

/**
 * 메시지 핸들러
 *
 * 메인 스레드에서 postMessage로 보낸 메시지를 처리합니다.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    let result: unknown;

    switch (type) {
      // ========================================
      // 초기화
      // ========================================
      case 'INITIALIZE': {
        const data = payload as { data: Row[] };
        await processor.initialize(data.data);
        result = { success: true, rowCount: data.data.length };
        break;
      }

      // ========================================
      // 정렬
      // ========================================
      case 'SORT': {
        const { sorts } = payload as { sorts: SortState[] };
        const processorResult = await processor.sort(sorts);

        // Transferable로 전송 (복사 없이 소유권 이전)
        sendTransferableResult(id, processorResult);
        return; // 여기서 리턴 (아래 send 호출 안 함)
      }

      // ========================================
      // 필터
      // ========================================
      case 'FILTER': {
        const { filters } = payload as { filters: FilterState[] };
        const processorResult = await processor.filter(filters);

        sendTransferableResult(id, processorResult);
        return;
      }

      // ========================================
      // 복합 쿼리
      // ========================================
      case 'QUERY': {
        const queryOptions = payload as QueryOptions;
        const processorResult = await processor.query(queryOptions);

        sendTransferableResult(id, processorResult);
        return;
      }

      // ========================================
      // 집계
      // ========================================
      case 'AGGREGATE': {
        const aggregateOptions = payload as AggregateQueryOptions;
        result = await processor.aggregate(aggregateOptions);
        break;
      }

      // ========================================
      // 피봇
      // ========================================
      case 'PIVOT': {
        const pivotOptions = payload as PivotOptions;
        result = await processor.pivot(pivotOptions);
        break;
      }

      // ========================================
      // 정리
      // ========================================
      case 'DESTROY': {
        processor.destroy();
        result = { success: true };
        break;
      }

      // ========================================
      // 알 수 없는 타입
      // ========================================
      default: {
        throw new Error(`Unknown message type: ${type}`);
      }
    }

    // 일반 결과 전송
    sendResult(id, result);

  } catch (error) {
    // 에러 전송
    sendError(id, error);
  }
};

// =============================================================================
// 응답 전송 헬퍼
// =============================================================================

/**
 * 일반 결과 전송
 */
function sendResult(id: number, payload: unknown): void {
  const response: WorkerResponse = {
    id,
    type: 'RESULT',
    payload,
  };
  self.postMessage(response);
}

/**
 * Transferable 결과 전송
 *
 * Uint32Array의 버퍼를 Transferable로 전송하면
 * 복사 없이 소유권만 이전됩니다 (zero-copy).
 *
 * 주의: 전송 후 Worker에서 해당 버퍼에 접근 불가!
 */
function sendTransferableResult(
  id: number,
  result: { indices: Uint32Array; totalCount: number; filteredCount: number }
): void {
  const response: WorkerResponse = {
    id,
    type: 'RESULT',
    payload: {
      // ArrayBuffer를 전송하고, 받는 쪽에서 Uint32Array로 복원
      indices: result.indices.buffer,
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
    },
  };

  // 두 번째 인자: Transferable 목록
  // 이 버퍼들은 복사 없이 소유권이 이전됨
  self.postMessage(response, [result.indices.buffer]);
}

/**
 * 에러 전송
 */
function sendError(id: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  
  const response: WorkerResponse = {
    id,
    type: 'ERROR',
    error: message,
  };
  self.postMessage(response);
}

// =============================================================================
// Worker 초기화 완료 알림
// =============================================================================

// Worker 스크립트 로드 완료 시 메인 스레드에 알림
self.postMessage({ type: 'READY' });
