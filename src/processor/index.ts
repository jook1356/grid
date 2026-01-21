/**
 * 프로세서 모듈
 *
 * 메인 스레드에서 실행되는 데이터 처리 로직입니다.
 * Arquero를 사용하여 정렬, 필터링, 집계, 피벗 등을 수행합니다.
 *
 * 구성:
 * - ArqueroProcessor: Arquero 기반 데이터 처리 (정렬, 필터, 집계)
 * - PivotProcessor: 피벗 연산 전용 (ArqueroProcessor 확장)
 */

export { ArqueroProcessor } from './ArqueroProcessor';
export { PivotProcessor } from './PivotProcessor';
