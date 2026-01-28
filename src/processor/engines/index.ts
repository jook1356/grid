/**
 * 엔진 모듈 export
 *
 * 데이터 처리 엔진들을 export합니다.
 * 각 엔진은 IEngine 인터페이스를 구현합니다.
 */

// 인터페이스 및 타입
export type { IEngine, IEngineFactory, EngineType } from './IEngine';

// 엔진 구현체
export { ArqueroEngine } from './ArqueroEngine';
// [DEPRECATED] DuckDB 엔진 비활성화 - Arquero가 더 빠름
// export { DuckDBEngine } from './DuckDBEngine';
