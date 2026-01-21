/**
 * 이벤트 타입 정의
 *
 * Grid에서 발생하는 이벤트들을 정의합니다.
 * React/Vue 같은 프레임워크에서 이 이벤트를 구독해서 UI를 업데이트합니다.
 *
 * @example
 * // React에서 사용
 * useEffect(() => {
 *   const unsubscribe = grid.on('indices:updated', (event) => {
 *     setRows(grid.getRowsInRange(0, 50));
 *   });
 *   return unsubscribe;
 * }, []);
 */

import type { Row, RowChange } from './data.types';
import type { ViewState } from './state.types';

// ============================================================================
// 이벤트 타입 목록
// ============================================================================

/**
 * Grid에서 발생할 수 있는 모든 이벤트 타입
 *
 * 이벤트 이름은 "카테고리:동작" 형식입니다.
 * - data: 원본 데이터 관련
 * - view: 보기 상태 관련 (정렬, 필터 등)
 * - indices: 인덱스 배열 관련
 * - processing: 처리 상태 관련
 * - selection: 선택 관련
 * - error: 에러
 */
export type GridEventType =
  // 데이터 이벤트
  | 'data:loaded'      // 데이터 로드 완료
  | 'data:updated'     // 데이터 변경됨 (여러 행)
  | 'data:rowAdded'    // 행 추가됨
  | 'data:rowUpdated'  // 행 수정됨
  | 'data:rowRemoved'  // 행 삭제됨

  // 뷰 상태 이벤트
  | 'view:changed'     // 정렬/필터/그룹 상태 변경됨

  // 인덱스 이벤트
  | 'indices:updated'  // 보이는 행 인덱스 변경됨 (정렬/필터 결과)

  // 처리 상태 이벤트
  | 'processing:start' // 데이터 처리 시작 (Worker 작업 시작)
  | 'processing:end'   // 데이터 처리 완료 (Worker 작업 완료)
  | 'processing:progress' // 데이터 처리 진행률

  // 선택 이벤트
  | 'selection:changed' // 선택 영역 변경됨

  // 에러 이벤트
  | 'error';           // 에러 발생

// ============================================================================
// 이벤트 페이로드 타입
// ============================================================================

/**
 * 각 이벤트 타입별 페이로드(데이터) 타입
 *
 * TypeScript의 "조건부 타입"을 사용합니다.
 * 이벤트 타입에 따라 페이로드 타입이 자동으로 결정됩니다.
 */
export interface GridEventPayloads {
  // 데이터 이벤트 페이로드
  'data:loaded': {
    rowCount: number;
    columnCount: number;
  };

  'data:updated': {
    changes: RowChange[];
  };

  'data:rowAdded': {
    row: Row;
    index: number;
  };

  'data:rowUpdated': {
    index: number;
    oldRow: Row;
    newRow: Row;
    changedKeys: string[];
  };

  'data:rowRemoved': {
    row: Row;
    index: number;
  };

  // 뷰 상태 이벤트 페이로드
  'view:changed': {
    viewState: ViewState;
    changedProperty: 'sorts' | 'filters' | 'groups';
  };

  // 인덱스 이벤트 페이로드
  'indices:updated': {
    totalCount: number;      // 전체 행 수
    visibleCount: number;    // 필터링 후 보이는 행 수
    processingTime?: number; // 처리 시간 (ms)
  };

  // 처리 상태 이벤트 페이로드
  'processing:start': {
    operation: string;  // 'sort', 'filter', 'query' 등
  };

  'processing:end': {
    operation: string;
    duration: number;   // 소요 시간 (ms)
    success: boolean;
  };

  'processing:progress': {
    operation: string;
    progress: number;   // 0 ~ 100
  };

  // 선택 이벤트 페이로드
  'selection:changed': {
    selectedRowCount: number;
    selectedCellCount: number;
  };

  // 에러 이벤트 페이로드
  'error': {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// 이벤트 객체
// ============================================================================

/**
 * 이벤트 객체
 *
 * 이벤트 핸들러가 받는 객체입니다.
 * type, payload, timestamp를 포함합니다.
 *
 * @template T - 이벤트 타입
 */
export interface GridEvent<T extends GridEventType> {
  /** 이벤트 타입 */
  type: T;

  /** 이벤트 데이터 */
  payload: GridEventPayloads[T];

  /** 이벤트 발생 시각 (Unix timestamp) */
  timestamp: number;
}

// ============================================================================
// 이벤트 핸들러
// ============================================================================

/**
 * 이벤트 핸들러 함수 타입
 *
 * @template T - 이벤트 타입
 *
 * @example
 * const handler: GridEventHandler<'data:loaded'> = (event) => {
 *   console.log(`${event.payload.rowCount}행 로드됨`);
 * };
 */
export type GridEventHandler<T extends GridEventType> = (
  event: GridEvent<T>
) => void;

/**
 * 모든 이벤트를 받을 수 있는 핸들러
 *
 * 디버깅이나 로깅 용도로 사용합니다.
 */
export type GridEventHandlerAny = (event: GridEvent<GridEventType>) => void;

// ============================================================================
// 이벤트 구독 해제 함수
// ============================================================================

/**
 * 구독 해제 함수
 *
 * on() 메서드가 반환하는 함수입니다.
 * 호출하면 이벤트 구독이 해제됩니다.
 *
 * @example
 * const unsubscribe = grid.on('data:loaded', handler);
 * // 나중에...
 * unsubscribe(); // 구독 해제
 */
export type Unsubscribe = () => void;
