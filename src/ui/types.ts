/**
 * UI Layer 타입 정의
 *
 * 이 파일은 UI 레이어에서 사용하는 모든 타입을 정의합니다.
 * - 셀 위치, 선택 상태, 에디터 설정 등
 */

import type { CellValue, ColumnDef, Row } from '../types';

// =============================================================================
// 셀 위치
// =============================================================================

/**
 * 셀의 위치를 나타내는 인터페이스
 */
export interface CellPosition {
  /** 행 인덱스 (뷰 기준) */
  rowIndex: number;
  /** 컬럼 키 */
  columnKey: string;
  /** 행 ID (데이터 기준) */
  rowId?: string | number;
}

// =============================================================================
// 컬럼 상태
// =============================================================================

/**
 * 컬럼의 고정 위치
 */
export type PinPosition = 'left' | 'right' | 'none';

/**
 * 컬럼의 현재 상태
 */
export interface ColumnState {
  /** 컬럼 키 */
  key: string;
  /** 현재 너비 (px) */
  width: number;
  /** 고정 위치 */
  pinned: PinPosition;
  /** 표시 여부 */
  visible: boolean;
  /** 표시 순서 */
  order: number;
}

// =============================================================================
// 선택 상태
// =============================================================================

/**
 * 선택 모드
 */
export type SelectionMode = 'row' | 'cell' | 'range' | 'none';

/**
 * 선택 상태
 */
export interface SelectionState {
  /** 선택된 행 ID 집합 */
  selectedRows: Set<string | number>;
  /** 선택된 셀 맵 (key: "rowIndex:columnKey") */
  selectedCells: Map<string, CellPosition>;
  /** 현재 포커스된 셀 */
  focusedCell: CellPosition | null;
  /** 선택 모드 */
  selectionMode: SelectionMode;
  /** Shift 선택 시작점 (앵커) */
  anchorCell: CellPosition | null;
}

// =============================================================================
// 에디터 설정
// =============================================================================

/**
 * 에디터 타입
 */
export type EditorType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'custom';

/**
 * 에디터 설정
 */
export interface EditorConfig {
  /** 에디터 타입 */
  type: EditorType;
  /** select 에디터용 옵션 목록 */
  options?: { value: unknown; label: string }[];
  /** 값 유효성 검사 함수 */
  validator?: (value: CellValue) => boolean | string;
  /** 표시용 포맷터 */
  formatter?: (value: CellValue) => string;
  /** 입력값 파서 */
  parser?: (input: string) => CellValue;
}

// =============================================================================
// 가상 스크롤러 설정
// =============================================================================

/**
 * VirtualScroller 설정
 */
export interface VirtualScrollerOptions {
  /**
   * 초기 예상 행 높이 (픽셀)
   * @default 40
   */
  estimatedRowHeight?: number;

  /**
   * 평균 계산에 사용할 샘플 수
   * @default 50
   */
  sampleSize?: number;

  /**
   * 버퍼 행 수 (위/아래 추가 렌더링)
   * @default 5
   */
  overscan?: number;
}

/**
 * 가상 스크롤 상태
 */
export interface VirtualScrollState {
  /** 시작 행 인덱스 */
  startIndex: number;
  /** 끝 행 인덱스 */
  endIndex: number;
  /** 현재 스크롤 위치 (px) */
  scrollTop: number;
  /** 총 높이 (px) */
  totalHeight: number;
}

// =============================================================================
// PureSheet 옵션
// =============================================================================

/**
 * 테마 타입
 */
export type ThemeType = 'light' | 'dark' | 'auto';

/**
 * PureSheet 초기화 옵션
 */
export interface PureSheetOptions {
  /** 컬럼 정의 */
  columns: ColumnDef[];

  /** 초기 데이터 */
  data?: Row[];

  /** 기본 행 높이 (px) @default 36 */
  rowHeight?: number;

  /** 헤더 높이 (px) @default 40 */
  headerHeight?: number;

  /** 선택 모드 @default 'row' */
  selectionMode?: SelectionMode;

  /** 다중 선택 허용 @default true */
  multiSelect?: boolean;

  /** 체크박스 컬럼 표시 @default false */
  showCheckboxColumn?: boolean;

  /** 편집 가능 여부 @default false */
  editable?: boolean;

  /** 컬럼 리사이즈 가능 @default true */
  resizableColumns?: boolean;

  /** 컬럼 재정렬 가능 @default true */
  reorderableColumns?: boolean;

  /** 테마 @default 'light' */
  theme?: ThemeType;
}

// =============================================================================
// 렌더링 관련
// =============================================================================

/**
 * 행 렌더링 정보
 */
export interface RowRenderInfo {
  /** 행 인덱스 (뷰 기준) */
  index: number;
  /** 행 데이터 */
  data: Row;
  /** Y 위치 (transform용) */
  offsetY: number;
  /** 행 높이 */
  height: number;
  /** 선택 여부 */
  selected: boolean;
}

/**
 * 컬럼 렌더링 그룹
 */
export interface ColumnGroups {
  /** 왼쪽 고정 컬럼 */
  left: ColumnState[];
  /** 중앙 스크롤 컬럼 */
  center: ColumnState[];
  /** 오른쪽 고정 컬럼 */
  right: ColumnState[];
}

// =============================================================================
// 이벤트 페이로드
// =============================================================================

/**
 * 행 클릭 이벤트 페이로드
 */
export interface RowClickPayload {
  row: Row;
  rowIndex: number;
  event: MouseEvent;
}

/**
 * 셀 클릭 이벤트 페이로드
 */
export interface CellClickPayload {
  row: Row;
  columnKey: string;
  value: CellValue;
  event: MouseEvent;
}

/**
 * 셀 변경 이벤트 페이로드
 */
export interface CellChangePayload {
  row: Row;
  columnKey: string;
  oldValue: CellValue;
  newValue: CellValue;
}

/**
 * 컬럼 리사이즈 이벤트 페이로드
 */
export interface ColumnResizePayload {
  columnKey: string;
  width: number;
}

/**
 * 스크롤 이벤트 페이로드
 */
export interface ScrollPayload {
  scrollTop: number;
  scrollLeft: number;
}
