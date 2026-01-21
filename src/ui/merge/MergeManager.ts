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
   * 특정 셀의 병합 정보 반환 (렌더링용)
   *
   * getMergedRange()를 호출하고 결과를 CellMergeInfo로 변환합니다.
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
    const range = this.getMergedRange(rowIndex, columnKey, data);

    if (!range) {
      // 병합 없음
      return {
        range: null,
        isAnchor: true,
        rowSpan: 1,
        colSpan: 1,
      };
    }

    const colIndex = this.columnIndexMap.get(columnKey) ?? -1;

    // 이 셀이 앵커(첫 번째 셀)인지 확인
    const isAnchor = rowIndex === range.startRow && colIndex === range.startCol;

    return {
      range,
      isAnchor,
      rowSpan: isAnchor ? range.endRow - range.startRow + 1 : 1,
      colSpan: isAnchor ? range.endCol - range.startCol + 1 : 1,
    };
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
   * 설정 반환
   */
  getConfig(): MergeManagerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// ContentMergeManager - 같은 값 병합
// =============================================================================

/**
 * ContentMergeManager - 같은 값을 가진 연속된 셀 병합
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
   * 같은 값을 가진 연속된 셀의 병합 범위 반환
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

    const currentRow = data[rowIndex];
    const currentValue = currentRow?.[columnKey];

    // null/undefined는 병합하지 않음
    if (currentValue === null || currentValue === undefined) {
      return null;
    }

    const colIndex = this.columnIndexMap.get(columnKey) ?? -1;
    if (colIndex < 0) {
      return null;
    }

    // 행 방향 병합 범위 찾기
    let startRow = rowIndex;
    let endRow = rowIndex;

    if (this.config.allowRowMerge) {
      // 위쪽으로 같은 값 찾기
      for (let r = rowIndex - 1; r >= 0; r--) {
        const row = data[r];
        if (this.valuesEqual(row?.[columnKey], currentValue)) {
          startRow = r;
        } else {
          break;
        }
      }

      // 아래쪽으로 같은 값 찾기
      for (let r = rowIndex + 1; r < data.length; r++) {
        const row = data[r];
        if (this.valuesEqual(row?.[columnKey], currentValue)) {
          endRow = r;
        } else {
          break;
        }
      }
    }

    // 병합할 셀이 없으면 null 반환
    if (startRow === endRow) {
      return null;
    }

    return {
      startRow,
      endRow,
      startCol: colIndex,
      endCol: colIndex,
    };
  }

  /**
   * 값 비교 (동등성 검사)
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
}

// =============================================================================
// HierarchicalMergeManager - 계층적 병합 (상위 컬럼 기준)
// =============================================================================

/**
 * HierarchicalMergeManager - 계층적 병합
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

  constructor(hierarchy: string[], config?: Omit<MergeManagerConfig, 'columns'>) {
    super({
      ...config,
      columns: hierarchy,
    });
    this.hierarchy = hierarchy;
  }

  /**
   * 계층적 병합 범위 반환
   *
   * 상위 컬럼의 병합 범위 내에서만 같은 값을 병합합니다.
   */
  getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly RowData[]
  ): MergedRange | null {
    // 계층에 포함된 컬럼인지 확인
    const hierarchyIndex = this.hierarchy.indexOf(columnKey);
    if (hierarchyIndex < 0) {
      return null;
    }

    // 데이터 유효성 검사
    if (!data || data.length === 0 || rowIndex < 0 || rowIndex >= data.length) {
      return null;
    }

    const currentRow = data[rowIndex];
    const currentValue = currentRow?.[columnKey];

    if (currentValue === null || currentValue === undefined) {
      return null;
    }

    const colIndex = this.columnIndexMap.get(columnKey) ?? -1;
    if (colIndex < 0) {
      return null;
    }

    // 상위 컬럼들의 병합 범위 제한 계산
    let constraintStartRow = 0;
    let constraintEndRow = data.length - 1;

    for (let i = 0; i < hierarchyIndex; i++) {
      const parentColumnKey = this.hierarchy[i];
      if (!parentColumnKey) continue;

      const parentValue = currentRow?.[parentColumnKey];
      if (parentValue === null || parentValue === undefined) continue;

      // 상위 컬럼의 같은 값 범위 찾기
      let parentStart = rowIndex;
      let parentEnd = rowIndex;

      // 위쪽으로
      for (let r = rowIndex - 1; r >= constraintStartRow; r--) {
        if (this.valuesEqual(data[r]?.[parentColumnKey], parentValue)) {
          parentStart = r;
        } else {
          break;
        }
      }

      // 아래쪽으로
      for (let r = rowIndex + 1; r <= constraintEndRow; r++) {
        if (this.valuesEqual(data[r]?.[parentColumnKey], parentValue)) {
          parentEnd = r;
        } else {
          break;
        }
      }

      // 제한 범위 축소
      constraintStartRow = Math.max(constraintStartRow, parentStart);
      constraintEndRow = Math.min(constraintEndRow, parentEnd);
    }

    // 제한된 범위 내에서 현재 컬럼의 병합 범위 찾기
    let startRow = rowIndex;
    let endRow = rowIndex;

    // 위쪽으로
    for (let r = rowIndex - 1; r >= constraintStartRow; r--) {
      if (this.valuesEqual(data[r]?.[columnKey], currentValue)) {
        startRow = r;
      } else {
        break;
      }
    }

    // 아래쪽으로
    for (let r = rowIndex + 1; r <= constraintEndRow; r++) {
      if (this.valuesEqual(data[r]?.[columnKey], currentValue)) {
        endRow = r;
      } else {
        break;
      }
    }

    // 병합할 셀이 없으면 null 반환
    if (startRow === endRow) {
      return null;
    }

    return {
      startRow,
      endRow,
      startCol: colIndex,
      endCol: colIndex,
    };
  }

  /**
   * 값 비교
   */
  protected valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }
    return String(a) === String(b);
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
