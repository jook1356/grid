/**
 * 프로세서 모듈
 *
 * Web Worker에서 실행되는 데이터 처리 로직입니다.
 * Arquero를 사용하여 정렬, 필터링, 집계 등을 수행합니다.
 *
 * 구성:
 * - ArqueroProcessor: Arquero 기반 데이터 처리 (Worker 내부)
 * - WorkerBridge: Worker 통신 브릿지 (메인 스레드)
 * - worker.ts: Worker 엔트리포인트
 * - pipeline/: 데이터 변환 파이프라인 (Transformer 기반)
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

export { WorkerBridge } from './WorkerBridge';
export { ArqueroProcessor } from './ArqueroProcessor';

// Pipeline 모듈
export * from './pipeline';
