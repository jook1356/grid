/**
 * 피벗 그리드 타입 정의
 *
 * 피벗 연산, 헤더 트리, 데이터 변환에 사용되는 타입들입니다.
 */

import type { CellValue } from './data.types';
import type { ColumnDef } from './data.types';
import type { AggregateFunc } from './field.types';

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
 */
export interface PivotConfig {
  /** 행 축 필드 키 배열 */
  rowFields: string[];

  /** 열 축 필드 키 배열 (피벗되는 필드) */
  columnFields: string[];

  /** 값 필드 설정 배열 */
  valueFields: PivotValueField[];

  /** 행 합계 표시 여부 @default false */
  showRowTotals?: boolean;

  /** 열 합계 표시 여부 @default false */
  showColumnTotals?: boolean;

  /** 총 합계 표시 여부 @default false */
  showGrandTotal?: boolean;
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

