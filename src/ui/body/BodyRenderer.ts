/**
 * BodyRenderer - 바디 영역 렌더링
 *
 * VirtualScroller와 연동하여 보이는 행만 렌더링합니다.
 * RowPool을 사용하여 DOM 요소를 재사용합니다.
 */

import type { GridCore } from '../../core/GridCore';
import type { Row, ColumnDef } from '../../types';
import type { ColumnState, ColumnGroups, CellPosition } from '../types';
import { VirtualScroller } from '../VirtualScroller';
import { RowPool } from './RowPool';

/**
 * BodyRenderer 설정
 */
export interface BodyRendererOptions {
  /** 기본 행 높이 */
  rowHeight: number;
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 컬럼 상태 */
  columns: ColumnState[];
  /** 행 클릭 콜백 */
  onRowClick?: (rowIndex: number, row: Row, event: MouseEvent) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
}

/**
 * 바디 영역 렌더러
 */
export class BodyRenderer {
  private readonly gridCore: GridCore;
  private readonly rowHeight: number;

  // 컬럼 상태
  private columns: ColumnState[] = [];
  private columnDefs: Map<string, ColumnDef> = new Map();

  // 선택 상태
  private selectedRows: Set<string | number> = new Set();
  private focusedCell: CellPosition | null = null;

  // DOM 요소
  private container: HTMLElement;
  private scrollProxy: HTMLElement;
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  private rowContainer: HTMLElement;

  // 모듈
  private virtualScroller: VirtualScroller;
  private rowPool: RowPool;

  // 콜백
  private onRowClick?: BodyRendererOptions['onRowClick'];
  private onCellClick?: BodyRendererOptions['onCellClick'];
  private onCellDblClick?: BodyRendererOptions['onCellDblClick'];

  constructor(container: HTMLElement, options: BodyRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.rowHeight = options.rowHeight;
    this.columns = options.columns;
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;

    // 컬럼 정의 맵 생성
    for (const col of this.gridCore.getColumns()) {
      this.columnDefs.set(col.key, col);
    }

    // DOM 구조 생성
    this.scrollProxy = this.createElement('div', 'ps-scroll-proxy');
    this.spacer = this.createElement('div', 'ps-scroll-spacer');
    this.scrollProxy.appendChild(this.spacer);

    this.viewport = this.createElement('div', 'ps-viewport');
    this.rowContainer = this.createElement('div', 'ps-row-container');
    this.viewport.appendChild(this.rowContainer);

    this.container.appendChild(this.scrollProxy);
    this.container.appendChild(this.viewport);

    // 모듈 초기화
    this.virtualScroller = new VirtualScroller({
      estimatedRowHeight: this.rowHeight,
    });

    this.rowPool = new RowPool(this.rowContainer, this.columns.length);

    // VirtualScroller 연결
    this.virtualScroller.attach(this.scrollProxy, this.viewport, this.spacer);

    // 이벤트 바인딩
    this.virtualScroller.on('rangeChanged', this.onRangeChanged.bind(this));
    this.viewport.addEventListener('click', this.handleClick.bind(this));
    this.viewport.addEventListener('dblclick', this.handleDblClick.bind(this));

    // 초기 행 수 설정
    this.virtualScroller.setTotalRows(this.gridCore.getVisibleRowCount());
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 데이터 변경 시 새로고침
   */
  refresh(): void {
    this.virtualScroller.setTotalRows(this.gridCore.getVisibleRowCount());
    this.renderVisibleRows();
  }

  /**
   * 컬럼 상태 업데이트
   */
  updateColumns(columns: ColumnState[]): void {
    this.columns = columns;
    this.rowPool.updateColumnCount(columns.length);
    this.renderVisibleRows();
  }

  /**
   * 선택 상태 업데이트
   */
  updateSelection(selectedRows: Set<string | number>, focusedCell: CellPosition | null): void {
    this.selectedRows = selectedRows;
    this.focusedCell = focusedCell;
    this.updateRowSelectionStyles();
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    this.virtualScroller.scrollToRow(rowIndex);
  }

  /**
   * Viewport 크기 변경 처리
   */
  handleResize(): void {
    this.virtualScroller.updateViewportSize();
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.virtualScroller.destroy();
    this.rowPool.destroy();
    this.container.innerHTML = '';
  }

  // ===========================================================================
  // 렌더링 (Private)
  // ===========================================================================

  /**
   * 보이는 행 렌더링
   */
  private renderVisibleRows(): void {
    const state = this.virtualScroller.getState();
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    const columnGroups = this.getColumnGroups();
    const totalRowCount = this.gridCore.getVisibleRowCount();

    for (const [rowIndex, rowElement] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const rowData = this.gridCore.getRowByVisibleIndex(rowIndex);
      if (!rowData) continue;

      // startIndex를 전달하여 상대 위치 계산
      this.renderRow(rowElement, rowIndex, rowData, columnGroups, state.startIndex);
    }
  }

  /**
   * 단일 행 렌더링
   */
  private renderRow(
    rowElement: HTMLElement,
    rowIndex: number,
    rowData: Row,
    columnGroups: ColumnGroups,
    startIndex: number
  ): void {
    // Y 위치 설정 (viewport 기준 상대 위치)
    // Proxy Scrollbar 방식에서는 viewport가 스크롤되지 않으므로
    // startIndex 기준 상대 위치로 계산해야 함
    const relativeIndex = rowIndex - startIndex;
    const offsetY = relativeIndex * this.rowHeight;
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 데이터 속성
    rowElement.dataset['rowIndex'] = String(rowIndex);
    const rowId = rowData['id'];
    if (rowId !== undefined) {
      rowElement.dataset['rowId'] = String(rowId);
    }

    // 선택 상태
    const isSelected = rowId !== undefined && this.selectedRows.has(rowId);
    rowElement.classList.toggle('ps-selected', isSelected);

    // 셀 컨테이너 가져오기
    const leftContainer = rowElement.querySelector('.ps-cells-left') as HTMLElement;
    const centerContainer = rowElement.querySelector('.ps-cells-center') as HTMLElement;
    const rightContainer = rowElement.querySelector('.ps-cells-right') as HTMLElement;

    // 셀 렌더링
    this.renderCells(leftContainer, columnGroups.left, rowData, rowIndex);
    this.renderCells(centerContainer, columnGroups.center, rowData, rowIndex);
    this.renderCells(rightContainer, columnGroups.right, rowData, rowIndex);
  }

  /**
   * 셀 컨테이너 렌더링
   */
  private renderCells(
    container: HTMLElement,
    columns: ColumnState[],
    rowData: Row,
    rowIndex: number
  ): void {
    // 필요한 셀 수 맞추기
    while (container.children.length > columns.length) {
      container.lastChild?.remove();
    }
    while (container.children.length < columns.length) {
      const cell = this.createElement('div', 'ps-cell');
      container.appendChild(cell);
    }

    // 셀 내용 업데이트
    const cells = container.children;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (!column) continue;

      const cell = cells[i] as HTMLElement;
      const value = rowData[column.key];
      const colDef = this.columnDefs.get(column.key);

      // 너비 설정 (CSS 변수 사용)
      cell.style.width = `var(--col-${column.key}-width, ${column.width}px)`;

      // 데이터 속성
      cell.dataset['columnKey'] = column.key;

      // 포커스 상태
      const isFocused = this.focusedCell?.rowIndex === rowIndex &&
        this.focusedCell?.columnKey === column.key;
      cell.classList.toggle('ps-focused', isFocused);

      // 값 렌더링
      const displayValue = this.formatCellValue(value, colDef);
      cell.textContent = displayValue;
      cell.title = displayValue; // 툴팁
    }
  }

