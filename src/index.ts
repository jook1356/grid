/**
 * PureSheet - 고성능 Grid 라이브러리
 *
 * Arquero 기반의 데이터 처리와 가상화로 대용량 데이터를 부드럽게 처리합니다.
 * Vanilla TypeScript로 구현되어 React, Vue, Angular 등에서 래핑하여 사용할 수 있습니다.
 */

// 타입 내보내기 (기본 타입)
export * from './types';

// 코어 모듈 내보내기
export * from './core';
export { BatchCommand } from './core'; // BatchCommand 중복 수출 모호성 해결

// 프로세서 모듈 내보내기
export * from './processor';

// UI 모듈 내보내기 (충돌 방지를 위해 명시적으로 export)
// 메인 파사드
export { PureSheet } from './ui/PureSheet';
export type { PureSheetEventType } from './ui/PureSheet';

// 코어 모듈
export { VirtualScroller } from './ui/VirtualScroller';
export { GridRenderer } from './ui/GridRenderer';

// Body 모듈
export { BodyRenderer, RowPool } from './ui/body';

// Header 모듈
export { HeaderRenderer, HeaderCell } from './ui/header';

// Interaction 모듈
export { SelectionManager, EditorManager, ColumnManager } from './ui/interaction';

// Grouping 모듈
export { GroupManager } from './ui/grouping';

// Multi-Row 모듈
export { MultiRowRenderer } from './ui/multirow';

// Pivot 모듈
export { PivotHeaderRenderer } from './ui/pivot';
export type { PivotHeaderRendererOptions } from './ui/pivot';

// Row 모듈
export { Row, Row as RowClass } from './ui/row';
export type {
  RowVariant,
  RowConfig,
  GroupInfo,
  AggregateConfig,
  RowRenderContext,
  VirtualRowInfo,
} from './ui/row';

// Merge 모듈
export {
  MergeManager,
  ContentMergeManager,
  HierarchicalMergeManager,
  CustomMergeManager,
} from './ui/merge';
export type {
  MergedRange,
  CellMergeInfo,
  MergeManagerConfig,
  CustomMergeFunction,
} from './ui/merge';

// Config 유틸리티
export {
  fieldToColumn,
  configToInternalOptions,
  getGridMode,
  getPivotConfig,
} from './ui/utils/configAdapter';
export type { InternalOptions } from './ui/utils/configAdapter';

// UI 타입 (충돌 없는 것만)
export type {
  PinPosition,
  ColumnState,
  CellRange,
  EditorType,
  EditorConfig,
  VirtualScrollerOptions,
  VirtualScrollState,
  ThemeType,
  RowRenderInfo,
  ColumnGroups,
  RowClickPayload,
  CellClickPayload,
  CellChangePayload,
  ColumnResizePayload,
  ScrollPayload,
} from './ui/types';
