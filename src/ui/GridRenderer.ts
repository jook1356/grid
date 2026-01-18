/**
 * GridRenderer - DOM 렌더링 총괄
 *
 * 그리드의 전체 DOM 구조를 생성하고 관리합니다.
 * - 헤더, 바디 영역 생성
 * - CSS 변수를 통한 컬럼 너비 관리
 * - 테마 적용
 */

import type { GridCore } from '../core/GridCore';
import type { ColumnDef } from '../types';
import type { RowTemplate, RowLayoutItem } from '../types/grouping.types';
import type { ColumnState, PureSheetOptions, ColumnGroups } from './types';
import { BodyRenderer } from './body/BodyRenderer';

// CSS 스타일 삽입 여부 추적
let styleInjected = false;

/**
 * GridRenderer 설정
 */
export interface GridRendererOptions {
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** PureSheet 옵션 */
  options: PureSheetOptions;
  /** 행 클릭 콜백 */
  onRowClick?: (rowIndex: number, row: Record<string, unknown>, event: MouseEvent) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (
    position: { rowIndex: number; columnKey: string },
    value: unknown,
    event: MouseEvent
  ) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (
    position: { rowIndex: number; columnKey: string },
    value: unknown,
    event: MouseEvent
  ) => void;
  /** 그룹 토글 콜백 */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
}

/**
 * 그리드 DOM 렌더러
 */
export class GridRenderer {
  private readonly gridCore: GridCore;
  private readonly container: HTMLElement;
  private readonly options: PureSheetOptions;

  // 컬럼 상태
  private columnStates: ColumnState[] = [];

  // DOM 요소
  private gridContainer: HTMLElement | null = null;
  private headerElement: HTMLElement | null = null;
  private bodyElement: HTMLElement | null = null;

  // 모듈
  private bodyRenderer: BodyRenderer | null = null;

  // 콜백
  private onRowClick?: GridRendererOptions['onRowClick'];
  private onCellClick?: GridRendererOptions['onCellClick'];
  private onCellDblClick?: GridRendererOptions['onCellDblClick'];
  private onGroupToggle?: GridRendererOptions['onGroupToggle'];

  // ResizeObserver
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, options: GridRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.options = options.options;
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;
    this.onGroupToggle = options.onGroupToggle;

    // 스타일 삽입
    this.injectStyles();

    // 컬럼 상태 초기화
    this.initializeColumnStates();

    // DOM 구조 생성
    this.createDOMStructure();

    // ResizeObserver 설정
    this.setupResizeObserver();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 전체 새로고침
   */
  refresh(): void {
    this.bodyRenderer?.refresh();
  }

  /**
   * 컬럼 상태 가져오기
   */
  getColumnStates(): ColumnState[] {
    return [...this.columnStates];
  }

