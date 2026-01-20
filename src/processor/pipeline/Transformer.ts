/**
 * Transformer 인터페이스 및 파이프라인 타입 정의
 *
 * 데이터 변환 파이프라인의 핵심 추상화입니다.
 * 각 Transformer는 데이터를 입력받아 변환하고 결과를 반환합니다.
 *
 * 파이프라인 구조:
 * Raw → FilterTransformer → SortTransformer → (GroupTransformer | PivotTransformer) → MaterializeTransformer
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, ColumnDef, SortState, FilterState } from '../../types';
import type { ViewConfig } from '../../core/ViewConfig';

// =============================================================================
// 파이프라인 단계
// =============================================================================

/**
 * 파이프라인 단계(Phase)
 *
 * 각 Transformer가 실행되는 순서를 결정합니다.
 * 낮은 숫자가 먼저 실행됩니다.
 */
export enum PipelinePhase {
  /** 원본 데이터 필터 */
  PRE_TRANSFORM = 1,
  
  /** 정렬 */
  SORT = 2,
  
  /** 구조 변경 (피봇, 그룹화) */
  TRANSFORM = 3,
  
  /** 결과 필터/정렬 (피봇 후 추가 처리) */
  POST_TRANSFORM = 4,
  
  /** Row 인스턴스 생성 (최종 단계) */
  MATERIALIZE = 5,
}

// =============================================================================
// 변환 컨텍스트
// =============================================================================

/**
 * 변환 컨텍스트
 *
 * Transformer 간에 전달되는 데이터와 메타데이터입니다.
 * 각 Transformer는 컨텍스트를 받아 변환 후 새 컨텍스트를 반환합니다.
 */
export interface TransformContext {
  /** 원본 데이터 배열 */
  data: RowData[];
  
  /** 현재 유효한 인덱스 배열 (null이면 전체 데이터 사용) */
  indices: Uint32Array | null;
  
  /** 현재 컬럼 정의 (피봇에서 변경될 수 있음) */
  columns: ColumnDef[];
  
  /** 원본 컬럼 → 변환 후 컬럼 매핑 (피봇용) */
  columnMapping?: Map<string, string[]>;
  
  /** 그룹 정보 (그룹화 시 사용) */
  groupInfo?: GroupTransformInfo;
  
  /** 피봇 결과 (피봇 시 사용) */
  pivotResult?: PivotTransformResult;
  
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 그룹 변환 정보
 */
export interface GroupTransformInfo {
  /** 그룹 컬럼 키 배열 */
  groupColumns: string[];
  
  /** 그룹 ID → 접힘 상태 */
  collapsedGroups: Set<string>;
  
  /** 그룹 구조 */
  groups: GroupNode[];
}

/**
 * 그룹 노드
 */
export interface GroupNode {
  /** 그룹 ID */
  id: string;
  
  /** 그룹 값 */
  value: unknown;
  
  /** 그룹 레벨 */
  level: number;
  
  /** 그룹 경로 */
  path: unknown[];
  
  /** 자식 그룹 */
  children: GroupNode[];
  
  /** 리프 데이터 인덱스 */
  dataIndices: number[];
  
  /** 접힘 상태 */
  collapsed: boolean;
  
  /** 집계 값 */
  aggregates?: Record<string, unknown>;
}

/**
 * 피봇 변환 결과
 */
export interface PivotTransformResult {
  /** 피봇된 행 데이터 */
  rows: RowData[];
  
  /** 생성된 컬럼 정의 */
  columns: ColumnDef[];
  
  /** 원본 행 인덱스 매핑 (선택) */
  sourceIndices?: Map<number, number[]>;
}

// =============================================================================
// Transformer 인터페이스
// =============================================================================

/**
 * Transformer 인터페이스
 *
 * 데이터 변환의 기본 단위입니다.
 * 각 Transformer는 독립적으로 테스트할 수 있어야 합니다.
 */
export interface Transformer {
  /** Transformer 이름 (디버깅용) */
  readonly name: string;
  
  /** 실행 단계 */
  readonly phase: PipelinePhase;
  
  /** Worker에서 실행 여부 */
  readonly runInWorker: boolean;
  
  /**
   * 변환 실행
   *
   * @param ctx - 입력 컨텍스트
   * @returns 변환된 컨텍스트 (또는 Promise)
   */
  transform(ctx: TransformContext): TransformContext | Promise<TransformContext>;
  
