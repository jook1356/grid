/**
 * ViewConfig - 뷰 설정 타입 정의
 *
 * 일반 그리드와 피봇 그리드를 하나의 설정 인터페이스로 관리합니다.
 * columnFields가 비어있으면 일반 그리드, 있으면 피봇 그리드입니다.
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { SortState, FilterState, ColumnDef, Row } from '../types';

// =============================================================================
// 뷰 모드
// =============================================================================

/**
 * 뷰 모드 타입
 *
 * - normal: 일반 그리드 (데이터를 그대로 표시)
 * - pivot: 피봇 그리드 (행↔열 변환)
 */
export type ViewMode = 'normal' | 'pivot';

// =============================================================================
// 집계 설정
// =============================================================================

/**
 * 집계 함수 타입
 */
export type AggregateFunction = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

/**
 * 값 필드 설정 (피봇용)
 */
export interface ValueField {
  /** 필드 키 */
  field: string;
  
  /** 집계 함수 */
  aggregate: AggregateFunction;
  
  /** 표시 레이블 (선택) */
  label?: string;
  
  /** 포맷터 (선택) */
  formatter?: (value: unknown) => string;
}

// =============================================================================
// 뷰 설정
// =============================================================================

/**
 * 통합 뷰 설정
 *
 * 일반/피봇 그리드를 하나의 인터페이스로 관리합니다.
 *
 * @example
 * // 일반 그리드 설정
 * const normalConfig: ViewConfig = {
 *   rowFields: ['id', 'name', 'age'],
 *   columnFields: [],  // 비어있음 = 일반 그리드
 *   valueFields: [],
 *   sorts: [{ columnKey: 'name', direction: 'asc' }],
 *   filters: []
 * };
 *
 * @example
 * // 피봇 그리드 설정
 * const pivotConfig: ViewConfig = {
 *   rowFields: ['department'],
 *   columnFields: ['year', 'quarter'],
 *   valueFields: [{ field: 'sales', aggregate: 'sum' }],
 *   sorts: [],
 *   filters: []
 * };
 */
export interface ViewConfig {
  // ===== 피봇 설정 =====
  
  /** 행으로 사용할 필드 (일반: 모든 필드, 피봇: 행 헤더) */
  rowFields: string[];
  
  /** 열로 사용할 필드 (피봇 축, 비어있으면 일반 그리드) */
  columnFields: string[];
  
  /** 값/집계 필드 (피봇용) */
  valueFields: ValueField[];
  
  // ===== 공통 설정 =====
  
  /** 정렬 상태 */
  sorts: SortState[];
  
  /** 필터 상태 */
  filters: FilterState[];
}

// =============================================================================
// 피봇 설정 및 결과
// =============================================================================

/**
 * 피봇 설정
 */
export interface PivotConfig {
  /** 행으로 사용할 필드 */
  rowFields: string[];
  
  /** 열로 사용할 필드 */
  columnFields: string[];
  
  /** 값/집계 필드 */
  valueFields: ValueField[];
}

/**
 * 피봇 결과
 *
 * 피봇 연산의 결과물로, 새로운 Row[]와 ColumnDef[]를 포함합니다.
 */
export interface PivotResult {
  /** 피봇된 행 데이터 */
  rows: Row[];
  
  /** 동적 생성된 컬럼 정의 */
  columns: ColumnDef[];
  
  /** 생성된 컬럼 그룹 (선택) */
  columnGroups?: ColumnGroup[];
}

/**
 * 컬럼 그룹 (피봇 컬럼 계층용)
 */
export interface ColumnGroup {
  /** 그룹 키 */
  key: string;
  
  /** 그룹 레이블 */
  label: string;
  
  /** 하위 컬럼 키들 */
  children: string[];
  
  /** 하위 그룹 (중첩 피봇용) */
  childGroups?: ColumnGroup[];
}

// =============================================================================
// 기본 설정 생성 헬퍼
// =============================================================================

/**
 * 기본 일반 그리드 설정 생성
 */
export function createNormalViewConfig(fields: string[]): ViewConfig {
  return {
    rowFields: fields,
    columnFields: [],
    valueFields: [],
    sorts: [],
    filters: [],
  };
}

/**
 * 기본 피봇 그리드 설정 생성
 */
export function createPivotViewConfig(config: {
  rowFields: string[];
  columnFields: string[];
  valueFields: ValueField[];
}): ViewConfig {
  return {
    rowFields: config.rowFields,
    columnFields: config.columnFields,
    valueFields: config.valueFields,
    sorts: [],
    filters: [],
  };
}

/**
 * ViewConfig가 피봇 모드인지 확인
 */
export function isPivotMode(config: ViewConfig): boolean {
  return config.columnFields.length > 0;
}
