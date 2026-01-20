/**
 * DataPipeline - 데이터 변환 파이프라인
 *
 * Transformer들을 순차적으로 실행하여 데이터를 변환합니다.
 * Worker와 메인 스레드 간 하이브리드 실행을 지원합니다.
 *
 * 파이프라인 구조:
 * Raw → FilterTransformer → SortTransformer → (GroupTransformer | PivotTransformer) → MaterializeTransformer
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, ColumnDef } from '../../types';
import type { ViewConfig } from '../../core/ViewConfig';
import {
  type Transformer,
  type TransformContext,
  type PipelineResult,
  type PipelineOptions,
  PipelinePhase,
  createEmptyContext,
} from './Transformer';

// =============================================================================
// DataPipeline 클래스
// =============================================================================

/**
 * 데이터 변환 파이프라인
 *
 * Transformer들을 관리하고 순차적으로 실행합니다.
 */
export class DataPipeline {
  /** 등록된 Transformer 목록 */
  private transformers: Transformer[] = [];

  /** 파이프라인 옵션 */
  private options: PipelineOptions;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(options: PipelineOptions = {}) {
    this.options = {
      debug: false,
      useWorker: true,
      ...options,
    };
  }

  // ==========================================================================
  // Transformer 관리
  // ==========================================================================

  /**
   * Transformer 추가
   *
   * Phase 순서대로 자동 정렬됩니다.
   */
  addTransformer(transformer: Transformer): this {
    this.transformers.push(transformer);
    this.sortTransformers();
    return this;
  }

  /**
   * Transformer 제거
   */
  removeTransformer(name: string): boolean {
    const index = this.transformers.findIndex(t => t.name === name);
    if (index >= 0) {
      this.transformers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 모든 Transformer 제거
   */
  clearTransformers(): void {
    this.transformers = [];
  }

  /**
   * Transformer 가져오기
   */
  getTransformer(name: string): Transformer | undefined {
    return this.transformers.find(t => t.name === name);
  }

  /**
   * 모든 Transformer 반환
   */
  getTransformers(): readonly Transformer[] {
    return this.transformers;
  }

  /**
   * Transformer 정렬 (Phase 순)
   */
  private sortTransformers(): void {
    this.transformers.sort((a, b) => a.phase - b.phase);
  }

  // ==========================================================================
  // 파이프라인 실행
  // ==========================================================================

  /**
   * 파이프라인 실행
   *
   * @param data - 원본 데이터
   * @param columns - 컬럼 정의
   * @returns 파이프라인 결과
   */
  async execute(data: RowData[], columns: ColumnDef[]): Promise<PipelineResult> {
    const startTime = performance.now();
    const phaseTimings = this.options.debug ? new Map<PipelinePhase, number>() : undefined;

    // 초기 컨텍스트 생성
    let ctx = createEmptyContext(data, columns);

    // 각 Transformer 실행
    for (const transformer of this.transformers) {
      const phaseStart = this.options.debug ? performance.now() : 0;

      // 변환 실행
      const result = transformer.transform(ctx);
      ctx = result instanceof Promise ? await result : result;

      // 타이밍 기록
      if (this.options.debug && phaseTimings) {
        const phaseTime = performance.now() - phaseStart;
        const existing = phaseTimings.get(transformer.phase) ?? 0;
        phaseTimings.set(transformer.phase, existing + phaseTime);
      }
    }

    const executionTime = performance.now() - startTime;

    return {
      context: ctx,
      executionTime,
      phaseTimings,
    };
  }

  /**
   * Worker Transformer만 실행
   *
   * 무거운 처리(Filter, Sort, Pivot)를 Worker에서 실행할 때 사용합니다.
   */
  async executeWorkerPhase(ctx: TransformContext): Promise<TransformContext> {
    const workerTransformers = this.transformers.filter(t => t.runInWorker);
    
    for (const transformer of workerTransformers) {
      const result = transformer.transform(ctx);
      ctx = result instanceof Promise ? await result : result;
    }

    return ctx;
  }

  /**
   * 메인 스레드 Transformer만 실행
   *
   * 경량 처리(Materialize)를 메인 스레드에서 실행할 때 사용합니다.
   */
  async executeMainPhase(ctx: TransformContext): Promise<TransformContext> {
    const mainTransformers = this.transformers.filter(t => !t.runInWorker);
    
    for (const transformer of mainTransformers) {
      const result = transformer.transform(ctx);
      ctx = result instanceof Promise ? await result : result;
    }

    return ctx;
  }

  // ==========================================================================
  // 파이프라인 빌더
  // ==========================================================================

  /**
   * ViewConfig에서 파이프라인 구성
   *
   * columnFields가 있으면 피봇 파이프라인, 없으면 일반 파이프라인을 구성합니다.
   *
   * @param config - 뷰 설정
   * @param transformerFactory - Transformer 생성 팩토리
   */
  buildFromConfig(
    config: ViewConfig,
    transformerFactory: TransformerFactory
  ): this {
    this.clearTransformers();

    // Filter → Sort 순서 (효율성: 필터 후 데이터가 줄어들면 정렬 성능 향상)
    if (config.filters.length > 0) {
      const filterTransformer = transformerFactory.createFilterTransformer(config.filters);
      if (filterTransformer) {
        this.addTransformer(filterTransformer);
      }
    }

    if (config.sorts.length > 0) {
      const sortTransformer = transformerFactory.createSortTransformer(config.sorts);
      if (sortTransformer) {
        this.addTransformer(sortTransformer);
      }
    }

    // 피봇 모드 vs 일반 모드
    const isPivotMode = config.columnFields.length > 0;

    if (isPivotMode) {
      // 피봇 Transformer 추가
      const pivotTransformer = transformerFactory.createPivotTransformer({
        rowFields: config.rowFields,
        columnFields: config.columnFields,
        valueFields: config.valueFields,
      });
      if (pivotTransformer) {
        this.addTransformer(pivotTransformer);
      }
    } else {
      // 그룹 Transformer 추가 (그룹화 설정이 있는 경우)
      // 참고: rowFields를 그룹 컬럼으로 사용할 수도 있음
      const groupTransformer = transformerFactory.createGroupTransformer(config.rowFields);
      if (groupTransformer) {
        this.addTransformer(groupTransformer);
      }
    }

    // Materialize Transformer (항상 마지막)
    const materializeTransformer = transformerFactory.createMaterializeTransformer();
    if (materializeTransformer) {
      this.addTransformer(materializeTransformer);
    }

    return this;
  }
}

// =============================================================================
// Transformer 팩토리 인터페이스
// =============================================================================

/**
 * Transformer 생성 팩토리
 *
 * 각 환경(메인/Worker)에서 적절한 Transformer를 생성합니다.
 */
export interface TransformerFactory {
  /** Filter Transformer 생성 */
  createFilterTransformer(filters: ViewConfig['filters']): Transformer | null;
  
  /** Sort Transformer 생성 */
  createSortTransformer(sorts: ViewConfig['sorts']): Transformer | null;
  
  /** Group Transformer 생성 */
  createGroupTransformer(groupColumns: string[]): Transformer | null;
  
  /** Pivot Transformer 생성 */
  createPivotTransformer(config: {
    rowFields: string[];
    columnFields: string[];
    valueFields: ViewConfig['valueFields'];
  }): Transformer | null;
  
  /** Materialize Transformer 생성 */
  createMaterializeTransformer(): Transformer | null;
}
