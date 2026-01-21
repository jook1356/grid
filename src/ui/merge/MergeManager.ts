/**
 * MergeManager - 셀 병합 관리자
 *
 * Wijmo FlexGrid의 MergeManager 패턴을 참고하여 구현되었습니다.
 *
 * 핵심 개념:
 * - getMergedRange(): 특정 셀이 속한 병합 범위를 반환
 * - 병합 범위의 첫 번째(최상단) 셀만 렌더링하고 나머지는 숨김
 * - 첫 번째 셀의 높이를 확장하여 병합된 영역 전체를 차지
 *
 * 성능 최적화:
 * - 병합 범위 사전 계산 (Pre-computation): 데이터 로드 시 O(n)으로 한 번만 계산
 * - 캐시 시스템: 병합 정보를 Map에 캐시하여 O(1) 조회
 * - 중복 계산 제거: 같은 병합 범위 내 셀들이 동일한 범위 참조
 *
 * 사용 방법:
 * 1. MergeManager를 상속하여 getMergedRange() 오버라이드
 * 2. PureSheet.setMergeManager()로 설정
 *
 * @example
 * ```ts
 * // 같은 값 병합 (기본 제공)
 * grid.setMergeManager(new ContentMergeManager(['department']));
 *
 * // 커스텀 병합
 * class MyMergeManager extends MergeManager {
 *   getMergedRange(row, col, data) {
 *     // 커스텀 로직
 *   }
 * }
 * ```
 */

import type { Row as RowData, ColumnDef } from '../../types';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * 셀 병합 범위
 *
 * 병합된 셀들의 시작/끝 위치를 나타냅니다.
 * 단일 셀인 경우 startRow === endRow && startCol === endCol
 */
export interface MergedRange {
  /** 시작 행 인덱스 (데이터 인덱스 기준) */
  startRow: number;
  /** 끝 행 인덱스 (데이터 인덱스 기준, 포함) */
  endRow: number;
  /** 시작 컬럼 인덱스 (보이는 컬럼 순서 기준) */
  startCol: number;
  /** 끝 컬럼 인덱스 (보이는 컬럼 순서 기준, 포함) */
  endCol: number;
}

/**
 * 셀 병합 정보 (렌더링용)
 *
 * 개별 셀의 병합 상태를 나타냅니다.
 */
export interface CellMergeInfo {
  /** 병합 범위 (병합되지 않은 셀은 null) */
  range: MergedRange | null;
  /** 이 셀이 병합의 앵커(첫 번째)인지 여부 */
  isAnchor: boolean;
  /** 병합된 행 수 (앵커 셀에서만 유효, 1이면 병합 없음) */
  rowSpan: number;
  /** 병합된 컬럼 수 (앵커 셀에서만 유효, 1이면 병합 없음) */
  colSpan: number;
}

/**
 * MergeManager 설정
 */
export interface MergeManagerConfig {
  /**
   * 병합할 컬럼 키 목록
   * 지정하지 않으면 모든 컬럼에 대해 병합 검사
   */
  columns?: string[];

  /**
   * 컬럼 방향 병합 허용 여부
   * @default false (행 방향만 병합)
   */
  allowColumnMerge?: boolean;

  /**
   * 행 방향 병합 허용 여부
   * @default true
   */
  allowRowMerge?: boolean;
}

// =============================================================================
// MergeManager 추상 클래스
// =============================================================================

/**
 * MergeManager 추상 클래스
 *
 * 셀 병합 로직을 정의하는 기본 클래스입니다.
 * 상속하여 getMergedRange()를 구현하면 커스텀 병합 로직을 적용할 수 있습니다.
 */
export abstract class MergeManager {
  /** 설정 */
  protected config: MergeManagerConfig;

  /** 컬럼 정의 (인덱스 ↔ 키 매핑용) */
  protected columnDefs: ColumnDef[] = [];

  /** 컬럼 키 → 인덱스 맵 */
  protected columnIndexMap: Map<string, number> = new Map();

