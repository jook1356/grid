/**
 * UI Layer 진입점
 *
 * 그리드 UI 컴포넌트들을 export합니다.
 */

// 메인 파사드
export { PureSheet } from './PureSheet';
export type { PureSheetEventType, Unsubscribe } from './PureSheet';

// 타입
export * from './types';

// 코어 모듈
export { VirtualScroller } from './VirtualScroller';
export { GridRenderer } from './GridRenderer';

// Body 모듈
export { BodyRenderer, RowPool } from './body';

// Header 모듈
export { HeaderRenderer, HeaderCell } from './header';
export type { SortState } from './header';

// Interaction 모듈
export { SelectionManager, EditorManager, ColumnManager } from './interaction';

// Grouping 모듈
export { GroupManager } from './grouping';

// Multi-Row 모듈
export { MultiRowRenderer } from './multirow';

// Pivot 모듈
export { PivotHeaderRenderer } from './pivot';
export type { PivotHeaderRendererOptions } from './pivot';

// StatusBar 모듈
export { StatusBar } from './StatusBar';
export type { PerformanceTiming, StatusBarOptions } from './StatusBar';

// Row 모듈
export { Row } from './row';
export type {
  RowVariant,
  RowConfig,
  GroupInfo,
  AggregateConfig,
  AggregateFunc,
  RowRenderContext,
  VirtualRowInfo,
} from './row';

// Merge 모듈 (셀 병합)
export {
  MergeManager,
  ContentMergeManager,
  HierarchicalMergeManager,
  CustomMergeManager,
} from './merge';
export type {
  MergedRange,
  CellMergeInfo,
  MergeManagerConfig,
  CustomMergeFunction,
} from './merge';

// Config 유틸리티
export {
  fieldToColumn,
  configToInternalOptions,
  getGridMode,
  getPivotConfig,
} from './utils/configAdapter';
export type { InternalOptions } from './utils/configAdapter';