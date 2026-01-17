/**
 * 데이터 타입 정의
 *
 * Grid에서 다루는 기본 데이터 구조를 정의합니다.
 * 이 타입들은 모든 모듈에서 공통으로 사용됩니다.
 */

// ============================================================================
// 셀 값 타입
// ============================================================================

/**
 * 셀 하나에 들어갈 수 있는 값의 타입
 *
 * @example
 * const name: CellValue = "홍길동";     // 문자열
 * const age: CellValue = 25;            // 숫자
 * const isActive: CellValue = true;     // 불리언
 * const birthDate: CellValue = new Date(); // 날짜
 * const empty: CellValue = null;        // 빈 값
 */
export type CellValue = string | number | boolean | Date | null | undefined;

// ============================================================================
// 행(Row) 타입
// ============================================================================

/**
 * 한 줄의 데이터 (행)
 *
 * 객체 형태로, 키는 컬럼 이름이고 값은 CellValue입니다.
 *
 * @example
 * const row: Row = {
 *   id: 1,
 *   name: "홍길동",
 *   age: 25,
 *   isActive: true
 * };
 */
export interface Row {
  /** 각 컬럼의 키와 값 */
  [columnKey: string]: CellValue;
}

// ============================================================================
// 컬럼(Column) 정의
// ============================================================================

/**
 * 컬럼의 데이터 타입
 *
 * 정렬, 필터링 등에서 타입에 맞는 처리를 하기 위해 사용됩니다.
 */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date';

/**
 * 컬럼 정의
 *
 * 각 컬럼의 메타데이터를 정의합니다.
 * Grid가 이 정보를 보고 어떻게 렌더링/처리할지 결정합니다.
 *
 * @example
 * const columns: ColumnDef[] = [
 *   { key: 'id', type: 'number', label: 'ID', width: 80 },
 *   { key: 'name', type: 'string', label: '이름', sortable: true },
 *   { key: 'age', type: 'number', label: '나이', filterable: true },
 * ];
 */
export interface ColumnDef {
  /** 컬럼 식별자 (Row 객체의 키와 매칭) */
  key: string;

  /** 데이터 타입 */
  type: ColumnType;

  /** 화면에 표시할 이름 (없으면 key 사용) */
  label?: string;

  /** 컬럼 너비 (픽셀) */
  width?: number;

  /** 최소 너비 */
  minWidth?: number;

  /** 최대 너비 */
  maxWidth?: number;

  /** 정렬 가능 여부 (기본값: true) */
  sortable?: boolean;

  /** 필터링 가능 여부 (기본값: true) */
  filterable?: boolean;

  /** 편집 가능 여부 (기본값: false) */
  editable?: boolean;

  /** 숨김 여부 (기본값: false) */
  hidden?: boolean;

  /** 고정 위치 ('left' | 'right' | undefined) */
  frozen?: 'left' | 'right';
}

// ============================================================================
// 데이터 변경 타입
// ============================================================================

/**
 * 행 변경 정보
 *
 * 어떤 행이 어떻게 변경되었는지 나타냅니다.
 * 실시간 업데이트나 되돌리기(Undo) 기능에 사용됩니다.
 */
export interface RowChange {
  /** 변경 유형 */
  type: 'add' | 'update' | 'remove';

  /** 변경된 행의 인덱스 */
  index: number;

  /** 이전 데이터 (update, remove 시) */
  oldData?: Row;

  /** 새 데이터 (add, update 시) */
  newData?: Row;
}
