/**
 * 상태 타입 정의
 *
 * Grid의 현재 상태 (정렬, 필터링, 그룹화 등)를 나타내는 타입들입니다.
 * 이 상태들이 바뀌면 화면이 다시 그려집니다.
 */

import type { CellValue } from './data.types';

// ============================================================================
// 정렬 상태
// ============================================================================

/**
 * 정렬 방향
 */
export type SortDirection = 'asc' | 'desc';

/**
 * 정렬 상태
 *
 * 어떤 컬럼을 어떤 방향으로 정렬할지 나타냅니다.
 *
 * @example
 * // 이름으로 오름차순 정렬
 * const sort: SortState = { columnKey: 'name', direction: 'asc' };
 *
 * // 나이로 내림차순 정렬
 * const sort: SortState = { columnKey: 'age', direction: 'desc' };
 */
export interface SortState {
  /** 정렬할 컬럼의 키 */
  columnKey: string;

  /** 정렬 방향 */
  direction: SortDirection;
}

// ============================================================================
// 필터 상태
// ============================================================================

/**
 * 필터 연산자
 *
 * 값을 어떻게 비교할지 정의합니다.
 *
 * - eq: 같음 (equals)
 * - neq: 같지 않음 (not equals)
 * - gt: 큼 (greater than)
 * - gte: 크거나 같음 (greater than or equals)
 * - lt: 작음 (less than)
 * - lte: 작거나 같음 (less than or equals)
 * - contains: 포함 (문자열)
 * - notContains: 포함하지 않음 (문자열)
 * - startsWith: ~로 시작 (문자열)
 * - endsWith: ~로 끝남 (문자열)
 * - between: 범위 내 (숫자, 날짜)
 * - isNull: null인지 확인
 * - isNotNull: null이 아닌지 확인
 */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'between'
  | 'isNull'
  | 'isNotNull';

/**
 * 필터 상태
 *
 * 어떤 컬럼을 어떤 조건으로 필터링할지 나타냅니다.
 *
 * @example
 * // 나이가 20 이상인 것만
 * const filter: FilterState = {
 *   columnKey: 'age',
 *   operator: 'gte',
 *   value: 20
 * };
 *
 * // 이름에 '김'이 포함된 것만
 * const filter: FilterState = {
 *   columnKey: 'name',
 *   operator: 'contains',
 *   value: '김'
 * };
 *
 * // 나이가 20~30 사이인 것만
 * const filter: FilterState = {
 *   columnKey: 'age',
 *   operator: 'between',
 *   value: 20,
 *   value2: 30
 * };
 */
export interface FilterState {
  /** 필터링할 컬럼의 키 */
  columnKey: string;

  /** 비교 연산자 */
  operator: FilterOperator;

  /** 비교할 값 */
  value: CellValue;

  /** 두 번째 값 (between 연산자용) */
  value2?: CellValue;
}

// ============================================================================
// 그룹화 상태
// ============================================================================

/**
 * 그룹화 상태
 *
 * 어떤 컬럼들로 데이터를 그룹화할지 나타냅니다.
 *
 * @example
 * // 부서별로 그룹화
 * const group: GroupState = { columnKeys: ['department'] };
 *
 * // 부서 → 직급 순으로 계층 그룹화
 * const group: GroupState = { columnKeys: ['department', 'position'] };
 */
export interface GroupState {
  /** 그룹화할 컬럼 키 목록 (순서대로 계층 구조) */
  columnKeys: string[];

  /** 그룹 접기/펼치기 상태 (그룹 ID → 펼침 여부) */
  expandedGroups?: Set<string>;
}

// ============================================================================
// 뷰 상태 (통합)
// ============================================================================

/**
 * 뷰 상태
 *
 * Grid의 현재 보기 상태를 모두 모아놓은 것입니다.
 * 이 상태가 바뀌면 Worker에게 처리를 요청합니다.
 *
 * @example
 * const viewState: ViewState = {
 *   sorts: [{ columnKey: 'name', direction: 'asc' }],
 *   filters: [{ columnKey: 'age', operator: 'gte', value: 20 }],
 *   groups: null
 * };
 */
export interface ViewState {
  /** 정렬 상태 목록 (다중 정렬 지원) */
  sorts: SortState[];

  /** 필터 상태 목록 (AND 조건) */
  filters: FilterState[];

  /** 그룹화 상태 (없으면 null) */
  groups: GroupState | null;
}

// ============================================================================
// 선택 상태
// ============================================================================

/**
 * 셀 위치
 */
export interface CellPosition {
  /** 행 인덱스 */
  rowIndex: number;

  /** 컬럼 키 */
  columnKey: string;
}

/**
 * 선택 영역
 *
 * 시작 셀과 끝 셀로 사각형 영역을 나타냅니다.
 */
export interface SelectionRange {
  /** 시작 셀 */
  start: CellPosition;

  /** 끝 셀 */
  end: CellPosition;
}

/**
 * 선택 상태
 *
 * 현재 선택된 셀, 행, 영역을 나타냅니다.
 */
export interface SelectionState {
  /** 현재 포커스된 셀 */
  focusedCell: CellPosition | null;

  /** 선택된 영역들 (Ctrl+클릭으로 여러 영역 선택 가능) */
  ranges: SelectionRange[];

  /** 선택된 행 인덱스들 */
  selectedRows: Set<number>;
}
