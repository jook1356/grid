/**
 * FilterTransformer - 필터 변환기
 *
 * 데이터를 필터링하여 조건에 맞는 행의 인덱스만 반환합니다.
 * 실제 데이터는 변경하지 않고 인덱스 배열만 업데이트합니다.
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, FilterState, FilterOperator, CellValue } from '../../types';
import type { Transformer, TransformContext, FilterTransformerConfig } from './Transformer';
import { PipelinePhase, cloneContext } from './Transformer';

// =============================================================================
// FilterTransformer 클래스
// =============================================================================

/**
 * 필터 변환기
 *
 * 조건에 맞는 행의 인덱스를 계산합니다.
 * Worker에서 실행되어 메인 스레드를 블로킹하지 않습니다.
 */
export class FilterTransformer implements Transformer {
  readonly name = 'FilterTransformer';
  readonly phase = PipelinePhase.PRE_TRANSFORM;
  readonly runInWorker = true;

  /** 필터 설정 */
  private filters: FilterState[] = [];

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(filters: FilterState[] = []) {
    this.filters = filters;
  }

  // ==========================================================================
  // Transformer 구현
  // ==========================================================================

  /**
   * 설정 업데이트
   */
  configure(config: Partial<FilterTransformerConfig>): void {
    if (config.filters !== undefined) {
      this.filters = config.filters;
    }
  }

  /**
   * 필터 변환 실행
   *
   * @param ctx - 입력 컨텍스트
   * @returns 필터링된 인덱스가 포함된 컨텍스트
   */
  transform(ctx: TransformContext): TransformContext {
    // 필터가 없으면 그대로 반환
    if (this.filters.length === 0) {
      return ctx;
    }

    const result = cloneContext(ctx);
    const { data, indices } = ctx;

    // 현재 유효한 인덱스 결정
    const sourceIndices = indices ?? this.createSequentialIndices(data.length);

    // 필터 적용
    const filteredIndices = this.applyFilters(data, sourceIndices);

    result.indices = filteredIndices;
    return result;
  }

  // ==========================================================================
  // 필터 로직
  // ==========================================================================

  /**
   * 필터 적용
   */
  private applyFilters(data: RowData[], indices: Uint32Array): Uint32Array {
    const passedIndices: number[] = [];

    for (let i = 0; i < indices.length; i++) {
      const dataIndex = indices[i]!;
      const row = data[dataIndex];
      
      if (row && this.rowMatchesFilters(row)) {
        passedIndices.push(dataIndex);
      }
    }

    return new Uint32Array(passedIndices);
  }

  /**
   * 행이 모든 필터 조건을 만족하는지 확인
   */
  private rowMatchesFilters(row: RowData): boolean {
    // AND 조합: 모든 필터를 만족해야 함
    return this.filters.every(filter => this.rowMatchesFilter(row, filter));
  }

  /**
   * 행이 단일 필터 조건을 만족하는지 확인
   */
  private rowMatchesFilter(row: RowData, filter: FilterState): boolean {
    const value = row[filter.columnKey] as CellValue;
    const filterValue = filter.value;
    const operator = filter.operator;

    return this.evaluateCondition(value, operator, filterValue);
  }

  /**
   * 필터 조건 평가
   */
  private evaluateCondition(
    value: CellValue,
    operator: FilterOperator,
    filterValue: unknown
  ): boolean {
    // null/undefined 처리
    if (value === null || value === undefined) {
      if (operator === 'isNull') return true;
      if (operator === 'isNotNull') return false;
      return false; // 다른 연산자는 null/undefined에 대해 false
    }

    switch (operator) {
      case 'eq':
        return value === filterValue;

      case 'neq':
        return value !== filterValue;

      case 'gt':
        return typeof value === 'number' && typeof filterValue === 'number' && value > filterValue;

      case 'gte':
        return typeof value === 'number' && typeof filterValue === 'number' && value >= filterValue;

      case 'lt':
        return typeof value === 'number' && typeof filterValue === 'number' && value < filterValue;

      case 'lte':
        return typeof value === 'number' && typeof filterValue === 'number' && value <= filterValue;

      case 'contains':
        return typeof value === 'string' && 
               typeof filterValue === 'string' && 
               value.toLowerCase().includes(filterValue.toLowerCase());

      case 'notContains':
        return typeof value === 'string' && 
               typeof filterValue === 'string' && 
               !value.toLowerCase().includes(filterValue.toLowerCase());

      case 'startsWith':
        return typeof value === 'string' && 
               typeof filterValue === 'string' && 
               value.toLowerCase().startsWith(filterValue.toLowerCase());

      case 'endsWith':
        return typeof value === 'string' && 
               typeof filterValue === 'string' && 
               value.toLowerCase().endsWith(filterValue.toLowerCase());

      case 'between':
        // between uses value and value2 in FilterState
        // For now, handle array format as well
        if (Array.isArray(filterValue) && filterValue.length === 2) {
          const [min, max] = filterValue;
          return typeof value === 'number' && 
                 typeof min === 'number' && 
                 typeof max === 'number' && 
                 value >= min && value <= max;
        }
        return false;

      case 'isNull':
        return value === null || value === undefined;

      case 'isNotNull':
        return value !== null && value !== undefined;

      // TODO: Add support for 'in', 'notIn', 'isEmpty', 'isNotEmpty', 'regex' 
      // when FilterOperator type is extended

      default:
        console.warn(`FilterTransformer: Unknown operator "${operator}"`);
        return true;
    }
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * 순차 인덱스 배열 생성
   */
  private createSequentialIndices(length: number): Uint32Array {
    const indices = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      indices[i] = i;
    }
    return indices;
  }

  /**
   * 필터 설정 반환
   */
  getFilters(): FilterState[] {
    return [...this.filters];
  }

  /**
   * 필터 설정 변경
   */
  setFilters(filters: FilterState[]): void {
    this.filters = filters;
  }
}
