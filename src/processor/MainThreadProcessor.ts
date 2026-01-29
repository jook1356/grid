/**
 * MainThreadProcessor - 메인 스레드에서 엔진을 직접 실행하는 프로세서
 *
 * IDataProcessor 인터페이스를 구현하며, 선택한 엔진(Arquero/DuckDB)을
 * 메인 스레드에서 직접 실행합니다.
 *
 * 특징:
 * - 단순한 구조로 디버깅 용이
 * - 소량 데이터에 적합
 * - UI 블로킹 가능성 있음 (대용량 데이터 시)
 *
 * 권장 사용 케이스:
 * - 10만 건 미만의 소량 데이터
 * - 간단한 연산 (필터/정렬)
 * - 개발/테스트 환경
 */

import type { IDataProcessor, ProcessorResult, QueryOptions, AggregateQueryOptions, AggregateResult } from '../types/processor.types';
import type { Row } from '../types/data.types';
import type { SortState, FilterState } from '../types/state.types';
import type { PivotConfig, PivotResult } from '../types/pivot.types';
import type { IEngine, EngineType } from './engines/IEngine';
import { ArqueroEngine } from './engines/ArqueroEngine';

/**
 * 메인 스레드 프로세서
 */
export class MainThreadProcessor implements IDataProcessor {
  /** 데이터 처리 엔진 */
  private engine: IEngine | null = null;

  /** 엔진 타입 */
  private engineType: EngineType;

  /** 현재 필터/정렬된 인덱스 배열 */
  private currentIndices: Uint32Array | null = null;

  constructor(engineType: EngineType = 'aq') {
    this.engineType = engineType;
  }

  // ==========================================================================
  // 초기화 / 정리
  // ==========================================================================

  async initialize(data: Row[]): Promise<void> {
    // 엔진 생성
    if (!this.engine) {
      this.engine = await this.createEngine();
    }

    // 데이터 로드
    await this.engine.loadData(data);

    // 초기 인덱스 배열 생성 (전체 행)
    const rowCount = this.engine.getRowCount();
    this.currentIndices = new Uint32Array(
      Array.from({ length: rowCount }, (_, i) => i)
    );
  }

  destroy(): void {
    if (this.engine) {
      this.engine.cleanup().catch(console.error);
      this.engine = null;
    }
    this.currentIndices = null;
  }

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.engine!.sort(sorts);
    this.currentIndices = result.indices;
    return result;
  }

  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.engine!.filter(filters);
    this.currentIndices = result.indices;
    return result;
  }

  async query(options: QueryOptions): Promise<ProcessorResult> {
    this.ensureInitialized();
    const result = await this.engine!.query(options);
    this.currentIndices = result.indices;
    return result;
  }

  // ==========================================================================
  // 집계
  // ==========================================================================

  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    this.ensureInitialized();
    return this.engine!.aggregate(options);
  }

  // ==========================================================================
  // 피벗 (확장 기능)
  // ==========================================================================

  /**
   * 피벗 연산
   *
   * 기본 IDataProcessor에는 없지만, 엔진이 지원하는 경우 사용 가능합니다.
   */
  async pivot(config: PivotConfig): Promise<PivotResult> {
    this.ensureInitialized();
    return this.engine!.pivot(config);
  }

  // ==========================================================================
  // 데이터 조회 (확장 기능)
  // ==========================================================================

  /**
   * 특정 인덱스의 Row들 반환
   */
  async getRows(indices: number[]): Promise<Row[]> {
    this.ensureInitialized();
    return this.engine!.getRows(indices);
  }

  /**
   * 전체 데이터 Row 배열로 반환
   */
  async getAllRows(): Promise<Row[]> {
    this.ensureInitialized();
    return this.engine!.getAllRows();
  }

  /**
   * 특정 컬럼의 유니크 값 조회
   */
  async getUniqueValues(columnKey: string): Promise<unknown[]> {
    this.ensureInitialized();
    return this.engine!.getUniqueValues(columnKey);
  }

  // ==========================================================================
  // 가상 데이터 로딩 (Worker 호환)
  // ==========================================================================

  /**
   * 가시 영역의 행 데이터를 가져옵니다.
   *
   * Main Thread 모드에서는 이미 로드된 데이터에서 추출합니다.
   * Worker 모드와 동일한 인터페이스를 제공합니다.
   *
   * @param startIndex - 시작 인덱스 (필터/정렬 후 순서, inclusive)
   * @param endIndex - 끝 인덱스 (exclusive)
   * @returns 해당 범위의 Row 배열
   */
  async fetchVisibleRows(startIndex: number, endIndex: number): Promise<Row[]> {
    this.ensureInitialized();

    // 현재 인덱스 배열이 없으면 전체 데이터 기준
    const indices = this.currentIndices ?? new Uint32Array(
      Array.from({ length: this.engine!.getRowCount() }, (_, i) => i)
    );

    // 범위 내 인덱스 추출
    const rangeIndices: number[] = [];
    for (let i = startIndex; i < Math.min(endIndex, indices.length); i++) {
      rangeIndices.push(indices[i]!);
    }

    // 해당 행들 조회
    return this.engine!.getRows(rangeIndices);
  }

  /**
   * 현재 필터/정렬 후 총 행 수 (스크롤바 계산용)
   */
  getVisibleRowCount(): number {
    return this.currentIndices?.length ?? this.engine?.getRowCount() ?? 0;
  }

  // ==========================================================================
  // 메타데이터 (확장 기능)
  // ==========================================================================

  /**
   * 전체 행 수 (필터 적용 전)
   */
  getRowCount(): number {
    return this.engine?.getRowCount() ?? 0;
  }

  /**
   * 컬럼 키 목록
   */
  getColumnKeys(): string[] {
    return this.engine?.getColumnKeys() ?? [];
  }

  /**
   * 엔진 타입 반환
   */
  getEngineType(): EngineType {
    return this.engineType;
  }

  // ==========================================================================
  // 내부 헬퍼
  // ==========================================================================

  /** 엔진 생성 */
  private async createEngine(): Promise<IEngine> {
    // [DEPRECATED] DuckDB 엔진 비활성화 - Arquero가 더 빠름
    // if (this.engineType === 'db') {
    //   const { DuckDBEngine } = await import('./engines/DuckDBEngine');
    //   return new DuckDBEngine();
    // }

    // 기본값: Arquero
    return new ArqueroEngine();
  }

  /** 초기화 확인 */
  private ensureInitialized(): void {
    if (!this.engine) {
      throw new Error('MainThreadProcessor not initialized. Call initialize() first.');
    }
  }
}