  /**
   * 셀 값 포맷팅
   */
  private formatCellValue(value: unknown, colDef?: ColumnDef): string {
    if (value === null || value === undefined) {
      return '';
    }

    // 컬럼 정의에 formatter가 있으면 사용
    if (colDef?.formatter) {
      return colDef.formatter(value);
    }

    // 기본 문자열 변환
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * VirtualScroller의 rangeChanged 이벤트 처리
   */
  private onRangeChanged(_range: { startIndex: number; endIndex: number }): void {
    this.renderVisibleRows();
  }

  /**
   * 클릭 이벤트 처리
   */
  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cell = target.closest('.ps-cell') as HTMLElement | null;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!row) return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    const rowData = this.gridCore.getRowByVisibleIndex(rowIndex);
    if (!rowData) return;

    // 셀 클릭
    if (cell && this.onCellClick) {
      const columnKey = cell.dataset['columnKey'];
      if (columnKey) {
        const value = rowData[columnKey];
        this.onCellClick({ rowIndex, columnKey }, value, event);
      }
    }

    // 행 클릭
    if (this.onRowClick) {
      this.onRowClick(rowIndex, rowData, event);
    }
  }

  /**
   * 더블클릭 이벤트 처리
   */
  private handleDblClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cell = target.closest('.ps-cell') as HTMLElement | null;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!row || !cell) return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    const columnKey = cell.dataset['columnKey'];
    if (!columnKey) return;

    const rowData = this.gridCore.getRowByVisibleIndex(rowIndex);
    if (!rowData) return;

    if (this.onCellDblClick) {
      const value = rowData[columnKey];
      this.onCellDblClick({ rowIndex, columnKey }, value, event);
    }
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 그룹 분류 (Left, Center, Right)
   */
  private getColumnGroups(): ColumnGroups {
    const left: ColumnState[] = [];
    const center: ColumnState[] = [];
    const right: ColumnState[] = [];

    for (const col of this.columns) {
      if (!col.visible) continue;

      switch (col.pinned) {
        case 'left':
          left.push(col);
          break;
        case 'right':
          right.push(col);
          break;
        default:
          center.push(col);
      }
    }

    // 순서대로 정렬
    const sortByOrder = (a: ColumnState, b: ColumnState) => a.order - b.order;
    left.sort(sortByOrder);
    center.sort(sortByOrder);
    right.sort(sortByOrder);

    return { left, center, right };
  }

  /**
   * 선택 상태 스타일 업데이트
   */
  private updateRowSelectionStyles(): void {
    for (const [rowIndex, rowElement] of this.rowPool.getActiveRows()) {
      const rowData = this.gridCore.getRowByVisibleIndex(rowIndex);
      if (!rowData) continue;

      const rowId = rowData['id'];
      const isSelected = rowId !== undefined && this.selectedRows.has(rowId);
      rowElement.classList.toggle('ps-selected', isSelected);

      // 포커스된 셀 업데이트
      if (this.focusedCell?.rowIndex === rowIndex) {
        const cells = rowElement.querySelectorAll('.ps-cell');
        cells.forEach((cell) => {
          const el = cell as HTMLElement;
          const isFocused = el.dataset['columnKey'] === this.focusedCell?.columnKey;
          el.classList.toggle('ps-focused', isFocused);
        });
      }
    }
  }

  /**
   * DOM 요소 생성 헬퍼
   */
  private createElement(tag: string, className: string): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  }
}
