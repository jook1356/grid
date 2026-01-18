/**
 * MultiRowRenderer - Multi-Row 레이아웃 렌더링
 *
 * rowTemplate에 따라 헤더와 바디를 Multi-Row 형태로 렌더링합니다.
 * 하나의 데이터 행을 여러 줄(visual rows)로 표시합니다.
 */

import type { RowTemplate, RowLayoutItem } from '../../types/grouping.types';
import type { ColumnDef, Row } from '../../types';

/**
 * Multi-Row 렌더링 유틸리티
 */
export class MultiRowRenderer {
  private template: RowTemplate;
  private columnDefs: Map<string, ColumnDef>;
  private baseRowHeight: number;

  constructor(
    template: RowTemplate,
    columnDefs: Map<string, ColumnDef>,
    baseRowHeight: number
  ) {
    this.template = template;
    this.columnDefs = columnDefs;
    this.baseRowHeight = baseRowHeight;
  }

  /**
   * 템플릿 업데이트
   */
  setTemplate(template: RowTemplate): void {
    this.template = template;
  }

  /**
   * 템플릿 가져오기
   */
  getTemplate(): RowTemplate {
    return this.template;
  }

  /**
   * 하나의 데이터 행이 차지하는 visual row 수
   */
  getRowCount(): number {
    return this.template.rowCount;
  }

  /**
   * 하나의 데이터 행의 총 높이 (px)
   */
  getTotalRowHeight(): number {
    return this.template.rowCount * this.baseRowHeight;
  }

  // ===========================================================================
  // 헤더 렌더링
  // ===========================================================================

  /**
   * Multi-Row 헤더 렌더링
   */
  renderHeader(container: HTMLElement): void {
    container.innerHTML = '';

    for (let rowIdx = 0; rowIdx < this.template.layout.length; rowIdx++) {
      const layoutRow = this.template.layout[rowIdx];
      const headerRow = document.createElement('div');
      headerRow.className = 'ps-header-row ps-multirow-header';
      headerRow.style.height = `${this.baseRowHeight}px`;

      for (const item of layoutRow) {
        const colDef = this.columnDefs.get(item.key);
        if (!colDef) continue;

        const cell = this.createHeaderCell(item, colDef);
        headerRow.appendChild(cell);
      }

      container.appendChild(headerRow);
    }
  }

  /**
   * 헤더 셀 생성
   */
  private createHeaderCell(item: RowLayoutItem, colDef: ColumnDef): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'ps-header-cell ps-multirow-cell';
    cell.dataset['columnKey'] = item.key;

    // 너비 계산
    const width = this.getCellWidth(item);
    cell.style.width = width;

    // rowSpan 처리
    if (item.rowSpan && item.rowSpan > 1) {
      cell.style.height = `${item.rowSpan * this.baseRowHeight}px`;
      cell.style.position = 'relative';
      cell.style.zIndex = '1';
    }

    // colSpan 처리
    if (item.colSpan && item.colSpan > 1) {
      cell.style.flexGrow = String(item.colSpan);
    }

    cell.textContent = colDef.header ?? item.key;
    cell.title = colDef.header ?? item.key;

    return cell;
  }

  // ===========================================================================
  // 바디 렌더링
  // ===========================================================================

  /**
   * Multi-Row 데이터 행 렌더링
   *
   * 하나의 데이터 행을 여러 줄의 visual row로 렌더링합니다.
   */
  renderDataRow(
    container: HTMLElement,
    rowData: Row,
    dataIndex: number,
    offsetY: number
  ): HTMLElement {
    const multiRowContainer = document.createElement('div');
    multiRowContainer.className = 'ps-multirow-container';
    multiRowContainer.style.position = 'absolute';
    multiRowContainer.style.left = '0';
    multiRowContainer.style.right = '0';
    multiRowContainer.style.height = `${this.getTotalRowHeight()}px`;
    multiRowContainer.style.transform = `translateY(${offsetY}px)`;
    multiRowContainer.dataset['dataIndex'] = String(dataIndex);

    for (let rowIdx = 0; rowIdx < this.template.layout.length; rowIdx++) {
      const layoutRow = this.template.layout[rowIdx];
      const visualRow = document.createElement('div');
      visualRow.className = 'ps-row ps-multirow-row';
      visualRow.style.position = 'relative';
      visualRow.style.height = `${this.baseRowHeight}px`;
      visualRow.dataset['visualRowIndex'] = String(rowIdx);

      // 셀 컨테이너 (center만 - 고정 컬럼은 별도 처리 필요)
      const cellsContainer = document.createElement('div');
      cellsContainer.className = 'ps-cells-center';
      cellsContainer.style.display = 'flex';

      for (const item of layoutRow) {
        const cell = this.createDataCell(item, rowData);
        cellsContainer.appendChild(cell);
      }

      visualRow.appendChild(cellsContainer);
      multiRowContainer.appendChild(visualRow);
    }

    container.appendChild(multiRowContainer);
    return multiRowContainer;
  }

  /**
   * 데이터 셀 생성
   */
  private createDataCell(item: RowLayoutItem, rowData: Row): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'ps-cell ps-multirow-cell';
    cell.dataset['columnKey'] = item.key;

    // 너비 계산
    const width = this.getCellWidth(item);
    cell.style.width = width;

    // rowSpan 처리
    if (item.rowSpan && item.rowSpan > 1) {
      cell.style.height = `${item.rowSpan * this.baseRowHeight}px`;
      cell.style.position = 'relative';
      cell.style.zIndex = '1';
    }

    // colSpan 처리
    if (item.colSpan && item.colSpan > 1) {
      cell.style.flexGrow = String(item.colSpan);
    }

    // 값 렌더링
    const value = rowData[item.key];
    const colDef = this.columnDefs.get(item.key);
    const displayValue = this.formatValue(value, colDef);
    cell.textContent = displayValue;
    cell.title = displayValue;

    return cell;
  }

  // ===========================================================================
  // 유틸리티
  // ===========================================================================

  /**
   * 셀 너비 계산
   */
  private getCellWidth(item: RowLayoutItem): string {
    if (item.width) {
      if (typeof item.width === 'number') {
        return `${item.width}px`;
      }
      return item.width;
    }

    const colDef = this.columnDefs.get(item.key);
    const baseWidth = colDef?.width ?? 100;

    // colSpan이 있으면 너비 합산
    if (item.colSpan && item.colSpan > 1) {
      return `calc(var(--col-${item.key}-width, ${baseWidth}px) * ${item.colSpan})`;
    }

    return `var(--col-${item.key}-width, ${baseWidth}px)`;
  }

  /**
   * 값 포맷팅
   */
  private formatValue(value: unknown, colDef?: ColumnDef): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (colDef?.formatter) {
      return colDef.formatter(value);
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }
}
