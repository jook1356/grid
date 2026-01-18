/**
 * MultiRowRenderer - Multi-Row 레이아웃 렌더링
 *
 * rowTemplate에 따라 헤더와 바디를 Multi-Row 형태로 렌더링합니다.
 * 하나의 데이터 행을 여러 줄(visual rows)로 표시합니다.
 *
 * CSS Grid를 사용하여 colSpan/rowSpan을 처리합니다.
 */

import type { RowTemplate, RowLayoutItem } from '../../types/grouping.types';
import type { ColumnDef, Row } from '../../types';

/**
 * 셀 위치 정보 (Grid 배치용)
 */
interface CellPlacement {
  item: RowLayoutItem;
  colDef?: ColumnDef;
  gridRow: number;      // 1-based
  gridColumn: number;   // 1-based
  rowSpan: number;
  colSpan: number;
}

/**
 * 그리드 컬럼 정보
 */
interface GridColumnInfo {
  /** 이 그리드 컬럼 위치에 있는 셀들의 key 목록 */
  cellKeys: string[];
  /** 이 그리드 컬럼의 너비를 결정하는 "기준" 셀 key (colSpan이 없는 셀 우선) */
  primaryKey: string;
  /** colSpan이 있는 상위 셀인지 */
  isPartOfColSpan: boolean;
}

/**
 * Multi-Row 렌더링 유틸리티
 */
export class MultiRowRenderer {
  private template: RowTemplate;
  private columnDefs: Map<string, ColumnDef>;
  private baseRowHeight: number;

  // 셀 배치 캐시
  private cellPlacements: CellPlacement[] = [];
  private gridColumnCount: number = 0;
  private gridColumnInfos: GridColumnInfo[] = [];

  constructor(
    template: RowTemplate,
    columnDefs: Map<string, ColumnDef>,
    baseRowHeight: number
  ) {
    this.template = template;
    this.columnDefs = columnDefs;
    this.baseRowHeight = baseRowHeight;
    this.calculateCellPlacements();
  }

