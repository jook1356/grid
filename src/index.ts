/**
 * PureSheet - 고성능 Grid 라이브러리
 *
 * Web Worker 기반의 데이터 처리로 100만 건 이상의 데이터도 부드럽게 처리합니다.
 * Vanilla TypeScript로 구현되어 React, Vue, Angular 등에서 래핑하여 사용할 수 있습니다.
 */

// 타입 내보내기 (기본 타입)
export * from './types';

// 코어 모듈 내보내기 (충돌 방지를 위해 선택적 내보내기)
export {
  GridCore,
  EventEmitter,
  DataStore,
  IndexManager,
  ViewDataManager,
  createNormalViewConfig,
  createPivotViewConfig,
  isPivotMode,
} from './core';
export type {
  GridCoreOptions,
  ViewRange,
  DataStoreOptions,
  ViewDataManagerEventMap,
  ViewMode,
  ViewConfig,
  ValueField,
  PivotConfig,
  PivotResult,
  ColumnGroup,
  AggregateFunction as ViewAggregateFunction,
} from './core';

// 프로세서 모듈 내보내기 (충돌 방지를 위해 선택적 내보내기)
export {
  WorkerBridge,
  ArqueroProcessor,
  DataPipeline,
  FilterTransformer,
  SortTransformer,
  GroupTransformer,
  PipelinePhase,
  createEmptyContext,
  cloneContext,
  extractPipelineConfig,
} from './processor';
export type {
  TransformerFactory,
  Transformer,
  TransformContext,
  TransformerConfig,
  FilterTransformerConfig,
  SortTransformerConfig,
  GroupTransformerConfig,
  PivotTransformerConfig,
  GroupTransformInfo,
  GroupNode as PipelineGroupNode,
  PivotTransformResult,
  AggregateField,
  ValueFieldConfig,
  PipelineResult,
  PipelineOptions,
} from './processor';

// UI 모듈 내보내기 (충돌 방지를 위해 선택적 내보내기)
export {
  PureSheet,
  VirtualScroller,
  GridRenderer,
  BodyRenderer,
  RowPool,
  HeaderRenderer,
  HeaderCell,
  SelectionManager,
  EditorManager,
  ColumnManager,
  GroupManager,
  MultiRowRenderer,
  Row,
  RowRenderer,
} from './ui';
export type {
  PureSheetEventType,
  ColumnState,
  ColumnGroups,
  RowVariant,
  RowConfig,
  GroupInfo,
  AggregateConfig,
  AggregateFunc,
  RowRenderContext,
  VirtualRowInfo,
} from './ui';