  /** 병합 정보 캐시 (key: "rowIndex:columnKey") */
  protected mergeInfoCache: Map<string, CellMergeInfo> = new Map();

  /** 캐시된 데이터 참조 (캐시 무효화 판단용) */
  protected cachedDataRef: readonly RowData[] | null = null;

  constructor(config: MergeManagerConfig = {}) {
    this.config = {
      allowRowMerge: true,
      allowColumnMerge: false,
      ...config,
    };
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 컬럼 정의 업데이트
   *
   * 컬럼 순서나 가시성이 변경될 때 호출합니다.
   */
  setColumns(columns: readonly ColumnDef[]): void {
    this.columnDefs = [...columns];
    this.columnIndexMap.clear();
    columns.forEach((col, index) => {
      this.columnIndexMap.set(col.key, index);
    });
    // 컬럼 변경 시 캐시 무효화
    this.invalidateCache();
  }

  /**
   * 특정 셀의 병합 범위 반환 (추상 메서드)
   *
   * 이 메서드를 오버라이드하여 커스텀 병합 로직을 구현합니다.
   *
   * @param rowIndex - 행 인덱스 (데이터 인덱스)
   * @param columnKey - 컬럼 키
   * @param data - 전체 데이터 배열
   * @returns 병합 범위 (병합되지 않은 경우 null)
   */
  abstract getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): MergedRange | null;

  /**
   * 특정 셀의 병합 정보 반환 (렌더링용) - 캐시 사용
   *
   * 내부적으로 캐시를 사용하여 O(1) 조회를 보장합니다.
   *
   * @param rowIndex - 행 인덱스 (데이터 인덱스)
   * @param columnKey - 컬럼 키
   * @param data - 전체 데이터 배열
   * @returns 셀 병합 정보
   */
  getCellMergeInfo(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): CellMergeInfo {
    // 데이터 참조가 변경되면 캐시 무효화
    if (this.cachedDataRef !== data) {
      this.invalidateCache();
      this.cachedDataRef = data;
    }

    // 캐시 키
    const cacheKey = `${rowIndex}:${columnKey}`;

    // 캐시에서 조회
    const cached = this.mergeInfoCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 병합 범위 계산
    const range = this.getMergedRange(rowIndex, columnKey, data);

    let info: CellMergeInfo;

    if (!range) {
      // 병합 없음
      info = {
        range: null,
        isAnchor: true,
        rowSpan: 1,
        colSpan: 1,
      };
    } else {
      const colIndex = this.columnIndexMap.get(columnKey) ?? -1;
      // 이 셀이 앵커(첫 번째 셀)인지 확인
      const isAnchor = rowIndex === range.startRow && colIndex === range.startCol;

      info = {
        range,
        isAnchor,
        rowSpan: isAnchor ? range.endRow - range.startRow + 1 : 1,
        colSpan: isAnchor ? range.endCol - range.startCol + 1 : 1,
      };
    }

    // 캐시에 저장
    this.mergeInfoCache.set(cacheKey, info);

    return info;
  }

  /**
   * 캐시 무효화
   */
  invalidateCache(): void {
    this.mergeInfoCache.clear();
    this.cachedDataRef = null;
  }

  /**
   * 컬럼이 병합 대상인지 확인
   *
   * config.columns가 지정된 경우 해당 컬럼만 병합 검사
   */
  protected isColumnMergeable(columnKey: string): boolean {
    if (!this.config.columns || this.config.columns.length === 0) {
      return true; // 모든 컬럼 대상
    }
    return this.config.columns.includes(columnKey);
  }

  /**
   * 값 비교 (동등성 검사) - 공통 유틸리티
   */
  protected valuesEqual(a: unknown, b: unknown): boolean {
    // 기본 타입 비교
    if (a === b) return true;

    // null/undefined 처리
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }

    // 문자열로 변환하여 비교 (숫자, 불리언 등)
    return String(a) === String(b);
  }

  /**
   * 설정 반환
   */
  getConfig(): MergeManagerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// ContentMergeManager - 같은 값 병합 (사전 계산 최적화)
// =============================================================================

