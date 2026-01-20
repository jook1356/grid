/**
 * 코어 모듈
 *
 * 프레임워크에 의존하지 않는 핵심 로직들입니다.
 * React, Vue, Angular 어디서든 사용할 수 있습니다.
 */

// 메인 클래스
export { GridCore } from './GridCore';
export type { GridCoreOptions, ViewRange } from './GridCore';

// 뷰 관리 (피봇/일반 통합)
export { ViewDataManager } from './ViewDataManager';
export type { ViewDataManagerEventMap } from './ViewDataManager';
export {
  createNormalViewConfig,
  createPivotViewConfig,
  isPivotMode,
} from './ViewConfig';
export type {
  ViewMode,
  ViewConfig,
  ValueField,
  AggregateFunction,
  PivotConfig,
  PivotResult,
  ColumnGroup,
} from './ViewConfig';

// 내부 모듈 (고급 사용자용)
export { EventEmitter } from './EventEmitter';
export { DataStore } from './DataStore';
export type { DataStoreOptions } from './DataStore';
export { IndexManager } from './IndexManager';
