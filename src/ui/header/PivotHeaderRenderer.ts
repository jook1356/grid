/**
 * PivotHeaderRenderer - 피봇 테이블용 계층적 헤더 렌더러
 *
 * 피봇 테이블의 다중 레벨 컬럼 헤더를 렌더링합니다.
 * - 열 필드: 위에서 아래로 계층 구조
 * - 값 필드: 맨 아래 레벨 (2개 이상일 때만)
 * - 행 필드: 왼쪽 고정, 전체 높이 rowspan
 * - 연속된 동일 값 셀 자동 병합 (colspan)
 */

import type { PivotColumnMeta } from '../../types';

/**
 * 피봇 헤더 렌더링에 필요한 데이터
 */
export interface PivotHeaderData {
  /** 동적 생성된 컬럼 메타데이터 */
  pivotColumnMeta: PivotColumnMeta[];
  /** 행 필드 키 배열 */
  rowFields: string[];
  /** 열 필드 키 배열 */
  columnFields: string[];
  /** 값 필드가 여러 개인지 */
  hasMultipleValueFields: boolean;
  /** 행 필드 레이블 맵 (key -> label) */
  rowFieldLabels?: Map<string, string>;
  /** 열 필드 레이블 맵 (key -> label) */
  columnFieldLabels?: Map<string, string>;
}

/**
 * PivotHeaderRenderer 옵션
 */
export interface PivotHeaderRendererOptions {
  /** 헤더 데이터 */
  data: PivotHeaderData;
  /** 단일 레벨 헤더 높이 */
  headerHeight: number;
  /** 컬럼 너비 맵 (columnKey -> width) */
  columnWidths?: Map<string, number>;
  /** 기본 컬럼 너비 */
  defaultColumnWidth?: number;
  /** 행 필드 컬럼 너비 */
  rowFieldWidth?: number;
}

/**
 * 병합된 헤더 셀 정보
 */
interface MergedHeaderCell {
  /** 표시 텍스트 */
  label: string;
  /** colspan (병합된 컬럼 수) */
  colspan: number;
  /** 시작 컬럼 인덱스 */
  startIndex: number;
}

/**
 * 피봇 헤더 렌더러
 */
export class PivotHeaderRenderer {
  private readonly container: HTMLElement;
  private data: PivotHeaderData;
  private readonly headerHeight: number;
  private readonly columnWidths: Map<string, number>;
  private readonly defaultColumnWidth: number;
  private readonly rowFieldWidth: number;

  constructor(container: HTMLElement, options: PivotHeaderRendererOptions) {
    this.container = container;
    this.data = options.data;
    this.headerHeight = options.headerHeight;
    this.columnWidths = options.columnWidths ?? new Map();
    this.defaultColumnWidth = options.defaultColumnWidth ?? 100;
    this.rowFieldWidth = options.rowFieldWidth ?? 120;

    this.render();
  }

  /**
   * 전체 헤더 높이 계산
   */
  getTotalHeight(): number {
    const levels = this.calculateTotalLevels();
    return this.headerHeight * levels;
  }

  /**
   * 총 헤더 레벨 수 계산
   */
  private calculateTotalLevels(): number {
    const { columnFields, hasMultipleValueFields } = this.data;
    // 열 필드 레벨 + 값 필드 레벨 (2개 이상일 때)
    return columnFields.length + (hasMultipleValueFields ? 1 : 0) || 1;
  }

  /**
   * 헤더 렌더링
   */
  private render(): void {
    this.container.innerHTML = '';
    this.container.className = 'ps-pivot-header';

    const totalLevels = this.calculateTotalLevels();

    // 컨테이너 높이 설정
    this.container.style.height = `${this.headerHeight * totalLevels}px`;
    this.container.style.display = 'flex';

    // 1. 행 필드 헤더 영역 (왼쪽 고정)
    const rowFieldsContainer = this.renderRowFieldHeaders(totalLevels);
    this.container.appendChild(rowFieldsContainer);

    // 2. 열 필드 + 값 필드 헤더 영역 (스크롤 가능)
    const columnFieldsContainer = this.renderColumnFieldHeaders(totalLevels);
    this.container.appendChild(columnFieldsContainer);
  }

  /**
   * 행 필드 헤더 렌더링 (왼쪽 고정 영역)
   */
  private renderRowFieldHeaders(totalLevels: number): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ps-pivot-header-row-fields';
    container.style.display = 'flex';
    container.style.flexShrink = '0';

    const { rowFields, rowFieldLabels } = this.data;

    for (const field of rowFields) {
      const cell = document.createElement('div');
      cell.className = 'ps-pivot-header-cell ps-pivot-row-field';
      cell.style.width = `${this.rowFieldWidth}px`;
      cell.style.minWidth = `${this.rowFieldWidth}px`;
      cell.style.height = `${this.headerHeight * totalLevels}px`;

      const label = rowFieldLabels?.get(field) ?? field;
      cell.textContent = label;

      container.appendChild(cell);
    }

