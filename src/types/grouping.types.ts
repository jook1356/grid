/**
 * 그룹화 및 Multi-Row 관련 타입 정의
 *
 * 행 그룹화와 Multi-Row 레이아웃을 위한 타입들을 정의합니다.
 * VirtualRow 타입과 RowState도 포함합니다.
 */

import type { CellValue, Row } from './data.types';

// ============================================================================
// 행 상태 타입 (Dirty State Pattern)
// ============================================================================

/**
 * 행 변경 상태
 *
 * CRUD 작업 시 행의 현재 상태를 나타냅니다.
 * commit() 호출 전까지는 원본 데이터에 반영되지 않습니다.
 */
export type RowState =
  | 'pristine'   // 원본 그대로 (변경 없음)
  | 'added'      // 새로 추가됨 (commit 전)
  | 'modified'   // 수정됨 (commit 전)
  | 'deleted';   // 삭제 예정 (commit 전)

// ============================================================================
// 집계 함수 타입
// ============================================================================

/**
 * 내장 집계 함수
 */
export type AggregateType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'first' | 'last';

/**
 * 커스텀 집계 함수
 */
export type CustomAggregateFunction = (values: CellValue[]) => CellValue;

/**
 * 집계 함수 (내장 또는 커스텀)
 */
export type AggregateFn = AggregateType | CustomAggregateFunction;

// ============================================================================
// 그룹 식별자
// ============================================================================

/**
 * 그룹 식별자
 *
 * 특정 그룹을 식별하기 위한 정보입니다.
 */
export interface GroupIdentifier {
  /** 그룹 컬럼 키 */
  column: string;

  /** 그룹 값 (예: 'Germany', 'Active') */
  value: CellValue;

  /** 상위 그룹들 (중첩 그룹 시) */
  parentGroups?: GroupIdentifier[];
}

// ============================================================================
// 가상 행 타입 (VirtualRow)
// ============================================================================

/**
 * 그룹 헤더 행
 *
 * 그룹화된 데이터에서 그룹의 헤더를 나타냅니다.
 */
export interface GroupHeaderRow {
  /** 행 타입: 그룹 헤더 */
  type: 'group-header';

  /** 그룹 고유 ID (접기/펼치기용) */
  groupId: string;

  /** 그룹 컬럼 키 */
  column: string;

  /** 그룹 값 */
  value: CellValue;

  /** 중첩 레벨 (0부터 시작) */
  level: number;

  /** 하위 아이템 개수 */
  itemCount: number;

  /** 접힘 상태 */
  collapsed: boolean;

  /** 집계 값들 */
  aggregates: Record<string, CellValue>;

  /** 그룹 경로 (상위 그룹들) */
  path: GroupIdentifier[];
}

/**
 * 데이터 행
 *
 * 실제 데이터를 담고 있는 행입니다.
 */
export interface DataRow {
  /** 행 타입: 데이터 */
  type: 'data';

  /** 행 식별자 (CRUD 안전, 불변) */
  rowId?: string | number;

  /** 원본 데이터 인덱스 (CRUD 시 변경될 수 있음) */
  dataIndex: number;

  /** 실제 데이터 */
  data: Row;

  /** 속한 그룹 경로 */
  groupPath: GroupIdentifier[];

  /** 행 변경 상태 (Dirty State) */
  rowState?: RowState;

  /** 원본 데이터 (modified일 때 보관) */
  originalData?: Row;

  /** 변경된 필드 목록 */
  changedFields?: Set<string>;
}

/**
 * 그룹 푸터 행 (부분합)
 *
 * 그룹화된 데이터에서 그룹의 소계를 나타냅니다.
 * 그룹의 아래에 배치됩니다.
 */
export interface GroupFooterRow {
  /** 행 타입: 그룹 푸터 */
  type: 'group-footer';

  /** 그룹 고유 ID */
  groupId: string;

  /** 그룹 컬럼 키 */
  column: string;

  /** 그룹 값 */
  value: CellValue;

  /** 중첩 레벨 (0부터 시작) */
  level: number;

  /** 하위 아이템 개수 */
  itemCount: number;

  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
}

