/**
 * IEngine - 엔진 추상화 인터페이스
 *
 * Arquero와 DuckDB-Wasm을 동일한 인터페이스로 사용할 수 있도록 하는 추상화 계층입니다.
 * Worker와 Main Thread 모두에서 사용 가능한 순수 엔진 로직만 정의합니다.
 *
 * 021 아키텍처 결정:
 * - 각 엔진이 잘하는 영역이 다름
 * - Arquero: 필터/정렬 위주, 번들 사이즈 민감
 * - DuckDB: 복잡한 집계 반복, 서버가 Arrow 제공
 */

import type { Row, CellValue } from '../../types/data.types';
import type { SortState, FilterState } from '../../types/state.types';
import type {
  ProcessorResult,
  AggregateQueryOptions,
  AggregateResult,
} from '../../types/processor.types';
import type { PivotConfig, PivotResult } from '../../types/pivot.types';

// ============================================================================
// 엔진 타입
// ============================================================================

/**
 * 엔진 타입
 * - 'aq': Arquero (기본값, 필터/정렬 위주)
 * - 'db': DuckDB-Wasm (복잡 집계, 대용량)
 */
// [DEPRECATED] 'db' (DuckDB) 옵션 비활성화 - Arquero가 더 빠름
export type EngineType = 'aq';

// ============================================================================
// 엔진 인터페이스
// ============================================================================

/**
 * 엔진 인터페이스
 *
 * 모든 데이터 처리 엔진이 구현해야 하는 공통 인터페이스입니다.
 * Arquero, DuckDB-Wasm 등 다양한 엔진을 이 인터페이스로 추상화합니다.
 *
 * 설계 원칙:
 * 1. 비동기 우선: 모든 연산은 Promise 반환 (Worker 호환)
 * 2. 불변성: 원본 데이터는 절대 변경하지 않음
 * 3. 효율성: 결과는 인덱스 배열로 반환 (데이터 복사 최소화)
 */
export interface IEngine {
  // ==========================================================================
  // 데이터 로드
  // ==========================================================================

  /**
   * 데이터 로드 (Row 배열)
   *
   * Row 배열을 엔진 내부 형식으로 변환합니다.
   * - Arquero: aq.from(data) → Table
   * - DuckDB: Arrow Table → 등록
   *
   * @param data - 원본 데이터 배열
   */
  loadData(data: Row[]): Promise<void>;

  /**
   * Arrow IPC로 로드 (DuckDB 최적화용)
   *
   * 서버가 Arrow IPC 형식으로 데이터를 제공하는 경우,
   * 중간 변환 없이 바로 로드할 수 있습니다.
   *
   * @param ipcBytes - Arrow IPC 바이트 배열
   *
   * @optional - Arquero는 미구현, DuckDB만 지원
   */
  loadArrowIPC?(ipcBytes: Uint8Array): Promise<void>;

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  /**
   * 필터링
   *
   * @param filters - 필터 조건 배열 (AND 조합)
   * @returns 필터를 통과한 인덱스 배열
   */
  filter(filters: FilterState[]): Promise<ProcessorResult>;

  /**
   * 정렬
   *
   * @param sorts - 정렬 조건 배열 (다중 정렬)
   * @returns 정렬된 인덱스 배열
   */
  sort(sorts: SortState[]): Promise<ProcessorResult>;

  /**
   * 복합 쿼리 (필터 + 정렬)
   *
   * 개별 호출보다 효율적입니다.
   *
   * @param options - 쿼리 옵션
   * @returns 처리된 인덱스 배열
   */
  query(options: { filters?: FilterState[]; sorts?: SortState[] }): Promise<ProcessorResult>;

  // ==========================================================================
  // 집계
  // ==========================================================================

  /**
   * 그룹화 + 집계
   *
   * @param options - 집계 쿼리 옵션
   * @returns 그룹별 집계 결과
   */
  aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]>;

  // ==========================================================================
  // 피벗
  // ==========================================================================

  /**
   * 피벗 연산
   *
   * @param config - 피벗 설정
   * @returns 피벗 결과 (헤더 트리, 피벗 데이터, 컬럼 정의)
   */
  pivot(config: PivotConfig): Promise<PivotResult>;

  // ==========================================================================
  // 데이터 조회
  // ==========================================================================

  /**
   * 특정 인덱스의 Row들 반환
   *
   * @param indices - 조회할 인덱스 배열
   * @returns Row 배열
   */
  getRows(indices: number[]): Promise<Row[]>;

  /**
   * 전체 데이터 Row 배열로 반환
   *
   * @returns 전체 Row 배열
   */
  getAllRows(): Promise<Row[]>;

  /**
   * 특정 컬럼의 유니크 값 조회
   *
   * @param columnKey - 컬럼 키
   * @returns 유니크 값 배열
   */
  getUniqueValues(columnKey: string): Promise<CellValue[]>;

  // ==========================================================================
  // 메타데이터
  // ==========================================================================

  /**
   * 현재 로드된 행 수
   */
  getRowCount(): number;

  /**
   * 컬럼 키 목록
   */
  getColumnKeys(): string[];

  // ==========================================================================
  // 정리
  // ==========================================================================

  /**
   * 리소스 정리
   *
   * 메모리 해제, 연결 종료 등 정리 작업을 수행합니다.
   */
  cleanup(): Promise<void>;
}

// ============================================================================
// 엔진 팩토리 인터페이스
// ============================================================================

/**
 * 엔진 팩토리 인터페이스
 *
 * 엔진 인스턴스를 생성하는 팩토리입니다.
 * 동적 임포트를 통해 번들 사이즈를 최적화할 수 있습니다.
 */
export interface IEngineFactory {
  /**
   * 엔진 타입
   */
  readonly type: EngineType;

  /**
   * 엔진 인스턴스 생성
   */
  create(): Promise<IEngine>;
}