    return container;
  }

  /**
   * 열 필드 헤더 렌더링 (스크롤 가능 영역)
   */
  private renderColumnFieldHeaders(_totalLevels: number): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ps-pivot-header-column-fields';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.flex = '1';
    container.style.overflow = 'hidden';

    const { columnFields, hasMultipleValueFields, pivotColumnMeta } = this.data;

    // 각 레벨별로 헤더 행 생성
    for (let level = 0; level < columnFields.length; level++) {
      const row = this.renderColumnFieldLevel(level, pivotColumnMeta);
      container.appendChild(row);
    }

    // 값 필드 레벨 (2개 이상일 때)
    if (hasMultipleValueFields) {
      const valueRow = this.renderValueFieldLevel(pivotColumnMeta);
      container.appendChild(valueRow);
    }

    // 열 필드가 없고 값 필드만 있는 경우
    if (columnFields.length === 0 && pivotColumnMeta.length > 0) {
      const valueRow = this.renderValueFieldLevel(pivotColumnMeta);
      container.appendChild(valueRow);
    }

    return container;
  }

  /**
   * 특정 레벨의 열 필드 헤더 행 렌더링
   * 연속된 동일 값을 병합하여 colspan 적용
   */
  private renderColumnFieldLevel(level: number, columns: PivotColumnMeta[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-pivot-header-row';
    row.style.display = 'flex';
    row.style.height = `${this.headerHeight}px`;

    // 레벨별 값 추출 및 병합
    const mergedCells = this.mergeConsecutiveCells(columns, level);

    for (const mergedCell of mergedCells) {
      const cell = document.createElement('div');
      cell.className = 'ps-pivot-header-cell ps-pivot-column-field';

      // 병합된 셀의 너비 계산
      const width = this.calculateMergedCellWidth(columns, mergedCell.startIndex, mergedCell.colspan);
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;

      cell.textContent = mergedCell.label;

      row.appendChild(cell);
    }

    return row;
  }

  /**
   * 값 필드 레벨 헤더 행 렌더링
   */
  private renderValueFieldLevel(columns: PivotColumnMeta[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-pivot-header-row';
    row.style.display = 'flex';
    row.style.height = `${this.headerHeight}px`;

    for (const col of columns) {
      const cell = document.createElement('div');
      cell.className = 'ps-pivot-header-cell ps-pivot-value-field';

      const width = this.columnWidths.get(col.columnKey) ?? this.defaultColumnWidth;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;

      cell.textContent = col.valueFieldLabel ?? col.valueField;

      row.appendChild(cell);
    }

    return row;
  }

  /**
   * 연속된 동일 값 셀 병합
   * level 인덱스의 pivotValues 값이 같은 연속 셀들을 그룹화
   */
  private mergeConsecutiveCells(columns: PivotColumnMeta[], level: number): MergedHeaderCell[] {
    const merged: MergedHeaderCell[] = [];

    if (columns.length === 0) return merged;

    let currentLabel = columns[0]?.pivotValues[level] ?? '';
    let startIndex = 0;
    let count = 1;

    for (let i = 1; i < columns.length; i++) {
      const col = columns[i]!;
      const value = col.pivotValues[level] ?? '';

      // 같은 레벨의 부모 경로도 같아야 병합 가능
      const prevCol = columns[i - 1]!;
      const sameParent = this.hasSameParent(prevCol, col, level);

      if (value === currentLabel && sameParent) {
        count++;
      } else {
        // 이전 그룹 저장
        merged.push({
          label: currentLabel,
          colspan: count,
          startIndex,
        });
        // 새 그룹 시작
        currentLabel = value;
        startIndex = i;
        count = 1;
      }
    }

    // 마지막 그룹 저장
    merged.push({
      label: currentLabel,
      colspan: count,
      startIndex,
    });

    return merged;
  }

  /**
   * 두 컬럼이 특정 레벨까지 같은 부모를 가지는지 확인
   */
  private hasSameParent(col1: PivotColumnMeta, col2: PivotColumnMeta, level: number): boolean {
    // 해당 레벨 이전의 모든 값이 같아야 함
    for (let i = 0; i < level; i++) {
      if (col1.pivotValues[i] !== col2.pivotValues[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 병합된 셀의 총 너비 계산
   */
  private calculateMergedCellWidth(
    columns: PivotColumnMeta[],
    startIndex: number,
    colspan: number
  ): number {
    let totalWidth = 0;
    for (let i = startIndex; i < startIndex + colspan; i++) {
      const col = columns[i];
      if (col) {
        totalWidth += this.columnWidths.get(col.columnKey) ?? this.defaultColumnWidth;
      }
    }
    return totalWidth;
  }

  /**
   * 컬럼 너비 업데이트
   */
  updateColumnWidth(columnKey: string, width: number): void {
    this.columnWidths.set(columnKey, width);
    this.render();
  }

  /**
   * 데이터 업데이트 및 다시 렌더링
   */
  update(data: PivotHeaderData): void {
    this.data = data;
    this.render();
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
