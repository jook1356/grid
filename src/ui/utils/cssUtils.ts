/**
 * CSS 유틸리티 함수
 *
 * 컬럼 너비 등 CSS 값 처리를 위한 유틸리티입니다.
 */

/**
 * 숫자 또는 문자열을 CSS 값으로 변환
 *
 * - 숫자: px 단위 추가 (예: 150 → '150px')
 * - 문자열: 그대로 반환 (예: '20rem' → '20rem')
 * - undefined: undefined 반환
 *
 * @example
 * toCSSValue(150)      // '150px'
 * toCSSValue('20rem')  // '20rem'
 * toCSSValue('auto')   // 'auto'
 * toCSSValue(undefined) // undefined
 */
export function toCSSValue(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

/**
 * 기본 컬럼 너비 (px)
 */
export const DEFAULT_COLUMN_WIDTH = 150;

/**
 * 최소 컬럼 너비 (px) - 리사이즈 제한용
 */
export const MIN_COLUMN_WIDTH = 50;