  /**
   * Transformer 설정 업데이트 (선택)
   *
   * @param config - 새 설정
   */
  configure?(config: Partial<TransformerConfig>): void;
}

/**
 * Transformer 공통 설정
 */
export interface TransformerConfig {
  /** 활성화 여부 */
  enabled: boolean;
}

// =============================================================================
// 구체적 Transformer 설정
// =============================================================================

/**
 * Filter Transformer 설정
 */
export interface FilterTransformerConfig extends TransformerConfig {
  /** 필터 조건 배열 */
  filters: FilterState[];
}

/**
 * Sort Transformer 설정
 */
export interface SortTransformerConfig extends TransformerConfig {
  /** 정렬 조건 배열 */
  sorts: SortState[];
}

/**
 * Group Transformer 설정
 */
export interface GroupTransformerConfig extends TransformerConfig {
  /** 그룹 컬럼 배열 */
  groupColumns: string[];
  
  /** 접힌 그룹 ID 배열 */
  collapsedGroups: string[];
  
  /** 집계 설정 */
  aggregates?: AggregateField[];
}

/**
 * Pivot Transformer 설정
 */
export interface PivotTransformerConfig extends TransformerConfig {
  /** 행 필드 */
  rowFields: string[];
  
  /** 열 필드 */
  columnFields: string[];
  
  /** 값 필드 */
  valueFields: ValueFieldConfig[];
}

/**
 * 집계 필드 설정
 */
export interface AggregateField {
  /** 대상 컬럼 키 */
  columnKey: string;
  
  /** 집계 함수 */
  function: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
  
  /** 결과 컬럼 키 (선택, 기본값: columnKey_function) */
  resultKey?: string;
}

/**
 * 값 필드 설정 (피봇용)
 */
export interface ValueFieldConfig {
  /** 필드 키 */
  field: string;
  
  /** 집계 함수 */
  aggregate: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
  
  /** 표시 레이블 */
  label?: string;
}

// =============================================================================
// 파이프라인 빌더 타입
// =============================================================================

/**
 * 파이프라인 실행 결과
 */
export interface PipelineResult {
  /** 최종 컨텍스트 */
  context: TransformContext;
  
  /** 실행 시간 (ms) */
  executionTime: number;
  
  /** 각 단계별 실행 시간 */
  phaseTimings?: Map<PipelinePhase, number>;
}

/**
 * 파이프라인 옵션
 */
export interface PipelineOptions {
  /** 디버그 모드 (타이밍 기록) */
  debug?: boolean;
  
  /** 워커 사용 여부 */
  useWorker?: boolean;
}

// =============================================================================
// 헬퍼 함수
// =============================================================================

/**
 * 빈 변환 컨텍스트 생성
 */
export function createEmptyContext(data: RowData[], columns: ColumnDef[]): TransformContext {
  return {
    data,
    indices: null,
    columns,
  };
}

/**
 * 컨텍스트 복사 (얕은 복사)
 */
export function cloneContext(ctx: TransformContext): TransformContext {
  return {
    ...ctx,
    metadata: ctx.metadata ? { ...ctx.metadata } : undefined,
  };
}

/**
 * ViewConfig에서 파이프라인 설정 추출
 */
export function extractPipelineConfig(config: ViewConfig): {
  filterConfig: FilterTransformerConfig;
  sortConfig: SortTransformerConfig;
  groupConfig?: GroupTransformerConfig;
  pivotConfig?: PivotTransformerConfig;
} {
  const filterConfig: FilterTransformerConfig = {
    enabled: config.filters.length > 0,
    filters: config.filters,
  };

  const sortConfig: SortTransformerConfig = {
    enabled: config.sorts.length > 0,
    sorts: config.sorts,
  };

  // 피봇 모드 확인
  const isPivot = config.columnFields.length > 0;

  if (isPivot) {
    const pivotConfig: PivotTransformerConfig = {
      enabled: true,
      rowFields: config.rowFields,
      columnFields: config.columnFields,
      valueFields: config.valueFields.map(vf => ({
        field: vf.field,
        aggregate: vf.aggregate,
        label: vf.label,
      })),
    };

    return { filterConfig, sortConfig, pivotConfig };
  } else {
    // 일반 모드 (그룹화 지원은 별도 설정 필요)
    return { filterConfig, sortConfig };
  }
}