/**
 * ContentMergeManager - 같은 값을 가진 연속된 셀 병합
 *
 * **성능 최적화**:
 * - 병합 범위를 사전 계산하여 Map에 저장 (O(n) 한 번만)
 * - getMergedRange()는 O(1) 조회만 수행
 *
 * Wijmo FlexGrid의 기본 병합 동작과 유사합니다.
 * 지정된 컬럼에서 같은 값을 가진 연속된 행들을 병합합니다.
 *
 * @example
 * ```ts
 * // 'department' 컬럼에서 같은 값 병합
 * const mergeManager = new ContentMergeManager(['department']);
 * grid.setMergeManager(mergeManager);
 *
 * // 여러 컬럼 병합
 * const mergeManager = new ContentMergeManager(['department', 'team']);
 * ```
 */
export class ContentMergeManager extends MergeManager {
  /** 사전 계산된 병합 범위 맵 (key: "rowIndex:columnKey" → MergedRange) */
  private precomputedRanges: Map<string, MergedRange> = new Map();

  /** 사전 계산 완료 여부 */
  private isPrecomputed = false;

  /**
   * ContentMergeManager 생성자
   *
   * @param columns - 병합할 컬럼 키 배열 (비어있으면 모든 컬럼)
   * @param config - 추가 설정
   */
  constructor(columns?: string[], config?: Omit<MergeManagerConfig, 'columns'>) {
    super({
      ...config,
      columns,
    });
  }

  /**
   * 캐시 무효화 (오버라이드)
   */
  override invalidateCache(): void {
    super.invalidateCache();
    this.precomputedRanges.clear();
    this.isPrecomputed = false;
  }

  /**
   * 병합 범위 사전 계산
   *
   * 데이터 전체를 O(n)으로 한 번 순회하여 모든 병합 범위를 계산합니다.
   * 이후 getMergedRange()는 O(1) 조회만 수행합니다.
   */
  private precomputeRanges(data: readonly RowData[]): void {
    if (this.isPrecomputed) return;

    this.precomputedRanges.clear();

    if (!data || data.length === 0) {
      this.isPrecomputed = true;
      return;
    }

    // 병합 대상 컬럼 결정
    const targetColumns = this.config.columns && this.config.columns.length > 0
      ? this.config.columns
      : Array.from(this.columnIndexMap.keys());

    // 각 컬럼별로 병합 범위 계산
    for (const columnKey of targetColumns) {
      const colIndex = this.columnIndexMap.get(columnKey);
      if (colIndex === undefined || colIndex < 0) continue;

      let rangeStart = 0;
      let currentValue = data[0]?.[columnKey];

      for (let r = 1; r <= data.length; r++) {
        const value = r < data.length ? data[r]?.[columnKey] : null;
        const isSameValue = r < data.length && this.valuesEqual(value, currentValue);

        if (!isSameValue) {
          // 범위 종료 - 2개 이상의 행이면 병합 범위 저장
          if (r - rangeStart > 1 && currentValue !== null && currentValue !== undefined) {
            const range: MergedRange = {
              startRow: rangeStart,
              endRow: r - 1,
              startCol: colIndex,
              endCol: colIndex,
            };

            // 범위 내 모든 셀에 동일한 range 참조 저장
            for (let row = rangeStart; row < r; row++) {
              this.precomputedRanges.set(`${row}:${columnKey}`, range);
            }
          }

          // 새 범위 시작
          rangeStart = r;
          currentValue = value;
        }
      }
    }

    this.isPrecomputed = true;
  }

  /**
   * 같은 값을 가진 연속된 셀의 병합 범위 반환 - O(1) 조회
   */
  getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): MergedRange | null {
    // 병합 대상 컬럼인지 확인
    if (!this.isColumnMergeable(columnKey)) {
      return null;
    }

    // 데이터 유효성 검사
    if (!data || data.length === 0 || rowIndex < 0 || rowIndex >= data.length) {
      return null;
    }

    // 데이터 참조가 변경되면 사전 계산 무효화
    if (this.cachedDataRef !== data) {
      this.isPrecomputed = false;
    }

    // 사전 계산 수행 (필요 시)
    if (!this.isPrecomputed) {
      this.precomputeRanges(data);
    }

    // O(1) 조회
    return this.precomputedRanges.get(`${rowIndex}:${columnKey}`) ?? null;
  }
}

