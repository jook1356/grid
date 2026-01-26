/**
 * 피벗 그리드 타입 정의
 *
 * 피벗 연산, 헤더 트리, 데이터 변환에 사용되는 타입들입니다.
 */

import type { CellValue } from './data.types';
import type { ColumnDef } from './data.types';
import type { AggregateFunc } from './field.types';
import type { FilterState, SortState } from './state.types';

// ============================================================================
// 피벗 설정
// ============================================================================

/**
 * 피벗 값 필드 설정
 */
export interface PivotValueField {
  /** 필드 키 */
  field: string;

  /** 집계 함수 */
  aggregate: AggregateFunc;

  /** 표시 이름 (선택) */
  header?: string;

  /** 값 포맷터 */
  formatter?: (value: CellValue) => string;
}

/**
 * 피벗 설정 (내부용)
 *
 * PureSheetConfig의 피벗 관련 속성을 추출하여 PivotProcessor에 전달
 *
 * 데이터 처리 순서: 필터 → 정렬 → 피벗
 */
export interface PivotConfig {
  /** 행 축 필드 키 배열 */
  rowFields: string[];

  /** 열 축 필드 키 배열 (피벗되는 필드) */
  columnFields: string[];

  /** 값 필드 설정 배열 */
  valueFields: PivotValueField[];

  // ==========================================================================
  // 부분합/총합계 옵션
  // ==========================================================================

  /**
   * 행 소계 표시 (rowSubTotals)
   * - true: 모든 rowFields 레벨에서 소계 삽입
   * - false: 소계 없음 (기본값)
   * - rowSubTotalFields와 함께 사용 시 해당 필드만 적용
   * @default false
   */
  showRowSubTotals?: boolean;

  /**
   * 행 소계를 표시할 필드 목록
   * showRowSubTotals가 true일 때, 특정 필드에서만 소계를 표시하고 싶을 때 사용
   *
   * @example
   * // rowFields: ['category', 'product', 'region']
   * rowSubTotalFields: ['category', 'product']  // category, product 변경 시 소계
   * rowSubTotalFields: ['category']             // category 변경 시만 소계
   */
  rowSubTotalFields?: string[];

  /**
   * 행 총합계 표시 (rowGrandTotals)
   * 하단에 총합 행 추가
   * @default false
   */
  showRowGrandTotals?: boolean;

  /**
   * 열 소계 표시 (columnSubTotals)
   * - true: 모든 columnFields 레벨에서 소계 컬럼 삽입
   * - false: 소계 없음 (기본값)
   * - columnSubTotalFields와 함께 사용 시 해당 필드만 적용
   * @default false
   */
  showColumnSubTotals?: boolean;

  /**
   * 열 소계를 표시할 필드 목록
   * showColumnSubTotals가 true일 때, 특정 필드에서만 소계 컬럼을 표시하고 싶을 때 사용
   *
   * @example
   * // columnFields: ['year', 'quarter', 'month']
   * columnSubTotalFields: ['year', 'quarter']  // year, quarter 변경 시 소계 컬럼
   * columnSubTotalFields: ['year']             // year 변경 시만 소계 컬럼
   */
  columnSubTotalFields?: string[];

  /**
   * 열 총합계 표시 (columnGrandTotals)
   * 우측 끝에 총합 컬럼 추가
   * @default false
   */
  showColumnGrandTotals?: boolean;

  // ==========================================================================
  // 전처리 옵션 (피벗 전에 적용)
  // ==========================================================================

  /**
   * 필터 조건 (피벗 전에 적용)
   *
   * 피벗 연산 전에 데이터를 필터링합니다.
   * 필터링된 데이터만 피벗 결과에 포함됩니다.
   */
  filters?: FilterState[];

  /**
   * 정렬 조건 (피벗 전에 적용)
   *
   * 피벗 연산 전에 데이터를 정렬합니다.
   * 정렬 순서는 피벗 결과의 행 순서에 영향을 줄 수 있습니다.
   */
  sorts?: SortState[];
}

// ============================================================================
// 피벗 헤더 트리
// ============================================================================

