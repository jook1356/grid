/**
 * 타입 정의 모듈
 *
 * 모든 모듈에서 공유하는 타입들을 정의합니다.
 * 이 파일에서 모든 타입을 한 번에 import할 수 있습니다.
 *
 * @example
 * import type { Row, ColumnDef, SortState, IDataProcessor } from '@/types';
 */

// 데이터 타입
export type { CellValue, Row, ColumnType, ColumnDef, RowChange } from './data.types';

// 상태 타입
export type {
  SortDirection,
  SortState,
  FilterOperator,
  FilterState,
  GroupState,
  ViewState,
  CellPosition,
  SelectionRange,
  SelectionState,
} from './state.types';

// 이벤트 타입
export type {
  GridEventType,
  GridEventPayloads,
  GridEvent,
  GridEventHandler,
  GridEventHandlerAny,
  Unsubscribe,
} from './event.types';

// 프로세서 타입
export type {
  ProcessorResult,
  AggregateFunction,
  AggregateOption,
  AggregateResult,
  QueryOptions,
  AggregateQueryOptions,
  IDataProcessor,
  WorkerRequestType,
  WorkerResponseType,
  WorkerRequest,
  WorkerResponse,
} from './processor.types';