// =============================================================================
// HierarchicalMergeManager - 계층적 병합 (사전 계산 최적화)
// =============================================================================

/**
 * HierarchicalMergeManager - 계층적 병합
 *
 * **성능 최적화**:
 * - 병합 범위를 사전 계산하여 Map에 저장
 * - 계층 구조를 고려하여 상위 → 하위 순으로 계산
 *
 * 상위 컬럼의 병합 범위 내에서만 하위 컬럼을 병합합니다.
 * 예: 부서가 같은 범위 내에서만 팀을 병합
 *
 * @example
 * ```ts
 * // 'department' → 'team' 순서로 계층적 병합
 * const mergeManager = new HierarchicalMergeManager(['department', 'team']);
 * ```
 */
export class HierarchicalMergeManager extends MergeManager {
  /** 계층 순서 (상위 → 하위) */
  private hierarchy: string[];

  /** 사전 계산된 병합 범위 맵 */
  private precomputedRanges: Map<string, MergedRange> = new Map();

  /** 사전 계산 완료 여부 */
  private isPrecomputed = false;

  constructor(hierarchy: string[], config?: Omit<MergeManagerConfig, 'columns'>) {
    super({
      ...config,
      columns: hierarchy,
    });
    this.hierarchy = hierarchy;
  }

  /**
   * 캐시 무효화 (오버라이드)
   */
  override invalidateCache(): void {
    super.invalidateCache();
    this.precomputedRanges.clear();
    this.isPrecomputed = false;
  }

  /**
   * 병합 범위 사전 계산 (계층 구조 고려)
   */
  private precomputeRanges(data: readonly RowData[]): void {
    if (this.isPrecomputed) return;

    this.precomputedRanges.clear();

    if (!data || data.length === 0 || this.hierarchy.length === 0) {
      this.isPrecomputed = true;
      return;
    }

    // 상위 컬럼부터 순차적으로 처리
    // 각 컬럼의 범위는 상위 컬럼의 범위 내에서만 계산

    // 1단계: 최상위 컬럼의 범위 계산 (ContentMerge와 동일)
    const topColumn = this.hierarchy[0];
    if (!topColumn) {
      this.isPrecomputed = true;
      return;
    }

    const topColIndex = this.columnIndexMap.get(topColumn);
    if (topColIndex === undefined) {
      this.isPrecomputed = true;
      return;
    }

    // 최상위 컬럼 범위 계산 및 저장
    const topRanges = this.computeColumnRanges(data, topColumn, topColIndex, 0, data.length - 1);
    for (const [key, range] of topRanges) {
      this.precomputedRanges.set(key, range);
    }

    // 2단계: 하위 컬럼들의 범위 계산 (상위 범위 내에서만)
    for (let h = 1; h < this.hierarchy.length; h++) {
      const columnKey = this.hierarchy[h];
      if (!columnKey) continue;

      const colIndex = this.columnIndexMap.get(columnKey);
      if (colIndex === undefined) continue;

      // 상위 컬럼의 고유 범위들을 찾아서 각 범위 내에서 계산
      const parentColumn = this.hierarchy[h - 1];
      if (!parentColumn) continue;

      const parentRanges = this.getUniqueRanges(parentColumn);

      for (const parentRange of parentRanges) {
        const childRanges = this.computeColumnRanges(
          data,
          columnKey,
          colIndex,
          parentRange.startRow,
          parentRange.endRow
        );
        for (const [key, range] of childRanges) {
          this.precomputedRanges.set(key, range);
        }
      }
    }

    this.isPrecomputed = true;
  }

