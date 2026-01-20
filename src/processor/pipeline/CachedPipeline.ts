/**
 * CachedPipeline - 캐시 기능이 있는 데이터 파이프라인
 *
 * 단계별 캐싱으로 변경된 부분만 재계산합니다.
 *
 * 캐싱 전략:
 * - 필터만 변경: 필터 재실행 → 이후 단계 모두 재실행
 * - 정렬만 변경: 정렬 재실행 → 이후 단계 모두 재실행
 * - 피봇 설정만 변경: 필터/정렬 캐시 사용 → 피봇만 재실행
 *
 * 캐시 무효화 규칙:
 * 1. 원본 데이터 변경 시 전체 캐시 무효화
 * 2. 특정 단계 설정 변경 시 해당 단계 이후 캐시 무효화
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, ColumnDef, FilterState, SortState } from '../../types';
import type { ViewConfig } from '../../core/ViewConfig';
import {
  DataPipeline,
  type TransformerFactory,
} from './DataPipeline';
import type {
  TransformContext,
  PipelineResult,
} from './Transformer';
import { PipelinePhase, createEmptyContext } from './Transformer';

// =============================================================================
// 캐시 키 타입
// =============================================================================

/**
 * 캐시 키 생성을 위한 설정 해시
 */
interface ConfigHash {
  filters: string;
  sorts: string;
  pivot: string;
  group: string;
}

/**
 * 캐시 엔트리
 */
interface CacheEntry {
  /** 캐시된 컨텍스트 */
  context: TransformContext;
  
  /** 캐시 생성 시간 */
  timestamp: number;
  
  /** 설정 해시 (무효화 검사용) */
  configHash: string;
}

// =============================================================================
// CachedPipeline 클래스
// =============================================================================

/**
 * 캐시 기능이 있는 데이터 파이프라인
 */
export class CachedPipeline {
  /** 내부 파이프라인 */
  private pipeline: DataPipeline;

  /** 단계별 캐시 */
  private cache = new Map<PipelinePhase, CacheEntry>();

  /** 현재 설정 해시 */
  private currentHashes: ConfigHash = {
    filters: '',
    sorts: '',
    pivot: '',
    group: '',
  };

  /** 원본 데이터 해시 (변경 감지용) */
  private dataHash: string = '';

  /** 원본 데이터 참조 */
  private data: RowData[] = [];
  
  /** 컬럼 정의 */
  private columns: ColumnDef[] = [];