  /**
   * 템플릿 업데이트
   */
  setTemplate(template: RowTemplate): void {
    this.template = template;
    this.calculateCellPlacements();
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
  // 셀 배치 계산
  // ===========================================================================

  /**
   * 템플릿을 분석하여 각 셀의 Grid 위치를 계산
   *
   * rowSpan이 있는 셀이 차지하는 공간을 고려하여
   * 다음 행들에서 해당 위치를 건너뜀
   */
  private calculateCellPlacements(): void {
    this.cellPlacements = [];
    const rowCount = this.template.rowCount;

    // 각 셀이 차지하는 그리드 위치를 추적
    // occupied[row][col] = { key, colSpan } 형태로 저장
    const occupied: Array<Array<{ key: string; colSpan: number } | null>> = 
      Array.from({ length: rowCount }, () => []);

    // 첫 번째 행의 컬럼 수로 그리드 컬럼 수 결정
    let maxCol = 0;
    for (const item of this.template.layout[0] ?? []) {
      maxCol += item.colSpan ?? 1;
    }
    this.gridColumnCount = maxCol;

    // 그리드 컬럼 정보 초기화
    this.gridColumnInfos = Array.from({ length: maxCol }, () => ({
      cellKeys: [],
      primaryKey: '',
      isPartOfColSpan: false,
    }));

    for (let rowIdx = 0; rowIdx < this.template.layout.length; rowIdx++) {
      const layoutRow = this.template.layout[rowIdx];
      let currentCol = 0;

      for (const item of layoutRow) {
        // 이미 차지된 셀 건너뛰기 (이전 행의 rowSpan 셀)
        while (occupied[rowIdx]?.[currentCol]) {
          currentCol++;
        }

        const colDef = this.columnDefs.get(item.key);
        const rowSpan = item.rowSpan ?? 1;
        const colSpan = item.colSpan ?? 1;

        // 배치 정보 저장 (grid는 1-based)
        this.cellPlacements.push({
          item,
          colDef,
          gridRow: rowIdx + 1,
          gridColumn: currentCol + 1,
          rowSpan,
          colSpan,
        });

        // 이 셀이 차지하는 영역 표시 및 그리드 컬럼 정보 수집
        for (let r = rowIdx; r < rowIdx + rowSpan && r < rowCount; r++) {
          for (let c = currentCol; c < currentCol + colSpan; c++) {
            if (!occupied[r]) occupied[r] = [];
            occupied[r][c] = { key: item.key, colSpan };

            // 그리드 컬럼 정보 업데이트
            if (this.gridColumnInfos[c]) {
              if (!this.gridColumnInfos[c].cellKeys.includes(item.key)) {
                this.gridColumnInfos[c].cellKeys.push(item.key);
              }
              // colSpan이 1인 셀을 primaryKey로 우선 선택 (개별 리사이즈 가능)
              if (colSpan === 1 && !this.gridColumnInfos[c].primaryKey) {
                this.gridColumnInfos[c].primaryKey = item.key;
              }
              if (colSpan > 1) {
                this.gridColumnInfos[c].isPartOfColSpan = true;
              }
            }
          }
        }

        currentCol += colSpan;
      }
    }

    // primaryKey가 없는 그리드 컬럼은 첫 번째 셀 key 사용
    for (const info of this.gridColumnInfos) {
      if (!info.primaryKey && info.cellKeys.length > 0) {
        info.primaryKey = info.cellKeys[0];
      }
    }
  }

  // ===========================================================================
  // 헤더 렌더링
  // ===========================================================================

  /**
   * Multi-Row 헤더 렌더링 (CSS Grid 사용)
   */
  renderHeader(container: HTMLElement): void {
    container.innerHTML = '';

    const gridContainer = document.createElement('div');
    gridContainer.className = 'ps-multi-row-header-grid';
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateRows = `repeat(${this.template.rowCount}, ${this.baseRowHeight}px)`;
    gridContainer.style.gridTemplateColumns = this.buildGridTemplateColumns();

    for (const placement of this.cellPlacements) {
      const cell = this.createHeaderCell(placement);
      gridContainer.appendChild(cell);
    }

    container.appendChild(gridContainer);
  }

  /**
   * 헤더 셀 생성
   */
  private createHeaderCell(placement: CellPlacement): HTMLElement {
    const { item, colDef, gridRow, gridColumn, rowSpan, colSpan } = placement;

    const cell = document.createElement('div');
    cell.className = 'ps-header-cell ps-multi-row-cell';
    cell.dataset['columnKey'] = item.key;

    // Grid 배치
    cell.style.gridRow = rowSpan > 1 ? `${gridRow} / span ${rowSpan}` : String(gridRow);
    cell.style.gridColumn = colSpan > 1 ? `${gridColumn} / span ${colSpan}` : String(gridColumn);

    // 첫 번째 그리드 컬럼에 있는 셀
    if (gridColumn === 1) {
      cell.classList.add('ps-first-column');
    }

    // 마지막 그리드 컬럼에 있는 셀인지 확인 (border-right 제거용)
    const endColumn = gridColumn + colSpan - 1;
    if (endColumn >= this.gridColumnCount) {
      cell.classList.add('ps-last-column');
    }

    // 마지막 그리드 행에 있는 셀인지 확인 (border-bottom 스타일용)
    const endRow = gridRow + rowSpan - 1;
    if (endRow >= this.template.rowCount) {
      cell.classList.add('ps-last-row');
    }

    // rowSpan이 있는 셀
    if (rowSpan > 1) {
      cell.classList.add('ps-rowspan');
    }

    // 스타일
    cell.style.display = 'flex';
    cell.style.alignItems = 'center';

    cell.textContent = colDef?.header ?? item.key;
    cell.title = colDef?.header ?? item.key;

    return cell;
  }

  // ===========================================================================
  // 바디 렌더링
  // ===========================================================================

  /**
   * Multi-Row 데이터 행 렌더링 (CSS Grid 사용)
   *
   * @deprecated updateDataRow 사용 권장 (RowPool과 함께)
   */
  renderDataRow(
    container: HTMLElement,
    rowData: Row,
    dataIndex: number,
    offsetY: number
  ): HTMLElement {
    const gridContainer = document.createElement('div');
    gridContainer.className = 'ps-multirow-container';
    gridContainer.style.position = 'absolute';
    gridContainer.style.left = '0';
    gridContainer.style.right = '0';
    gridContainer.style.transform = `translateY(${offsetY}px)`;
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateRows = `repeat(${this.template.rowCount}, ${this.baseRowHeight}px)`;
    gridContainer.style.gridTemplateColumns = this.buildGridTemplateColumns();
    gridContainer.dataset['dataIndex'] = String(dataIndex);

    for (const placement of this.cellPlacements) {
      const cell = this.createDataCell(placement, rowData);
      gridContainer.appendChild(cell);
    }

    container.appendChild(gridContainer);
    return gridContainer;
  }

  /**
   * 기존 Multi-Row 컨테이너 업데이트 (RowPool 재사용)
   *
   * 컨테이너는 RowPool에서 제공받고, 이 메서드는 내용만 채웁니다.
   * DOM 생성을 최소화하여 성능을 개선합니다.
   */
  updateDataRow(
    gridContainer: HTMLElement,
    rowData: Row,
    dataIndex: number,
    offsetY: number
  ): void {
    // 위치 및 dataIndex 업데이트
    gridContainer.style.transform = `translateY(${offsetY}px)`;
    gridContainer.style.gridTemplateRows = `repeat(${this.template.rowCount}, ${this.baseRowHeight}px)`;
    gridContainer.style.gridTemplateColumns = this.buildGridTemplateColumns();
    gridContainer.dataset['dataIndex'] = String(dataIndex);

    // 기존 셀 가져오기
    const existingCells = Array.from(gridContainer.children) as HTMLElement[];
    const requiredCellCount = this.cellPlacements.length;

    // 셀 수가 다르면 재생성 (레이아웃 변경 등)
    if (existingCells.length !== requiredCellCount) {
      gridContainer.innerHTML = '';
      for (const placement of this.cellPlacements) {
        const cell = this.createDataCell(placement, rowData);
        gridContainer.appendChild(cell);
      }
      return;
    }

    // 기존 셀 재사용: 내용만 업데이트
    for (let i = 0; i < requiredCellCount; i++) {
      const placement = this.cellPlacements[i];
      const cell = existingCells[i];
      this.updateDataCell(cell, placement, rowData);
    }
  }

  /**
   * 기존 데이터 셀 업데이트 (DOM 재사용)
   */
  private updateDataCell(cell: HTMLElement, placement: CellPlacement, rowData: Row): void {
    const { item, colDef } = placement;

    // 값 렌더링
    const value = rowData[item.key];
    const displayValue = this.formatValue(value, colDef);
    cell.textContent = displayValue;
    cell.title = displayValue;
  }

  /**
   * 데이터 셀 생성
   */
  private createDataCell(placement: CellPlacement, rowData: Row): HTMLElement {
    const { item, colDef, gridRow, gridColumn, rowSpan, colSpan } = placement;

    const cell = document.createElement('div');
    cell.className = 'ps-cell ps-multi-row-cell';
    cell.dataset['columnKey'] = item.key;

    // Grid 배치
    cell.style.gridRow = rowSpan > 1 ? `${gridRow} / span ${rowSpan}` : String(gridRow);
    cell.style.gridColumn = colSpan > 1 ? `${gridColumn} / span ${colSpan}` : String(gridColumn);

    // 첫 번째 그리드 컬럼에 있는 셀
    if (gridColumn === 1) {
      cell.classList.add('ps-first-column');
    }

    // 마지막 그리드 컬럼에 있는 셀인지 확인 (border-right 제거용)
    const endColumn = gridColumn + colSpan - 1;
    if (endColumn >= this.gridColumnCount) {
      cell.classList.add('ps-last-column');
    }

    // 마지막 그리드 행에 있는 셀인지 확인 (border-bottom 제거용)
    const endRow = gridRow + rowSpan - 1;
    if (endRow >= this.template.rowCount) {
      cell.classList.add('ps-last-row');
    }

    // rowSpan이 있는 셀
    if (rowSpan > 1) {
      cell.classList.add('ps-rowspan');
    }

    // 스타일
    cell.style.display = 'flex';
    cell.style.alignItems = 'center';

    // 값 렌더링
    const value = rowData[item.key];
    const displayValue = this.formatValue(value, colDef);
    cell.textContent = displayValue;
    cell.title = displayValue;

    return cell;
  }

  // ===========================================================================
  // 유틸리티
  // ===========================================================================

  /**
   * Grid 템플릿 컬럼 생성
   *
   * 각 그리드 컬럼에 대해 "primaryKey" 셀의 CSS 변수를 사용
   * - primaryKey: colSpan이 1인 셀 (개별 리사이즈 가능)
   * - colSpan > 1인 셀은 하위 셀들의 너비 합으로 자동 계산됨
   */
  private buildGridTemplateColumns(): string {
    const columnWidths: string[] = [];

    for (let i = 0; i < this.gridColumnCount; i++) {
      const info = this.gridColumnInfos[i];
      if (!info || !info.primaryKey) {
        columnWidths.push('100px'); // 폴백
        continue;
      }

      const colDef = this.columnDefs.get(info.primaryKey);
      const defaultWidth = colDef?.width ?? 100;
      columnWidths.push(`var(--col-${info.primaryKey}-width, ${defaultWidth}px)`);
    }

    return columnWidths.join(' ');
  }

  /**
   * 그리드 컬럼 정보 반환 (리사이즈 핸들용)
   */
  getGridColumnInfos(): GridColumnInfo[] {
    return this.gridColumnInfos;
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