  /**
   * 특정 컬럼의 병합 범위 계산 (지정된 행 범위 내에서)
   */
  private computeColumnRanges(
    data: readonly RowData[],
    columnKey: string,
    colIndex: number,
    startRow: number,
    endRow: number
  ): Map<string, MergedRange> {
    const result = new Map<string, MergedRange>();

    if (startRow > endRow) return result;

    let rangeStart = startRow;
    let currentValue = data[startRow]?.[columnKey];

    for (let r = startRow + 1; r <= endRow + 1; r++) {
      const value = r <= endRow ? data[r]?.[columnKey] : null;
      const isSameValue = r <= endRow && this.valuesEqual(value, currentValue);

      if (!isSameValue) {
        // 범위 종료 - 2개 이상의 행이면 병합 범위 저장
        if (r - rangeStart > 1 && currentValue !== null && currentValue !== undefined) {
          const range: MergedRange = {
            startRow: rangeStart,
            endRow: r - 1,
            startCol: colIndex,
            endCol: colIndex,
          };

          // 범위 내 모든 셀에 동일한 range 참조 저장
          for (let row = rangeStart; row < r; row++) {
            result.set(`${row}:${columnKey}`, range);
          }
        }

        // 새 범위 시작
        rangeStart = r;
        currentValue = value;
      }
    }

    return result;
  }

  /**
   * 특정 컬럼의 고유 범위 목록 반환
   */
  private getUniqueRanges(columnKey: string): MergedRange[] {
    const ranges: MergedRange[] = [];
    const seen = new Set<MergedRange>();

    for (const [key, range] of this.precomputedRanges) {
      if (key.endsWith(`:${columnKey}`) && !seen.has(range)) {
        seen.add(range);
        ranges.push(range);
      }
    }

    // 범위가 없으면 전체 데이터를 하나의 범위로 취급해야 함
    // 이 경우는 상위 컬럼에서 병합이 발생하지 않은 경우
    return ranges;
  }

  /**
   * 계층적 병합 범위 반환 - O(1) 조회
   */
  getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): MergedRange | null {
    // 계층에 포함된 컬럼인지 확인
    if (!this.hierarchy.includes(columnKey)) {
      return null;
    }

    // 데이터 유효성 검사
    if (!data || data.length === 0 || rowIndex < 0 || rowIndex >= data.length) {
      return null;
    }

    // 데이터 참조가 변경되면 사전 계산 무효화
    if (this.cachedDataRef !== data) {
      this.isPrecomputed = false;
    }

    // 사전 계산 수행 (필요 시)
    if (!this.isPrecomputed) {
      this.precomputeRanges(data);
    }

    // O(1) 조회
    return this.precomputedRanges.get(`${rowIndex}:${columnKey}`) ?? null;
  }
}

// =============================================================================
// CustomMergeManager - 사용자 정의 병합
// =============================================================================

/**
 * 커스텀 병합 함수 타입
 */
export type CustomMergeFunction = (
  rowIndex: number,
  columnKey: string,
  data: readonly RowData[]
) => MergedRange | null;

/**
 * CustomMergeManager - 사용자 정의 병합 함수 사용
 *
 * 콜백 함수로 병합 로직을 직접 지정할 수 있습니다.
 * 주의: 커스텀 함수는 매번 호출되므로 성능에 주의해야 합니다.
 * 복잡한 로직의 경우 내부적으로 캐싱을 구현하는 것을 권장합니다.
 *
 * @example
 * ```ts
 * const mergeManager = new CustomMergeManager((row, col, data) => {
 *   // 커스텀 병합 로직
 *   if (col === 'status' && data[row]?.status === 'pending') {
 *     // 특정 조건에서만 병합
 *     return { startRow: row, endRow: row + 1, startCol: 0, endCol: 0 };
 *   }
 *   return null;
 * });
 * ```
 */
export class CustomMergeManager extends MergeManager {
  private mergeFunction: CustomMergeFunction;

  constructor(mergeFunction: CustomMergeFunction, config?: MergeManagerConfig) {
    super(config);
    this.mergeFunction = mergeFunction;
  }

  getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): MergedRange | null {
    return this.mergeFunction(rowIndex, columnKey, data);
  }
}