/**
 * 부분합 행 (Pivot용)
 *
 * 피벗 테이블에서 부분합을 나타냅니다.
 * 각 그룹의 아래에 배치됩니다.
 */
export interface SubtotalRow {
  /** 행 타입: 부분합 */
  type: 'subtotal';

  /** 레벨 (0부터 시작) */
  level: number;

  /** 그룹 키 (식별용) */
  groupKey?: string;

  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
}

/**
 * 총합계 행
 *
 * 전체 데이터의 합계를 나타냅니다.
 */
export interface GrandTotalRow {
  /** 행 타입: 총합계 */
  type: 'grand-total';

  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
}

/**
 * 가상 행 (Virtual Row)
 *
 * 그룹 헤더, 데이터 행, 소계 행 등을 나타냅니다.
 * 가상화된 스크롤에서 렌더링할 행의 타입입니다.
 */
export type VirtualRow =
  | GroupHeaderRow
  | DataRow
  | GroupFooterRow
  | SubtotalRow
  | GrandTotalRow;

// ============================================================================
// 그룹 설정
// ============================================================================

/**
 * 그룹화 설정
 */
export interface GroupingConfig {
  /** 그룹화할 컬럼 키들 (순서대로 계층 구조) */
  columns: string[];

  /** 집계 설정 (컬럼 키 → 집계 함수) */
  aggregates?: Record<string, AggregateFn>;

  /** 기본 접힘 상태 */
  defaultCollapsed?: boolean;
}

/**
 * 그룹 상태 (접기/펼치기)
 */
export interface GroupExpandState {
  /** 그룹화된 컬럼들 */
  columns: string[];

  /** 접힌 그룹 ID들 */
  collapsedGroups: Set<string>;
}

// ============================================================================
// 그룹 노드 (내부 트리 구조)
// ============================================================================

/**
 * 그룹 노드 (내부 사용)
 *
 * 그룹화된 데이터의 트리 구조를 나타냅니다.
 */
export interface GroupNode {
  /** 그룹 컬럼 */
  column: string;

  /** 그룹 값 */
  value: CellValue;

  /** 하위 그룹들 (중첩 그룹 시) */
  children?: GroupNode[];

  /** 리프 노드의 데이터 행들 */
  rows?: Row[];

  /** 원본 데이터 인덱스들 */
  dataIndices?: number[];

  /** 총 아이템 수 */
  count: number;

  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
}

// ============================================================================
// Multi-Row 레이아웃 타입
// ============================================================================

/**
 * Multi-Row 레이아웃 아이템
 *
 * 레이아웃 내 각 셀의 정의입니다.
 */
export interface RowLayoutItem {
  /** 컬럼 키 */
  key: string;

  /** 가로 병합 수 (기본: 1) */
  colSpan?: number;

  /** 세로 병합 수 - Multi-Row 내에서 (기본: 1) */
  rowSpan?: number;

  /** 너비 (픽셀 또는 비율) */
  width?: number | string;
}

/**
 * Multi-Row 템플릿
 *
 * 하나의 데이터 행을 여러 줄로 표시하기 위한 템플릿입니다.
 */
export interface RowTemplate {
  /**
   * 하나의 데이터 행이 차지할 visual row 수
   */
  rowCount: number;

  /**
   * 각 visual row의 셀 배치
   * layout[0] = 첫 번째 줄, layout[1] = 두 번째 줄, ...
   */
  layout: RowLayoutItem[][];
}

// ============================================================================
// 셀 병합 타입 (데이터 레벨)
// ============================================================================

/**
 * 병합 전략
 */
export type MergeStrategy = 'none' | 'same-value' | 'custom';

/**
 * 셀 메타데이터 (병합 정보)
 */
export interface CellMeta {
  /** 가로 병합 수 */
  colSpan?: number;

  /** 세로 병합 수 */
  rowSpan?: number;

  /** 다른 셀에 병합되었는지 */
  merged?: boolean;

  /** 병합 부모 셀 참조 */
  mergeParent?: {
    row: number;
    col: number;
  };
}

/**
 * 병합 범위
 */
export interface MergeRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
