/**
 * 피봇 관련 타입 정의
 *
 * 피봇 테이블의 설정과 결과 데이터를 정의합니다.
 * 헤더 렌더링 관련 계산은 PivotHeaderRenderer에서 처리합니다.
 */

/**
 * 피봇 컬럼 메타데이터
 *
 * 동적 생성된 각 컬럼의 피봇 관련 정보를 담습니다.
 * 이 정보를 바탕으로 PivotHeaderRenderer가 계층적 헤더를 구성합니다.
 */
export interface PivotColumnMeta {
  /** 컬럼 키 (예: "2022_Q1_sales") */
  columnKey: string;

  /** 컬럼 필드 값들 순서대로 (예: ["2022", "Q1"]) */
  pivotValues: string[];

  /** 값 필드 키 (예: "sales") */
  valueField: string;

  /** 값 필드 레이블 (예: "매출") */
  valueFieldLabel?: string;
}

/**
 * 피봇 설정
 *
 * PureSheet.setPivotConfig()에 전달되는 설정입니다.
 */
export interface PivotConfig {
  /** 행으로 유지될 필드 키 배열 */
  rowFields: string[];

  /** 열로 펼쳐질 필드 키 배열 */
  columnFields: string[];

  /** 값/집계 필드 설정 배열 */
  valueFields: PivotValueField[];

  /** 필터 조건 (선택) */
  filters?: import('./state.types').FilterState[];
}

/**
 * 피봇 값 필드 설정
 */
export interface PivotValueField {
  /** 집계할 필드 키 */
  field: string;

  /** 집계 함수 */
  aggregate: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

  /** 표시 레이블 (선택, 없으면 field 사용) */
  label?: string;
}

/**
 * 피봇 결과
 *
 * ArqueroProcessor.pivot()의 반환값입니다.
 */
export interface PivotResult {
  /** 피봇된 행 데이터 */
  rows: import('./data.types').Row[];

  /** 생성된 컬럼 정의 (행 필드 컬럼 + 동적 생성 컬럼) */
  columns: import('./data.types').ColumnDef[];

  /** 동적 생성된 컬럼의 메타데이터 (헤더 렌더링용) */
  pivotColumnMeta: PivotColumnMeta[];

  /** 행 필드 키 배열 (헤더 렌더링용) */
  rowFields: string[];

  /** 열 필드 키 배열 (헤더 레벨 수 계산용) */
  columnFields: string[];

  /** 값 필드가 여러 개인지 여부 (값 필드 헤더 레벨 표시 여부) */
  hasMultipleValueFields: boolean;
}
