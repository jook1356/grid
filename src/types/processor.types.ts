/**
 * 프로세서 타입 정의
 *
 * Web Worker에서 실행되는 데이터 처리기의 인터페이스입니다.
 * 이 인터페이스를 구현하면 Arquero 대신 다른 라이브러리로 교체할 수 있습니다.
 *
 * 이것이 "의존성 역전" 원칙입니다:
 * - GridCore는 ArqueroProcessor를 직접 의존하지 않음
 * - GridCore는 IDataProcessor 인터페이스에 의존
 * - ArqueroProcessor가 IDataProcessor를 구현
 */

import type { Row, CellValue } from './data.types';
import type { SortState, FilterState } from './state.types';

// ============================================================================
// 처리 결과 타입
// ============================================================================

/**
 * 프로세서 처리 결과
 *
 * 정렬, 필터링 후 결과를 담습니다.
 * 원본 데이터를 복사하지 않고, 인덱스 배열만 반환합니다.
 *
 * @example
 * // 100만 건 중 50만 건이 필터를 통과했다면:
 * {
 *   indices: Uint32Array([3, 5, 7, 12, ...]),  // 통과한 행들의 인덱스
 *   totalCount: 1000000,     // 전체 행 수
 *   filteredCount: 500000    // 필터 통과한 행 수
 * }
 */
export interface ProcessorResult {
  /**
   * 결과 행들의 원본 인덱스 배열
   *
   * Uint32Array를 사용하는 이유:
   * 1. 메모리 효율: 일반 배열보다 4배 적은 메모리
   * 2. Transferable: Worker↔메인 스레드 간 복사 없이 전송 가능
   * 3. 성능: TypedArray는 연속 메모리로 캐시 효율 높음
   */
  indices: Uint32Array;

  /** 전체 행 수 (필터 적용 전) */
  totalCount: number;

  /** 필터링 후 행 수 */
  filteredCount: number;
}

// ============================================================================
// 집계 타입
// ============================================================================

/**
 * 집계 함수 종류
 */
export type AggregateFunction = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

/**
 * 집계 옵션
 *
 * 어떤 컬럼에 어떤 집계 함수를 적용할지 정의합니다.
 */
export interface AggregateOption {
  /** 집계할 컬럼 키 */
  columnKey: string;

  /** 집계 함수 */
  function: AggregateFunction;

  /** 결과 별칭 (없으면 자동 생성: 예 "sum_salary") */
  alias?: string;
}

/**
 * 집계 결과
 *
 * 그룹화 + 집계 결과를 담습니다.
 */
export interface AggregateResult {
  /** 그룹 키 (여러 컬럼으로 그룹화 시 조합) */
  groupKey: string;

  /** 그룹을 구성하는 값들 */
  groupValues: Record<string, CellValue>;

  /** 집계 결과들 */
  aggregates: Record<string, CellValue>;

  /** 이 그룹에 속한 행 수 */
  count: number;
}

// ============================================================================
// 쿼리 옵션
// ============================================================================

/**
 * 쿼리 옵션
 *
 * 정렬 + 필터를 한 번에 요청할 때 사용합니다.
 */
export interface QueryOptions {
  /** 정렬 조건들 */
  sorts?: SortState[];

  /** 필터 조건들 */
  filters?: FilterState[];
}

/**
 * 집계 쿼리 옵션
 */
export interface AggregateQueryOptions {
  /** 그룹화할 컬럼들 */
  groupBy: string[];

  /** 집계 옵션들 */
  aggregates: AggregateOption[];

  /** 필터 조건들 (집계 전 적용) */
  filters?: FilterState[];
}

// ============================================================================
// 프로세서 인터페이스
// ============================================================================

/**
 * 데이터 프로세서 인터페이스
 *
 * 이 인터페이스를 구현하는 클래스는 정렬, 필터링, 집계 등을 수행합니다.
 * 현재는 Arquero로 구현하지만, 나중에 다른 라이브러리로 교체할 수 있습니다.
 *
 * @example
 * // Arquero로 구현
 * class ArqueroProcessor implements IDataProcessor {
 *   async initialize(data: Row[]): Promise<void> {
 *     this.table = aq.from(data);
 *   }
 *   // ...
 * }
 *
 * // 나중에 DuckDB로 교체 가능
 * class DuckDBProcessor implements IDataProcessor {
 *   // 같은 인터페이스, 다른 구현
 * }
 */
export interface IDataProcessor {
  /**
   * 데이터 초기화
   *
   * 원본 데이터를 받아서 내부 구조로 변환합니다.
   * Arquero의 경우 Table로 변환합니다.
   *
   * @param data - 원본 데이터 배열
   */
  initialize(data: Row[]): Promise<void>;

  /**
   * 리소스 정리
   *
   * 메모리 해제 등 정리 작업을 수행합니다.
   */
  destroy(): void;

  /**
   * 정렬
   *
   * @param sorts - 정렬 조건들 (다중 정렬 지원)
   * @returns 정렬된 인덱스 배열
   */
  sort(sorts: SortState[]): Promise<ProcessorResult>;

  /**
   * 필터링
   *
   * @param filters - 필터 조건들 (AND 조합)
   * @returns 필터를 통과한 인덱스 배열
   */
  filter(filters: FilterState[]): Promise<ProcessorResult>;

  /**
   * 복합 쿼리 (정렬 + 필터)
   *
   * 정렬과 필터를 한 번에 요청합니다.
   * 개별 호출보다 효율적입니다.
   *
   * @param options - 쿼리 옵션
   * @returns 처리된 인덱스 배열
   */
  query(options: QueryOptions): Promise<ProcessorResult>;

  /**
   * 집계
   *
   * 그룹화 + 집계 함수를 실행합니다.
   *
   * @param options - 집계 쿼리 옵션
   * @returns 그룹별 집계 결과
   */
  aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]>;
}

// ============================================================================
// Worker 메시지 타입
// ============================================================================

/**
 * Worker로 보내는 메시지 타입
 */
export type WorkerRequestType =
  | 'INITIALIZE'
  | 'SORT'
  | 'FILTER'
  | 'QUERY'
  | 'AGGREGATE'
  | 'PIVOT'
  | 'DESTROY';

/**
 * Worker에서 받는 메시지 타입
 */
export type WorkerResponseType =
  | 'RESULT'
  | 'ERROR'
  | 'PROGRESS';

/**
 * Worker 요청 메시지
 */
export interface WorkerRequest<T = unknown> {
  /** 요청 ID (응답과 매칭용) */
  id: number;

  /** 요청 타입 */
  type: WorkerRequestType;

  /** 요청 데이터 */
  payload: T;
}

/**
 * Worker 응답 메시지
 */
export interface WorkerResponse<T = unknown> {
  /** 요청 ID (요청과 매칭) */
  id: number;

  /** 응답 타입 */
  type: WorkerResponseType;

  /** 응답 데이터 */
  payload?: T;

  /** 에러 메시지 (에러 시) */
  error?: string;
}
