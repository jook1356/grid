/**
 * 필드 및 Config API 타입 정의
 *
 * 새로운 플랫 구조의 PureSheet 설정 타입입니다.
 * 피벗 그리드와 일반 그리드 모두 지원합니다.
 */

import type { Row, CellValue } from './data.types';
import type { RowState } from './grouping.types';

// ============================================================================
// 기본 타입
// ============================================================================

/**
 * 데이터 타입
 */
export type DataType = 'string' | 'number' | 'boolean' | 'date';

// ============================================================================
// formatRow API 타입
// ============================================================================

/**
 * 셀 정보 (formatRow 컨텍스트용)
 */
export interface CellInfo {
  /** 셀 DOM 요소 */
  element: HTMLElement;
  /** 셀 값 */
  value: CellValue;
  /** 원본 값 (modified일 때) */
  originalValue?: CellValue;
  /** 이 셀이 수정되었는지 */
  isModified: boolean;
}

/**
 * 데이터 행 포맷팅 컨텍스트
 */
export interface DataRowContext {
  /** 뷰 인덱스 (가상화 기준) */
  viewIndex: number;
  /** 데이터 인덱스 (원본 데이터 기준) */
  dataIndex: number;
  /** 행 식별자 (불변, CRUD 안전) */
  rowId?: string | number;
  /** 행 데이터 */
  data: Row;
  /** 그룹 경로 */
  groupPath: string[];
  /** 행 변경 상태 (Dirty State) */
  rowState: RowState;
  /** 원본 데이터 (modified일 때) */
  originalData?: Row;
  /** 변경된 필드 목록 */
  changedFields?: Set<string>;
  /** 행 DOM 요소 */
  rowElement: HTMLElement;
  /** 셀 정보 맵 (columnKey → CellInfo) */
  cells: Record<string, CellInfo>;
}

/**
 * 그룹 헤더 포맷팅 컨텍스트
 */
export interface GroupHeaderContext {
  /** 뷰 인덱스 */
  viewIndex: number;
  /** 그룹 ID */
  groupId: string;
  /** 그룹 컬럼 */
  column: string;
  /** 그룹 값 */
  value: CellValue;
  /** 그룹 레벨 */
  level: number;
  /** 하위 항목 수 */
  itemCount: number;
  /** 접힘 상태 */
  collapsed: boolean;
  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
  /** 행 DOM 요소 */
  element: HTMLElement;
}

/**
 * 부분합 행 포맷팅 컨텍스트
 */
export interface SubtotalContext {
  /** 뷰 인덱스 */
  viewIndex: number;
  /** 레벨 */
  level: number;
  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
  /** 행 DOM 요소 */
  element: HTMLElement;
  /** 셀 정보 맵 */
  cells: Record<string, CellInfo>;
}

/**
 * 통합 포맷 정보 (Discriminated Union)
 */
export type FormatRowInfo =
  | { type: 'data'; ctx: DataRowContext }
  | { type: 'group-header'; ctx: GroupHeaderContext }
  | { type: 'subtotal'; ctx: SubtotalContext }
  | { type: 'grand-total'; ctx: SubtotalContext };

/**
 * formatRow 콜백 타입
 *
 * Wijmo formatItem보다 효율적인 행 단위 포맷팅 콜백입니다.
 * 1000행 × 20열 기준:
 * - formatItem: 20,000회 호출
 * - formatRow: 1,000회 호출 (20배 효율적)
 */
export type FormatRowCallback = (info: FormatRowInfo) => void;

/**
 * 집계 함수
 */
export type AggregateFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

/**
 * 선택 모드
 */
export type SelectionMode = 'none' | 'cell' | 'row' | 'range' | 'all';

/**
 * 테마
 */
export type Theme = 'light' | 'dark' | 'auto';

/**
 * 그리드 모드
 */
export type GridMode = 'flat' | 'pivot';

// ============================================================================
// 필드 정의
// ============================================================================

/**
 * 필드 정의
 *
 * 데이터 필드의 메타데이터를 정의합니다.
 * `columns` 배열에서 이 필드의 key를 참조하여 컬럼 배치를 결정합니다.
 *
 * @example
 * const fields: FieldDef[] = [
 *   { key: 'name', header: '이름', dataType: 'string', style: 'width: 200px;' },
 *   { key: 'age', header: '나이', dataType: 'number', aggregate: 'avg' },
 * ];
 */
export interface FieldDef {
  /** 필드 키 (데이터 객체의 키와 매칭) */
  key: string;

  /** 헤더에 표시할 이름 */
  header: string;

  /** 데이터 타입 */
  dataType: DataType;

  /** 집계 함수 (그룹핑/피벗 시 사용) */
  aggregate?: AggregateFunc;

  /** 스타일 (CSS 문자열) - width, flex 등 */
  style?: string;

  /** 너비 (픽셀) - style의 width 대신 사용 가능 */
  width?: number;

  /** 최소 너비 */
  minWidth?: number;

  /** 최대 너비 */
  maxWidth?: number;

  /** 정렬 가능 여부 @default true */
  sortable?: boolean;

  /** 필터 가능 여부 @default true */
  filterable?: boolean;

  /** 편집 가능 여부 @default false */
  editable?: boolean;