  /**
   * 컬럼 너비 설정
   */
  setColumnWidth(columnKey: string, width: number): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.width = Math.max(50, width);
      this.updateColumnWidthCSS(columnKey, state.width);
    }
  }

  /**
   * 컬럼 고정 설정
   */
  setColumnPinned(columnKey: string, pinned: 'left' | 'right' | 'none'): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.pinned = pinned;
      this.renderHeader();
      this.bodyRenderer?.updateColumns(this.columnStates);
    }
  }

  /**
   * 컬럼 가시성 설정
   */
  setColumnVisible(columnKey: string, visible: boolean): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.visible = visible;
      this.renderHeader();
      this.bodyRenderer?.updateColumns(this.columnStates);
    }
  }

  /**
   * 컬럼 순서 설정
   */
  setColumnOrder(order: string[]): void {
    order.forEach((key, index) => {
      const state = this.columnStates.find((c) => c.key === key);
      if (state) {
        state.order = index;
      }
    });
    this.columnStates.sort((a, b) => a.order - b.order);
    this.renderHeader();
    this.bodyRenderer?.updateColumns(this.columnStates);
  }

  /**
   * 선택 상태 업데이트
   */
  updateSelection(
    selectedRows: Set<string | number>,
    focusedCell: { rowIndex: number; columnKey: string } | null
  ): void {
    this.bodyRenderer?.updateSelection(selectedRows, focusedCell);
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    this.bodyRenderer?.scrollToRow(rowIndex);
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.bodyRenderer?.destroy();

    if (this.gridContainer) {
      this.gridContainer.remove();
    }
  }

  // ===========================================================================
  // 초기화 (Private)
  // ===========================================================================

  /**
   * 스타일 삽입 (한 번만)
   */
  private injectStyles(): void {
    if (styleInjected) return;

    // 동적으로 CSS를 삽입하는 대신, 사용자가 CSS 파일을 import하도록 안내
    // 여기서는 최소한의 인라인 스타일만 적용
    styleInjected = true;
  }

  /**
   * 컬럼 상태 초기화
   */
  private initializeColumnStates(): void {
    const columns = this.gridCore.getColumns();
    this.columnStates = columns.map((col, index) => ({
      key: col.key,
      width: col.width ?? 100,
      pinned: (col.pinned as 'left' | 'right') ?? 'none',
      visible: col.visible !== false,
      order: index,
    }));
  }

  /**
   * DOM 구조 생성
   */
  private createDOMStructure(): void {
    // 메인 컨테이너
    this.gridContainer = document.createElement('div');
    this.gridContainer.className = 'ps-grid-container';

    // 테마 적용
    if (this.options.theme === 'dark') {
      this.gridContainer.classList.add('ps-theme-dark');
    }

    // CSS 변수로 컬럼 너비 설정
    this.initializeColumnWidthCSS();

    // 헤더 영역
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'ps-header';
    this.gridContainer.appendChild(this.headerElement);

    // 바디 영역
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'ps-body';
    this.gridContainer.appendChild(this.bodyElement);

    // 컨테이너에 추가
    this.container.appendChild(this.gridContainer);

    // 헤더 렌더링
    this.renderHeader();

    // BodyRenderer 초기화
    this.bodyRenderer = new BodyRenderer(this.bodyElement, {
      rowHeight: this.options.rowHeight ?? 36,
      gridCore: this.gridCore,
      columns: this.columnStates,
      groupingConfig: this.options.groupingConfig,
      rowTemplate: this.options.rowTemplate,
      onRowClick: this.onRowClick,
      onCellClick: this.onCellClick,
      onCellDblClick: this.onCellDblClick,
      onGroupToggle: this.onGroupToggle,
    });

    // 가로 스크롤 동기화 설정
    this.setupHorizontalScrollSync();
  }

  /**
   * BodyRenderer 인스턴스 반환
   */
  getBodyRenderer(): BodyRenderer | null {
    return this.bodyRenderer;
  }

  /**
   * 헤더와 바디의 가로 스크롤 동기화
   */
  private setupHorizontalScrollSync(): void {
    if (!this.headerElement || !this.bodyRenderer) return;

    const viewport = this.bodyRenderer.getViewport();
    const header = this.headerElement;

    // Viewport 스크롤 시 → 헤더도 스크롤
    viewport.addEventListener('scroll', () => {
      header.scrollLeft = viewport.scrollLeft;
    }, { passive: true });

    // 헤더 스크롤 시 → Viewport도 스크롤 (드래그 등으로 직접 스크롤할 경우)
    header.addEventListener('scroll', () => {
      if (Math.abs(viewport.scrollLeft - header.scrollLeft) > 1) {
        viewport.scrollLeft = header.scrollLeft;
      }
    }, { passive: true });
  }

  /**
   * ResizeObserver 설정
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(() => {
      this.bodyRenderer?.handleResize();
    });

    if (this.gridContainer) {
      this.resizeObserver.observe(this.gridContainer);
    }
  }

  // ===========================================================================
  // 헤더 렌더링 (Private)
  // ===========================================================================

  /**
   * 헤더 렌더링
   */
  private renderHeader(): void {
    if (!this.headerElement) return;

    this.headerElement.innerHTML = '';

    const columnDefs = new Map<string, ColumnDef>();
    for (const col of this.gridCore.getColumns()) {
      columnDefs.set(col.key, col);
    }

    // Multi-Row 모드일 때는 다르게 렌더링
    if (this.options.rowTemplate) {
      this.renderMultiRowHeader(columnDefs);
      return;
    }

    // 일반 헤더 렌더링
    const headerRow = document.createElement('div');
    headerRow.className = 'ps-header-row';

    const columnGroups = this.getColumnGroups();

    // Left 헤더 셀
    const leftContainer = this.createHeaderCellsContainer('ps-cells-left', columnGroups.left, columnDefs);
    headerRow.appendChild(leftContainer);

    // Center 헤더 셀
    const centerContainer = this.createHeaderCellsContainer('ps-cells-center', columnGroups.center, columnDefs);
    headerRow.appendChild(centerContainer);

    // Right 헤더 셀
    const rightContainer = this.createHeaderCellsContainer('ps-cells-right', columnGroups.right, columnDefs);
    headerRow.appendChild(rightContainer);

    this.headerElement.appendChild(headerRow);
  }

  /**
   * Multi-Row 헤더 렌더링 (CSS Grid 사용)
   */
  private renderMultiRowHeader(columnDefs: Map<string, ColumnDef>): void {
    if (!this.headerElement || !this.options.rowTemplate) return;

    const template = this.options.rowTemplate;
    const baseRowHeight = this.options.rowHeight ?? 36;

    // 셀 배치 계산
    const cellPlacements = this.calculateMultiRowCellPlacements(template);

    // 그리드 컬럼 정보 계산
    const gridColumnInfos = this.calculateGridColumnInfos(template);
    const gridColumnCount = gridColumnInfos.length;

    // Grid 컨테이너
    const gridContainer = document.createElement('div');
    gridContainer.className = 'ps-multi-row-header-grid';
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateRows = `repeat(${template.rowCount}, ${baseRowHeight}px)`;
    gridContainer.style.gridTemplateColumns = this.buildGridTemplateColumns(template, columnDefs, gridColumnInfos);

    // 각 셀 렌더링
    for (const placement of cellPlacements) {
      const cell = this.createMultiRowHeaderCell(
        placement, 
        columnDefs, 
        gridColumnCount, 
        template.rowCount,
        gridColumnInfos
      );
      gridContainer.appendChild(cell);
    }

    this.headerElement.appendChild(gridContainer);
  }

  /**
   * Multi-Row 셀 배치 계산
   */
  private calculateMultiRowCellPlacements(template: RowTemplate): Array<{
    item: RowLayoutItem;
    gridRow: number;
    gridColumn: number;
    rowSpan: number;
    colSpan: number;
  }> {
    const placements: Array<{
      item: RowLayoutItem;
      gridRow: number;
      gridColumn: number;
      rowSpan: number;
      colSpan: number;
    }> = [];

    const rowCount = template.rowCount;
    const occupied: boolean[][] = Array.from({ length: rowCount }, () => []);

    for (let rowIdx = 0; rowIdx < template.layout.length; rowIdx++) {
      const layoutRow = template.layout[rowIdx];
      let currentCol = 0;

      for (const item of layoutRow) {
        // 이미 차지된 셀 건너뛰기
        while (occupied[rowIdx]?.[currentCol]) {
          currentCol++;
        }

        const rowSpan = item.rowSpan ?? 1;
        const colSpan = item.colSpan ?? 1;

        placements.push({
          item,
          gridRow: rowIdx + 1,
          gridColumn: currentCol + 1,
          rowSpan,
          colSpan,
        });

        // 차지하는 영역 표시
        for (let r = rowIdx; r < rowIdx + rowSpan && r < rowCount; r++) {
          for (let c = currentCol; c < currentCol + colSpan; c++) {
            if (!occupied[r]) occupied[r] = [];
            occupied[r][c] = true;
          }
        }

        currentCol += colSpan;
      }
    }

    return placements;
  }

  /**
   * Grid 템플릿 컬럼 생성
   * 각 그리드 컬럼에 대해 "primaryKey" 셀의 CSS 변수를 사용
   */
  private buildGridTemplateColumns(
    template: RowTemplate,
    columnDefs: Map<string, ColumnDef>,
    gridColumnInfos: Array<{ primaryKey: string }>
  ): string {
    const columnWidths: string[] = [];

    for (const info of gridColumnInfos) {
      if (!info.primaryKey) {
        columnWidths.push('100px');
        continue;
      }

      const colDef = columnDefs.get(info.primaryKey);
      const colState = this.columnStates.find(c => c.key === info.primaryKey);
      const defaultWidth = colState?.width ?? colDef?.width ?? 100;
      columnWidths.push(`var(--col-${info.primaryKey}-width, ${defaultWidth}px)`);
    }

    return columnWidths.join(' ');
  }

  /**
   * 그리드 컬럼 정보 계산
   */
  private calculateGridColumnInfos(template: RowTemplate): Array<{ 
    primaryKey: string; 
    cellKeys: string[];
  }> {
    const rowCount = template.rowCount;
    const occupied: Array<Array<{ key: string; colSpan: number } | null>> = 
      Array.from({ length: rowCount }, () => []);

    // 그리드 컬럼 수 계산
    let gridColumnCount = 0;
    for (const item of template.layout[0] ?? []) {
      gridColumnCount += item.colSpan ?? 1;
    }

    // 그리드 컬럼 정보 초기화
    const gridColumnInfos: Array<{ primaryKey: string; cellKeys: string[] }> = 
      Array.from({ length: gridColumnCount }, () => ({ primaryKey: '', cellKeys: [] }));

    for (let rowIdx = 0; rowIdx < template.layout.length; rowIdx++) {
      const layoutRow = template.layout[rowIdx];
      let currentCol = 0;

      for (const item of layoutRow) {
        while (occupied[rowIdx]?.[currentCol]) {
          currentCol++;
        }

        const rowSpan = item.rowSpan ?? 1;
        const colSpan = item.colSpan ?? 1;

        for (let r = rowIdx; r < rowIdx + rowSpan && r < rowCount; r++) {
          for (let c = currentCol; c < currentCol + colSpan; c++) {
            if (!occupied[r]) occupied[r] = [];
            occupied[r][c] = { key: item.key, colSpan };

            if (gridColumnInfos[c]) {
              if (!gridColumnInfos[c].cellKeys.includes(item.key)) {
                gridColumnInfos[c].cellKeys.push(item.key);
              }
              // colSpan이 1인 셀을 primaryKey로 우선 선택
              if (colSpan === 1 && !gridColumnInfos[c].primaryKey) {
                gridColumnInfos[c].primaryKey = item.key;
              }
            }
          }
        }

        currentCol += colSpan;
      }
    }

    // primaryKey가 없는 그리드 컬럼은 첫 번째 셀 key 사용
    for (const info of gridColumnInfos) {
      if (!info.primaryKey && info.cellKeys.length > 0) {
        info.primaryKey = info.cellKeys[0];
      }
    }

    return gridColumnInfos;
  }

  /**
   * Multi-Row 헤더 셀 생성 (CSS Grid 배치)
   */
  private createMultiRowHeaderCell(
    placement: { item: RowLayoutItem; gridRow: number; gridColumn: number; rowSpan: number; colSpan: number },
    columnDefs: Map<string, ColumnDef>,
    gridColumnCount: number,
    rowCount: number,
    gridColumnInfos: Array<{ primaryKey: string; cellKeys: string[] }>
  ): HTMLElement {
    const { item, gridRow, gridColumn, rowSpan, colSpan } = placement;
    const colDef = columnDefs.get(item.key);

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
    if (endColumn >= gridColumnCount) {
      cell.classList.add('ps-last-column');
    }

    // 마지막 그리드 행에 있는 셀인지 확인
    const endRow = gridRow + rowSpan - 1;
    if (endRow >= rowCount) {
      cell.classList.add('ps-last-row');
    }

    // rowSpan이 있는 셀
    if (rowSpan > 1) {
      cell.classList.add('ps-rowspan');
    }

    // 스타일
    cell.style.display = 'flex';
    cell.style.alignItems = 'center';

    // 헤더 텍스트
    cell.textContent = colDef?.header ?? item.key;
    cell.title = colDef?.header ?? item.key;

    // 리사이즈 핸들
    // 리사이즈 시 이 셀이 끝나는 그리드 컬럼의 primaryKey를 사용
    if (this.options.resizableColumns !== false) {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'ps-resize-handle';
      
      // 이 셀이 끝나는 그리드 컬럼 (0-based index)
      const endColIndex = gridColumn + colSpan - 2; // gridColumn is 1-based
      const resizeKey = gridColumnInfos[endColIndex]?.primaryKey ?? item.key;
      
      resizeHandle.addEventListener('mousedown', (e) => this.startResize(e, resizeKey));
      cell.appendChild(resizeHandle);
    }

    return cell;
  }

  /**
   * 헤더 셀 컨테이너 생성
   */
  private createHeaderCellsContainer(
    className: string,
    columns: ColumnState[],
    columnDefs: Map<string, ColumnDef>
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = className;

    for (const col of columns) {
      const colDef = columnDefs.get(col.key);
      const header = colDef?.header ?? col.key;

      const cell = document.createElement('div');
      cell.className = 'ps-header-cell';
      cell.style.width = `var(--col-${col.key}-width, ${col.width}px)`;
      cell.textContent = header;
      cell.dataset['columnKey'] = col.key;

      // 리사이즈 핸들 (옵션에 따라)
      if (this.options.resizableColumns !== false) {
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'ps-resize-handle';
        resizeHandle.addEventListener('mousedown', (e) => this.startResize(e, col.key));
        cell.appendChild(resizeHandle);
      }

      container.appendChild(cell);
    }

    return container;
  }

  // ===========================================================================
  // 컬럼 리사이즈 (Private)
  // ===========================================================================

  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizeColumnKey = '';

  /**
   * 리사이즈 시작
   */
  private startResize(e: MouseEvent, columnKey: string): void {
    e.preventDefault();
    e.stopPropagation();

    this.resizing = true;
    this.resizeStartX = e.clientX;
    this.resizeColumnKey = columnKey;

    const state = this.columnStates.find((c) => c.key === columnKey);
    this.resizeStartWidth = state?.width ?? 100;

    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  /**
   * 리사이즈 중
   */
  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.resizing) return;

    requestAnimationFrame(() => {
      const delta = e.clientX - this.resizeStartX;
      const newWidth = Math.max(50, this.resizeStartWidth + delta);
      this.setColumnWidth(this.resizeColumnKey, newWidth);
    });
  };

  /**
   * 리사이즈 종료
   */
  private handleResizeEnd = (): void => {
    this.resizing = false;
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 너비 CSS 변수 초기화
   */
  private initializeColumnWidthCSS(): void {
    if (!this.gridContainer) return;

    for (const col of this.columnStates) {
      this.gridContainer.style.setProperty(`--col-${col.key}-width`, `${col.width}px`);
    }
  }

  /**
   * 컬럼 너비 CSS 변수 업데이트
   */
  private updateColumnWidthCSS(columnKey: string, width: number): void {
    if (!this.gridContainer) return;
    this.gridContainer.style.setProperty(`--col-${columnKey}-width`, `${width}px`);
  }

  /**
   * 컬럼 그룹 분류
   */
  private getColumnGroups(): ColumnGroups {
    const left: ColumnState[] = [];
    const center: ColumnState[] = [];
    const right: ColumnState[] = [];

    for (const col of this.columnStates) {
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

    const sortByOrder = (a: ColumnState, b: ColumnState) => a.order - b.order;
    left.sort(sortByOrder);
    center.sort(sortByOrder);
    right.sort(sortByOrder);

    return { left, center, right };
  }
}
