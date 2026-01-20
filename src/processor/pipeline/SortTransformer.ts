/**
 * SortTransformer - 정렬 변환기
 *
 * 데이터를 정렬하여 정렬된 인덱스 배열을 반환합니다.
 * 실제 데이터는 변경하지 않고 인덱스 배열만 재정렬합니다.
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, SortState, CellValue } from '../../types';
import type { Transformer, TransformContext, SortTransformerConfig } from './Transformer';
import { PipelinePhase, cloneContext } from './Transformer';

// =============================================================================
// SortTransformer 클래스
// =============================================================================

/**
 * 정렬 변환기
 *
 * 인덱스 배열을 정렬 조건에 따라 재정렬합니다.
 * Worker에서 실행되어 메인 스레드를 블로킹하지 않습니다.
 */
export class SortTransformer implements Transformer {
  readonly name = 'SortTransformer';
  readonly phase = PipelinePhase.SORT;
  readonly runInWorker = true;

  /** 정렬 설정 */
  private sorts: SortState[] = [];

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(sorts: SortState[] = []) {
    this.sorts = sorts;
  }

  // ==========================================================================
  // Transformer 구현
  // ==========================================================================

  /**
   * 설정 업데이트
   */
  configure(config: Partial<SortTransformerConfig>): void {
    if (config.sorts !== undefined) {
      this.sorts = config.sorts;
    }
  }

  /**
   * 정렬 변환 실행
   *
   * @param ctx - 입력 컨텍스트
   * @returns 정렬된 인덱스가 포함된 컨텍스트
   */
  transform(ctx: TransformContext): TransformContext {
    // 정렬 조건이 없으면 그대로 반환
    if (this.sorts.length === 0) {
      return ctx;
    }

    const result = cloneContext(ctx);
    const { data, indices } = ctx;

    // 현재 유효한 인덱스 결정
    const sourceIndices = indices ?? this.createSequentialIndices(data.length);

    // 정렬 적용
    const sortedIndices = this.applySorts(data, sourceIndices);

    result.indices = sortedIndices;
    return result;
  }

  // ==========================================================================
  // 정렬 로직
  // ==========================================================================

  /**
   * 정렬 적용
   */
  private applySorts(data: RowData[], indices: Uint32Array): Uint32Array {
    // Uint32Array를 일반 배열로 변환 (sort를 위해)
    const indicesArray = Array.from(indices);

    // 다중 정렬 적용
    indicesArray.sort((indexA, indexB) => {
      return this.compareRows(data[indexA], data[indexB]);
    });

    return new Uint32Array(indicesArray);
  }

  /**
   * 두 행 비교 (다중 정렬)
   */
  private compareRows(rowA: RowData | undefined, rowB: RowData | undefined): number {
    if (!rowA || !rowB) {
      return 0;
    }

    for (const sort of this.sorts) {
      const valueA = rowA[sort.columnKey] as CellValue;
      const valueB = rowB[sort.columnKey] as CellValue;
      const direction = sort.direction;

      const comparison = this.compareValues(valueA, valueB);
      if (comparison !== 0) {
        return direction === 'asc' ? comparison : -comparison;
      }
    }

    return 0;
  }

  /**
   * 두 값 비교
   */
  private compareValues(a: CellValue, b: CellValue): number {
    // null/undefined 처리 (null은 항상 마지막)
    const aIsNull = a === null || a === undefined;
    const bIsNull = b === null || b === undefined;

    if (aIsNull && bIsNull) return 0;
    if (aIsNull) return 1;
    if (bIsNull) return -1;

    // 타입별 비교
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }

    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return (a ? 1 : 0) - (b ? 1 : 0);
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }

    // 문자열로 변환하여 비교
    return String(a).localeCompare(String(b));
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
   * 정렬 설정 반환
   */
  getSorts(): SortState[] {
    return [...this.sorts];
  }

  /**
   * 정렬 설정 변경
   */
  setSorts(sorts: SortState[]): void {
    this.sorts = sorts;
  }

  /**
   * 정렬 추가/토글
   */
  toggleSort(columnKey: string, multiSort = false): void {
    const existingIndex = this.sorts.findIndex(s => s.columnKey === columnKey);

    if (existingIndex >= 0) {
      const existing = this.sorts[existingIndex];
      if (existing?.direction === 'asc') {
        // 오름차순 → 내림차순
        this.sorts[existingIndex] = { columnKey, direction: 'desc' };
      } else {
        // 내림차순 → 제거
        this.sorts.splice(existingIndex, 1);
      }
    } else {
      // 없음 → 오름차순 추가
      if (multiSort) {
        this.sorts.push({ columnKey, direction: 'asc' });
      } else {
        // 단일 정렬 모드면 기존 정렬 제거
        this.sorts = [{ columnKey, direction: 'asc' }];
      }
    }
  }
}