  /** 숨김 여부 @default false */
  hidden?: boolean;

  /** 셀 값 포맷터 */
  formatter?: (value: unknown) => string;
}

// ============================================================================
// 그룹핑 설정
// ============================================================================

/**
 * 그룹핑 설정 (Flat 모드용)
 */
export interface GroupConfig {
  /** 그룹핑 기준 컬럼 */
  columns: string[];

  /** 소계 표시할 컬럼 (fields의 aggregate 함수 사용) */
  subtotals?: string[];
}

// ============================================================================
// 컬럼 고정 설정
// ============================================================================

/**
 * 컬럼 고정 설정
 */
export interface PinnedConfig {
  /** 왼쪽 고정 컬럼 */
  left?: string[];

  /** 오른쪽 고정 컬럼 */
  right?: string[];
}

// ============================================================================
// PureSheet Config
// ============================================================================

/**
 * PureSheet 공통 설정
 */
export interface PureSheetConfigBase {
  // === 데이터 ===
  /** 데이터 */
  data?: Row[];

  /** 필드 정의 */
  fields: FieldDef[];

  // === UI 옵션 ===
  /** 테마 @default 'light' */
  theme?: Theme;

  /** 행 스타일 (CSS 문자열) */
  rowStyle?: string;

  /** 행 높이 (픽셀) - rowStyle의 height 대신 사용 가능 */
  rowHeight?: number;

  /** 헤더 스타일 (CSS 문자열) */
  headerStyle?: string;

  /** 헤더 높이 (픽셀) - headerStyle의 height 대신 사용 가능 */
  headerHeight?: number;

  /** 컬럼 리사이즈 가능 @default true */
  resizableColumns?: boolean;

  /** 컬럼 재정렬 가능 @default true */
  reorderableColumns?: boolean;

  /** 선택 모드 @default 'row' */
  selectionMode?: SelectionMode;

  /** 다중 선택 @default true */
  multiSelect?: boolean;

  /** 편집 가능 @default false */
  editable?: boolean;

  /** 체크박스 컬럼 표시 @default false */
  showCheckboxColumn?: boolean;

  // === 이벤트 핸들러 ===
  onRowClick?: (rowIndex: number, row: Row, event: MouseEvent) => void;
  onCellClick?: (position: { rowIndex: number; columnKey: string }, value: unknown, event: MouseEvent) => void;
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;

  // === formatRow 콜백 ===
  /**
   * 행 포맷팅 콜백
   *
   * 행이 렌더링될 때 호출됩니다.
   * Wijmo의 formatItem보다 효율적입니다 (행 단위 vs 셀 단위).
   *
   * @example
   * ```typescript
   * formatRow: (info) => {
   *   if (info.type === 'data') {
   *     const { rowState, cells, rowElement } = info.ctx;
   *
   *     // 음수 금액 강조
   *     if (cells['amount'].value < 0) {
   *       cells['amount'].element.classList.add('negative');
   *     }
   *
   *     // 삭제 예정 행 비활성화
   *     if (rowState === 'deleted') {
   *       rowElement.style.pointerEvents = 'none';
   *     }
   *   }
   * }
   * ```
   */
  formatRow?: FormatRowCallback;
}

/**
 * Flat 모드 설정
 */
export interface FlatModeConfig extends PureSheetConfigBase {
  /** 그리드 모드 */
  mode?: 'flat';

  /** 표시할 컬럼 목록 (fields의 key 참조) - 지정하지 않으면 fields 순서 사용 */
  columns?: string[];

  /** 고정 컬럼 */
  pinned?: PinnedConfig;

  /** 그룹핑 설정 */
  group?: GroupConfig;

  // Multi-Row 레이아웃
  rowTemplate?: RowTemplate;
}

/**
 * Pivot 모드 설정
 */
export interface PivotModeConfig extends PureSheetConfigBase {
  /** 그리드 모드 */
  mode: 'pivot';

  /** 행 축 필드 */
  rowFields?: string[];

  /** 열 축 필드 (피벗되는 필드) */
  columnFields: string[];

  /** 값 필드 */
  valueFields: string[];
}

/**
 * PureSheet 설정 (Flat 또는 Pivot)
 */
export type PureSheetConfig = FlatModeConfig | PivotModeConfig;

// ============================================================================
// Multi-Row 템플릿
// ============================================================================

/**
 * Multi-Row 셀 정의
 */
export interface RowTemplateCell {
  /** 필드 키 */
  key: string;

  /** 가로 병합 */
  colSpan?: number;

  /** 세로 병합 */
  rowSpan?: number;
}

/**
 * Multi-Row 템플릿
 */
export interface RowTemplate {
  /** 한 데이터 행이 차지할 시각적 행 수 */
  rowCount: number;

  /** 각 행의 셀 배치 */
  layout: RowTemplateCell[][];
}

// ============================================================================
// 유틸리티 타입
// ============================================================================

/**
 * 타입 가드: Flat 모드인지 확인
 */
export function isFlatMode(config: PureSheetConfig): config is FlatModeConfig {
  return config.mode === undefined || config.mode === 'flat';
}

/**
 * 타입 가드: Pivot 모드인지 확인
 */
export function isPivotMode(config: PureSheetConfig): config is PivotModeConfig {
  return config.mode === 'pivot';
}

