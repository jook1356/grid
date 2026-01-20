/**
 * Pipeline 모듈 진입점
 *
 * 데이터 변환 파이프라인 관련 클래스와 타입을 내보냅니다.
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

// 핵심 클래스
export { DataPipeline } from './DataPipeline';
export type { TransformerFactory } from './DataPipeline';
export { CachedPipeline } from './CachedPipeline';

// Transformer 구현
export { FilterTransformer } from './FilterTransformer';
export { SortTransformer } from './SortTransformer';
export { GroupTransformer } from './GroupTransformer';
export { PivotTransformer } from './PivotTransformer';
export type { PivotConfig, PivotResult } from './PivotTransformer';
export { MaterializeTransformer, getMaterializedRows, extractRows } from './MaterializeTransformer';
export type { MaterializeOptions, MaterializedRow } from './MaterializeTransformer';

// 타입 및 인터페이스
export {
  PipelinePhase,
  createEmptyContext,
  cloneContext,
  extractPipelineConfig,
} from './Transformer';

export type {
  Transformer,
  TransformContext,
  TransformerConfig,
  FilterTransformerConfig,
  SortTransformerConfig,
  GroupTransformerConfig,
  PivotTransformerConfig,
  GroupTransformInfo,
  GroupNode,
  PivotTransformResult,
  AggregateField,
  ValueFieldConfig,
  PipelineResult,
  PipelineOptions,
} from './Transformer';
