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

// 그룹화 및 Multi-Row 타입
export type {
  AggregateType,
  CustomAggregateFunction,
  AggregateFn,
  GroupIdentifier,
  GroupHeaderRow,
  DataRow,
  GroupFooterRow,
  SubtotalRow,
  GrandTotalRow,
  VirtualRow,
  GroupingConfig,
  GroupExpandState,
  GroupNode,
  RowLayoutItem,
  RowTemplate,
  MergeStrategy,
  CellMeta,
  MergeRange,
  RowState,
} from './grouping.types';

// 새 Config API 타입
export type {
  DataType,
  AggregateFunc,
  SelectionMode,
  Theme,
  GridMode,
  FieldDef,
  GroupConfig,
  PureSheetConfigBase,
  FlatModeConfig,
  PivotModeConfig,
  PureSheetConfig,
  RowTemplateCell,
  RowTemplate as FieldRowTemplate,
  // formatRow API 타입
  CellInfo,
  DataRowContext,
  GroupHeaderContext,
  SubtotalContext,
  FormatRowInfo,
  FormatRowCallback,
} from './field.types';
export { isFlatMode, isPivotMode } from './field.types';

// 피벗 관련 타입
export type {
  PivotValueField,
  PivotConfig,
  PivotHeaderNode,
  PivotRow,
  RowMergeInfo,
  PivotResult,
} from './pivot.types';
export { createPivotColumnKey, parsePivotColumnKey } from './pivot.types';

// CRUD 관련 타입
export type {
  RowState as CrudRowState,
  CellState,
  AddedRow,
  ModifiedRow,
  DeletedRow,
  ChangedField,
  ChangesSummary,
  CommandType,
  Command,
  BatchCommand,
  ChangeTrackerEvents,
  UndoStackEvents,
} from './crud.types';