  /** 캐시 통계 */
  private stats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
  };

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor() {
    this.pipeline = new DataPipeline({ debug: false });
  }

  // ==========================================================================
  // 데이터 설정
  // ==========================================================================

  /**
   * 원본 데이터 설정
   *
   * 데이터가 변경되면 전체 캐시가 무효화됩니다.
   */
  setData(data: RowData[], columns: ColumnDef[]): void {
    const newHash = this.hashData(data);
    
    if (newHash !== this.dataHash) {
      this.invalidateAll();
      this.dataHash = newHash;
    }
    
    this.data = data;
    this.columns = columns;
  }

  // ==========================================================================
  // 파이프라인 실행
  // ==========================================================================

  /**
   * ViewConfig로 파이프라인 실행
   *
   * 변경된 부분만 재계산하고 나머지는 캐시를 사용합니다.
   */
  async execute(
    config: ViewConfig,
    factory: TransformerFactory
  ): Promise<PipelineResult> {
    const startTime = performance.now();

    // 설정 해시 계산
    const newHashes = this.computeConfigHashes(config);

    // 어떤 단계부터 재계산이 필요한지 결정
    const invalidFromPhase = this.determineInvalidationPoint(newHashes);

    // 캐시된 컨텍스트에서 시작하거나 처음부터 시작
    let ctx: TransformContext;
    
    if (invalidFromPhase === null) {
      // 전체 캐시 히트 - 마지막 단계 결과 반환
      this.stats.hits++;
      const lastCache = this.getLatestCache();
      if (lastCache) {
        return {
          context: lastCache.context,
          executionTime: performance.now() - startTime,
        };
      }
    }

    // 시작 컨텍스트 결정
    ctx = this.getStartContext(invalidFromPhase) 
      ?? createEmptyContext(this.data, this.columns);

    // 파이프라인 재구성 및 실행
    this.pipeline.clearTransformers();
    this.pipeline.buildFromConfig(config, factory);

    // 필요한 단계만 실행
    const transformers = this.pipeline.getTransformers();
    
    for (const transformer of transformers) {
      // 이미 캐시된 단계는 건너뛰기
      if (invalidFromPhase !== null && transformer.phase < invalidFromPhase) {
        continue;
      }

      const result = transformer.transform(ctx);
      ctx = result instanceof Promise ? await result : result;

      // 단계별 캐시 저장
      this.cachePhase(transformer.phase, ctx, newHashes);
    }

    // 현재 해시 업데이트
    this.currentHashes = newHashes;
    this.stats.misses++;

    return {
      context: ctx,
      executionTime: performance.now() - startTime,
    };
  }

  // ==========================================================================
  // 캐시 관리
  // ==========================================================================

  /**
   * 특정 단계 캐시 저장
   */
  private cachePhase(
    phase: PipelinePhase,
    context: TransformContext,
    hashes: ConfigHash
  ): void {
    const hashKey = this.getHashKeyForPhase(phase, hashes);
    
    this.cache.set(phase, {
      context: { ...context }, // 얕은 복사
      timestamp: Date.now(),
      configHash: hashKey,
    });
  }

  /**
   * 시작 컨텍스트 가져오기
   *
   * 무효화 지점 이전의 가장 최신 캐시를 반환합니다.
   */
  private getStartContext(invalidFromPhase: PipelinePhase | null): TransformContext | null {
    if (invalidFromPhase === null) {
      return null;
    }

    // 무효화 지점 바로 이전 단계의 캐시 찾기
    const phases = [
      PipelinePhase.PRE_TRANSFORM,
      PipelinePhase.SORT,
      PipelinePhase.TRANSFORM,
      PipelinePhase.POST_TRANSFORM,
      PipelinePhase.MATERIALIZE,
    ];

    for (let i = phases.indexOf(invalidFromPhase) - 1; i >= 0; i--) {
      const cache = this.cache.get(phases[i]!);
      if (cache) {
        return cache.context;
      }
    }

    return null;
  }

  /**
   * 가장 최신 캐시 가져오기
   */
  private getLatestCache(): CacheEntry | null {
    const phases = [
      PipelinePhase.MATERIALIZE,
      PipelinePhase.POST_TRANSFORM,
      PipelinePhase.TRANSFORM,
      PipelinePhase.SORT,
      PipelinePhase.PRE_TRANSFORM,
    ];

    for (const phase of phases) {
      const cache = this.cache.get(phase);
      if (cache) {
        return cache;
      }
    }

    return null;
  }

  /**
   * 전체 캐시 무효화
   */
  invalidateAll(): void {
    this.cache.clear();
    this.stats.invalidations++;
  }

  /**
   * 특정 단계 이후 캐시 무효화
   */
  invalidateFrom(phase: PipelinePhase): void {
    const phases = [
      PipelinePhase.PRE_TRANSFORM,
      PipelinePhase.SORT,
      PipelinePhase.TRANSFORM,
      PipelinePhase.POST_TRANSFORM,
      PipelinePhase.MATERIALIZE,
    ];

    const startIndex = phases.indexOf(phase);
    for (let i = startIndex; i < phases.length; i++) {
      this.cache.delete(phases[i]!);
    }
    this.stats.invalidations++;
  }

  // ==========================================================================
  // 해시 계산
  // ==========================================================================

  /**
   * 설정 해시 계산
   */
  private computeConfigHashes(config: ViewConfig): ConfigHash {
    return {
      filters: this.hashFilters(config.filters),
      sorts: this.hashSorts(config.sorts),
      pivot: this.hashPivot(config),
      group: this.hashGroup(config.rowFields),
    };
  }

  /**
   * 무효화 시작 지점 결정
   */
  private determineInvalidationPoint(newHashes: ConfigHash): PipelinePhase | null {
    // 필터 변경 → PRE_TRANSFORM부터
    if (newHashes.filters !== this.currentHashes.filters) {
      return PipelinePhase.PRE_TRANSFORM;
    }

    // 정렬 변경 → SORT부터
    if (newHashes.sorts !== this.currentHashes.sorts) {
      return PipelinePhase.SORT;
    }

    // 피봇/그룹 변경 → TRANSFORM부터
    if (newHashes.pivot !== this.currentHashes.pivot ||
        newHashes.group !== this.currentHashes.group) {
      return PipelinePhase.TRANSFORM;
    }

    // 변경 없음
    return null;
  }

  /**
   * 단계별 해시 키 생성
   */
  private getHashKeyForPhase(phase: PipelinePhase, hashes: ConfigHash): string {
    switch (phase) {
      case PipelinePhase.PRE_TRANSFORM:
        return hashes.filters;
      case PipelinePhase.SORT:
        return `${hashes.filters}|${hashes.sorts}`;
      case PipelinePhase.TRANSFORM:
        return `${hashes.filters}|${hashes.sorts}|${hashes.pivot}|${hashes.group}`;
      default:
        return `${hashes.filters}|${hashes.sorts}|${hashes.pivot}|${hashes.group}`;
    }
  }

  /**
   * 필터 해시
   */
  private hashFilters(filters: FilterState[]): string {
    if (filters.length === 0) return '';
    return JSON.stringify(filters);
  }

  /**
   * 정렬 해시
   */
  private hashSorts(sorts: SortState[]): string {
    if (sorts.length === 0) return '';
    return JSON.stringify(sorts);
  }

  /**
   * 피봇 해시
   */
  private hashPivot(config: ViewConfig): string {
    if (config.columnFields.length === 0) return '';
    return JSON.stringify({
      rowFields: config.rowFields,
      columnFields: config.columnFields,
      valueFields: config.valueFields,
    });
  }

  /**
   * 그룹 해시
   */
  private hashGroup(groupColumns: string[]): string {
    if (groupColumns.length === 0) return '';
    return JSON.stringify(groupColumns);
  }

  /**
   * 데이터 해시 (간단한 버전)
   */
  private hashData(data: RowData[]): string {
    // 전체 데이터를 해시하면 비용이 크므로
    // 길이와 첫/마지막 행의 키만 사용
    if (data.length === 0) return 'empty';
    
    const first = data[0];
    const last = data[data.length - 1];
    const keys = first ? Object.keys(first).join(',') : '';
    
    return `${data.length}:${keys}:${JSON.stringify(first)}:${JSON.stringify(last)}`;
  }

  // ==========================================================================
  // 통계
  // ==========================================================================

  /**
   * 캐시 통계 반환
   */
  getStats(): { hits: number; misses: number; invalidations: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * 통계 초기화
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, invalidations: 0 };
  }

  /**
   * 캐시 크기 반환
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
