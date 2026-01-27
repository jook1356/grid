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

  /** 데이터 타입 (선택적 - 기본값: 'string') */
  type?: ColumnType;

  /** 화면에 표시할 이름 (없으면 key 사용) */
  label?: string;

  /** 헤더에 표시할 이름 (label의 별칭) */
  header?: string;

  /** 컬럼 너비 - 숫자(픽셀) 또는 CSS 문자열('150px', '20rem', '15%', 'auto') */
  width?: number | string;

  /** 최소 너비 - 숫자(픽셀) 또는 CSS 문자열 */
  minWidth?: number | string;

  /** 최대 너비 - 숫자(픽셀) 또는 CSS 문자열 */
  maxWidth?: number | string;

  /** flex 비율 - 남은 공간을 비율로 분배 (드래그 리사이즈 시 자동 제거) */
  flex?: number;

  /** 정렬 가능 여부 (기본값: true) */
  sortable?: boolean;

  /** 필터링 가능 여부 (기본값: true) */
  filterable?: boolean;

  /** 편집 가능 여부 (기본값: false) */
  editable?: boolean;

  /** 읽기 전용 여부 - true면 전역 editable 설정과 관계없이 편집 불가 (기본값: false) */
  readonly?: boolean;

  /** 숨김 여부 (기본값: false) */
  hidden?: boolean;

  /** 고정 위치 ('left' | 'right' | undefined) */
  frozen?: 'left' | 'right';

  /** 고정 위치 (frozen의 별칭) */
  pinned?: 'left' | 'right';

  /** 셀 값 포맷터 */
  formatter?: (value: CellValue) => string;

  /** 병합 전략 (피벗용) */
  mergeStrategy?: 'same-value' | 'none';

  /** 표시 여부 (기본값: true) */
  visible?: boolean;

  /** 에디터 설정 */
  editorConfig?: {
    type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'custom';
    options?: { value: unknown; label: string }[];
    validator?: (value: CellValue) => boolean | string;
    formatter?: (value: CellValue) => string;
    parser?: (input: string) => CellValue;
  };

  // ==========================================================================
  // 피벗 전용 속성
  // ==========================================================================

  /**
   * 피벗 컬럼 타입
   * - 'data': 일반 데이터 컬럼 (기본값)
   * - 'subtotal': 소계 컬럼 (showColumnSubTotals에 의해 생성)
   * - 'grandtotal': 총합계 컬럼 (showColumnGrandTotals에 의해 생성)
   */
  pivotType?: 'data' | 'subtotal' | 'grandtotal';

  /**
   * 구조적 컬럼 여부 (Row의 structural과 동일한 개념)
   * - true: 선택/집계에서 제외
   * - false: 일반 데이터 컬럼 (기본값)
   *
   * 용도:
   * - 드래그 선택 후 집계 시 제외
   * - 복사/붙여넣기 시 제외 가능
   */
  structural?: boolean;
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
