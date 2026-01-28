/**
 * 프로세서 모듈
 *
 * 데이터 처리 로직을 담당합니다.
 * Arquero와 DuckDB-Wasm 두 가지 엔진을 지원하며,
 * 메인 스레드 또는 Web Worker에서 실행할 수 있습니다.
 *
 * 구성:
 * - engines/: 순수 엔진 로직 (IEngine, ArqueroEngine, DuckDBEngine)
 * - MainThreadProcessor: 메인 스레드에서 엔진 직접 실행
 * - WorkerProcessor: Web Worker 경유 실행
 * - ProcessorFactory: 옵션에 따라 적절한 프로세서 생성
 *
 * 레거시 (호환성 유지):
 * - ArqueroProcessor: 기존 Arquero 기반 프로세서
 * - PivotProcessor: 피벗 연산 전용
 */

// ==========================================================================
// 새로운 아키텍처 (021-engine-abstraction-architecture)
// ==========================================================================

// 엔진
export type { IEngine, IEngineFactory, EngineType } from './engines';
export { ArqueroEngine } from './engines';
// [DEPRECATED] DuckDB 엔진 비활성화
// export { DuckDBEngine } from './engines';

// 프로세서
export { MainThreadProcessor } from './MainThreadProcessor';
export { WorkerProcessor } from './WorkerProcessor';

// 팩토리
export {
  createProcessor,
  createExtendedProcessor,
  getRecommendedOptions,
  DEFAULT_PROCESSOR_OPTIONS,
} from './ProcessorFactory';
export type { ProcessorOptions, IExtendedProcessor } from './ProcessorFactory';

// ==========================================================================
// 레거시 (호환성 유지)
// ==========================================================================

export { ArqueroProcessor } from './ArqueroProcessor';
export { PivotProcessor } from './PivotProcessor';
