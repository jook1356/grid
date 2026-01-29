/**
 * ProcessorFactory - 프로세서 팩토리
 *
 * engine과 useWorker 옵션에 따라 적절한 프로세서를 생성합니다.
 *
 * 4가지 조합:
 * | engine | useWorker | 실행 방식          | 특징                    |
 * |--------|-----------|-------------------|------------------------|
 * | 'aq'   | false     | Main + Arquero    | 기본값, 가장 단순        |
 * | 'aq'   | true      | Worker + Arquero  | UI 블로킹 방지          |
 * | 'db'   | false     | Main + DuckDB     | 테스트/디버깅용          |
 * | 'db'   | true      | Worker + DuckDB   | 대량 데이터 + 복잡 집계  |
 *
 * @example
 * // 기본 설정 (Arquero, 메인 스레드)
 * const processor = createProcessor();
 *
 * // Worker 사용
 * const processor = createProcessor({ useWorker: true });
 *
 * // DuckDB + Worker
 * const processor = createProcessor({ engine: 'db', useWorker: true });
 */

import type { IDataProcessor } from '../types/processor.types';
import type { EngineType } from './engines/IEngine';
import { MainThreadProcessor } from './MainThreadProcessor';
import { WorkerProcessor } from './WorkerProcessor';

// ==========================================================================
// 옵션 타입
// ==========================================================================

/**
 * 프로세서 생성 옵션
 */
export interface ProcessorOptions {
  /**
   * 엔진 타입
   * - 'aq': Arquero (기본값) - 필터/정렬 위주, 번들 사이즈 민감
   * - 'db': DuckDB-Wasm - 복잡 집계 반복, 서버가 Arrow 제공
   */
  engine?: EngineType;

  /**
   * Worker 사용 여부
   * - false (기본값): 메인 스레드에서 실행
   * - true: Web Worker에서 실행 (UI 블로킹 방지)
   */
  useWorker?: boolean;
}

/**
 * 기본 프로세서 옵션
 */
export const DEFAULT_PROCESSOR_OPTIONS: Required<ProcessorOptions> = {
  engine: 'aq',
  useWorker: false,
};

// ==========================================================================
// 팩토리 함수
// ==========================================================================

/**
 * 프로세서 생성
 *
 * @param options - 프로세서 옵션
 * @returns IDataProcessor 구현체
 *
 * @example
 * // 기본 설정 (Arquero, 메인 스레드)
 * const processor = createProcessor();
 * await processor.initialize(data);
 * const result = await processor.filter([{ columnKey: 'age', operator: 'gte', value: 20 }]);
 *
 * @example
 * // Worker 사용 (UI 블로킹 방지)
 * const processor = createProcessor({ useWorker: true });
 * await processor.initialize(data);
 *
 * @example
 * // DuckDB + Worker (대용량 데이터, 복잡 집계)
 * const processor = createProcessor({ engine: 'db', useWorker: true });
 * await processor.initialize(data);
 */
export function createProcessor(options: ProcessorOptions = {}): IDataProcessor {
  const { engine, useWorker } = {
    ...DEFAULT_PROCESSOR_OPTIONS,
    ...options,
  };

  if (useWorker) {
    return new WorkerProcessor(engine);
  }

  return new MainThreadProcessor(engine);
}

// ==========================================================================
// 권장 설정 가이드
// ==========================================================================

/**
 * 권장 설정을 반환합니다.
 *
 * @param dataSize - 데이터 행 수
 * @param workload - 주요 작업 유형
 * @returns 권장 ProcessorOptions
 *
 * @example
 * const options = getRecommendedOptions(1000000, 'pivot');
 * // { engine: 'db', useWorker: true }
 */
export function getRecommendedOptions(
  dataSize: number,
  _workload: 'filter-sort' | 'aggregate' | 'pivot' | 'mixed' = 'filter-sort'
): ProcessorOptions {
  // 10만 건 미만: Arquero, 메인 스레드
  if (dataSize < 100_000) {
    return { engine: 'aq', useWorker: false };
  }

  // 10만 건 이상: Arquero + Worker
  return { engine: 'aq', useWorker: true };
}

// ==========================================================================
// 확장된 프로세서 인터페이스
// ==========================================================================

/**
 * 확장된 프로세서 인터페이스
 *
 * 기본 IDataProcessor에 피벗, 데이터 조회 등 추가 기능을 포함합니다.
 * MainThreadProcessor와 WorkerProcessor 모두 이 인터페이스를 구현합니다.
 *
 * Note: getRowCount(), getVisibleRowCount(), fetchVisibleRows()는
 * IDataProcessor에서 상속됩니다.
 */
export interface IExtendedProcessor extends IDataProcessor {
  /** 피벗 연산 */
  pivot?(config: import('../types/pivot.types').PivotConfig): Promise<import('../types/pivot.types').PivotResult>;

  /** 특정 인덱스의 Row들 반환 */
  getRows?(indices: number[]): Promise<import('../types/data.types').Row[]>;

  /** 전체 데이터 Row 배열로 반환 */
  getAllRows?(): Promise<import('../types/data.types').Row[]>;

  /** 특정 컬럼의 유니크 값 조회 */
  getUniqueValues?(columnKey: string): Promise<unknown[]>;

  /** 컬럼 키 목록 */
  getColumnKeys?(): string[];

  /** 엔진 타입 반환 */
  getEngineType?(): EngineType;
}

/**
 * 확장된 프로세서 생성
 *
 * 기본 createProcessor와 동일하지만, 반환 타입이 IExtendedProcessor입니다.
 */
export function createExtendedProcessor(options: ProcessorOptions = {}): IExtendedProcessor {
  return createProcessor(options) as IExtendedProcessor;
}