/**
 * 피벗 헤더 노드
 *
 * 다중 레벨 컬럼 헤더를 트리 구조로 표현합니다.
 *
 * @example
 * // columnFields: ['year', 'quarter'], valueFields: ['sales', 'profit']
 * // 결과 트리:
 * // root
 * //   └─ 2023 (colspan: 4)
 * //       ├─ Q1 (colspan: 2)
 * //       │   ├─ sales (leaf)
 * //       │   └─ profit (leaf)
 * //       └─ Q2 (colspan: 2)
 * //           ├─ sales (leaf)
 * //           └─ profit (leaf)
 */
export interface PivotHeaderNode {
  /** 노드 값 (예: '2023', 'Q1', 'sales') */
  value: string;

  /** 표시 이름 (header) */
  label: string;

  /** 레벨 (0부터 시작, root는 -1) */
  level: number;

  /** 이 노드가 차지하는 컬럼 span (자식들의 합) */
  colspan: number;

  /** 자식 노드들 */
  children: PivotHeaderNode[];

  /** 리프 노드인 경우 컬럼 키 (예: '2023_Q1_sales') */
  columnKey?: string;

  /** 리프 노드인지 여부 */
  isLeaf: boolean;

  /** 부모 경로 (값 배열) - 예: ['2023', 'Q1'] */
  path: string[];
}

// ============================================================================
// 피벗 결과
// ============================================================================

/**
 * 피벗 행 데이터
 */
export interface PivotRow {
  /** 행 헤더 값들 (rowFields 순서대로) */
  rowHeaders: Record<string, CellValue>;

  /** 피벗된 값들 (동적 컬럼 키 → 값) */
  values: Record<string, CellValue>;

  /** 행 타입 */
  type: 'data' | 'subtotal' | 'grandtotal';

  /** 그룹 깊이 (subtotal인 경우) */
  depth?: number;
}

/**
 * 행 병합 정보
 */
export interface RowMergeInfo {
  /** 시작 행 인덱스 */
  startIndex: number;

  /** 병합할 행 수 (rowSpan) */
  span: number;
}

/**
 * 피벗 연산 결과
 */
export interface PivotResult {
  /** 컬럼 헤더 트리 (빌드 완료, colspan 계산됨) */
  columnHeaderTree: PivotHeaderNode;

  /** 헤더 레벨 수 */
  headerLevelCount: number;

  /** 행 병합 정보 (컬럼별 병합 구간) */
  rowMergeInfo: {
    [columnKey: string]: RowMergeInfo[];
  };

  /** 피벗된 데이터 */
  pivotedData: PivotRow[];

  /** 동적 생성된 컬럼 정의 (리프 노드 기준) */
  columns: ColumnDef[];

  /** 행 헤더 컬럼 정의 (rowFields 기준) */
  rowHeaderColumns: ColumnDef[];

  /** 메타 정보 */
  meta: {
    /** 총 데이터 행 수 */
    totalRows: number;

    /** 총 피벗 컬럼 수 (리프 노드 수) */
    totalColumns: number;

    /** columnFields별 유니크 값 수 */
    uniqueValues: Record<string, number>;
  };
}

// ============================================================================
// 유틸리티
// ============================================================================

/**
 * 피벗 컬럼 키 생성
 *
 * @param path - 경로 값 배열 (예: ['2023', 'Q1'])
 * @param valueField - 값 필드 키 (예: 'sales')
 * @returns 컬럼 키 (예: '2023_Q1_sales')
 */
export function createPivotColumnKey(path: string[], valueField: string): string {
  return [...path, valueField].join('_');
}

/**
 * 피벗 컬럼 키 파싱
 *
 * @param columnKey - 컬럼 키 (예: '2023_Q1_sales')
 * @param columnFieldCount - columnFields 개수
 * @returns 파싱된 정보
 */
export function parsePivotColumnKey(
  columnKey: string,
  columnFieldCount: number
): { path: string[]; valueField: string } {
  const parts = columnKey.split('_');
  const valueField = parts[parts.length - 1] || '';
  const path = parts.slice(0, columnFieldCount);
  return { path, valueField };
}

export const PIVOT_KEY_SUBTOTAL = '__subtotal__';
export const PIVOT_KEY_GRANDTOTAL = '__grandtotal__';
export const PIVOT_LABEL_SUBTOTAL = '소계';
export const PIVOT_LABEL_GRANDTOTAL = '총합계';
