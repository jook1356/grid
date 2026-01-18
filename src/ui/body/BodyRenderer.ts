/**
 * BodyRenderer - 바디 영역 렌더링
 *
 * VirtualScroller와 연동하여 보이는 행만 렌더링합니다.
 * RowPool을 사용하여 DOM 요소를 재사용합니다.
 * GroupManager를 통해 그룹화된 데이터를 렌더링합니다.
 * MultiRowRenderer를 통해 Multi-Row 레이아웃을 지원합니다.
 */

import type { GridCore } from '../../core/GridCore';
import type { Row, ColumnDef, CellValue } from '../../types';
import type { VirtualRow, GroupHeaderRow, DataRow, GroupingConfig, RowTemplate } from '../../types/grouping.types';
import type { ColumnState, ColumnGroups, CellPosition } from '../types';
import { VirtualScroller } from '../VirtualScroller';
import { RowPool } from './RowPool';
import { GroupManager } from '../grouping/GroupManager';
import { MultiRowRenderer } from '../multirow/MultiRowRenderer';

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
  /** 그룹화 설정 (선택) */
  groupingConfig?: GroupingConfig;
  /** Multi-Row 템플릿 (선택) */
  rowTemplate?: RowTemplate;
  /** 행 클릭 콜백 */
  onRowClick?: (rowIndex: number, row: Row, event: MouseEvent) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 그룹 토글 콜백 */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
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
  private groupManager: GroupManager;
  private multiRowRenderer: MultiRowRenderer | null = null;

  // Multi-Row 설정
  private rowTemplate: RowTemplate | null = null;

  // 가상 행 (그룹화된 경우 그룹 헤더 포함)
  private virtualRows: VirtualRow[] = [];

  // 콜백
  private onRowClick?: BodyRendererOptions['onRowClick'];
  private onCellClick?: BodyRendererOptions['onCellClick'];
  private onCellDblClick?: BodyRendererOptions['onCellDblClick'];
  private onGroupToggle?: BodyRendererOptions['onGroupToggle'];

  constructor(container: HTMLElement, options: BodyRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.rowHeight = options.rowHeight;
    this.columns = options.columns;
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;
    this.onGroupToggle = options.onGroupToggle;

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

    // GroupManager 초기화
    this.groupManager = new GroupManager({
      config: options.groupingConfig,
    });

    // Multi-Row 템플릿이 있으면 MultiRowRenderer 및 RowPool 초기화
    if (options.rowTemplate) {
      this.rowTemplate = options.rowTemplate;
      this.multiRowRenderer = new MultiRowRenderer(
        options.rowTemplate,
        this.columnDefs,
        this.rowHeight
      );
      // RowPool에도 템플릿 설정 (Multi-Row 컨테이너 구조 사용)
      this.rowPool.setMultiRowTemplate(options.rowTemplate);
    }

    // VirtualScroller 연결
    this.virtualScroller.attach(this.scrollProxy, this.viewport, this.spacer);

    // 이벤트 바인딩
    this.virtualScroller.on('rangeChanged', this.onRangeChanged.bind(this));
    this.viewport.addEventListener('click', this.handleClick.bind(this));
    this.viewport.addEventListener('dblclick', this.handleDblClick.bind(this));

    // 초기 행 수 설정
    this.updateVirtualRows();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 데이터 변경 시 새로고침
   */
  refresh(): void {
    this.updateVirtualRows();
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
   * 그룹화 설정
   */
  setGroupingConfig(config: GroupingConfig | null): void {
    if (config) {
      this.groupManager.setConfig(config);
    } else {
      this.groupManager.setGroupColumns([]);
    }
    this.refresh();
  }

  /**
   * 그룹 접기/펼치기
   */
  toggleGroup(groupId: string): void {
    this.groupManager.toggleGroup(groupId);
    this.refresh();
  }

  /**
   * 모든 그룹 펼치기
   */
  expandAllGroups(): void {
    this.groupManager.expandAll();
    this.refresh();
  }

  /**
   * 모든 그룹 접기
   */
  collapseAllGroups(): void {
    const data = this.gridCore.getAllData();
    this.groupManager.collapseAll(data);
    this.refresh();
  }

  /**
   * GroupManager 인스턴스 반환
   */
  getGroupManager(): GroupManager {
    return this.groupManager;
  }

  /**
   * Multi-Row 템플릿 설정
   */
  setRowTemplate(template: RowTemplate | null): void {
    this.rowTemplate = template;

    // RowPool에도 템플릿 설정 (구조 변경 시 풀 초기화됨)
    this.rowPool.setMultiRowTemplate(template);

    if (template) {
      this.multiRowRenderer = new MultiRowRenderer(
        template,
        this.columnDefs,
        this.rowHeight
      );
    } else {
      this.multiRowRenderer = null;
    }

    // 활성 행 초기화 후 다시 렌더링
    this.rowPool.clear();
    this.refresh();
  }

  /**
   * Multi-Row 렌더러 반환
   */
  getMultiRowRenderer(): MultiRowRenderer | null {
    return this.multiRowRenderer;
  }

  /**
   * Multi-Row 모드인지 확인
   */
  isMultiRowMode(): boolean {
    return this.multiRowRenderer !== null;
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
   * Viewport 요소 반환 (스크롤 동기화용)
   */
  getViewport(): HTMLElement {
    return this.viewport;
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
   * VirtualRows 업데이트
   */
  private updateVirtualRows(): void {
    const data = this.gridCore.getAllData();
    this.virtualRows = this.groupManager.flattenWithGroups(data);

    // Multi-Row 모드에서는 총 행 수가 달라짐
    // (데이터 수가 아닌, 가상 행 수 × Multi-Row 템플릿 rowCount)
    // VirtualScroller는 여전히 "데이터 행" 수로 관리하고,
    // 렌더링 시에만 여러 visual row를 그림
    this.virtualScroller.setTotalRows(this.virtualRows.length);
  }

  /**
   * Multi-Row 모드에서 사용할 실제 행 높이
   */
  private getEffectiveRowHeight(): number {
    if (this.multiRowRenderer) {
      return this.multiRowRenderer.getTotalRowHeight();
    }
    return this.rowHeight;
  }

  /**
   * 보이는 행 렌더링
   */
  private renderVisibleRows(): void {
    const state = this.virtualScroller.getState();

    // 화면에 보이는 첫 번째 행 인덱스 (overscan 미포함)
    const visibleStartIndex = this.virtualScroller.getVisibleStartIndex();

    // 맨 아래 스크롤 시 마지막 행이 잘리지 않도록 하는 오프셋
    const rowOffset = this.virtualScroller.getRowOffset();

    const columnGroups = this.getColumnGroups();
    const totalRowCount = this.virtualRows.length;

    // Multi-Row 모드
    if (this.multiRowRenderer) {
      this.renderMultiRowMode(state, visibleStartIndex, rowOffset, totalRowCount);
      return;
    }

    // 일반 모드
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    for (const [rowIndex, rowElement] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow) continue;

      // VirtualRow 타입에 따라 렌더링
      if (virtualRow.type === 'group-header') {
        this.renderGroupHeader(rowElement, rowIndex, virtualRow, visibleStartIndex, rowOffset);
      } else {
        this.renderDataRow(rowElement, rowIndex, virtualRow, columnGroups, visibleStartIndex, rowOffset);
      }
    }
  }

  /**
   * Multi-Row 모드 렌더링
   *
   * RowPool을 사용하여 컨테이너를 재활용합니다.
   * 스크롤 시 DOM 생성을 최소화하여 성능을 개선합니다.
   */
  private renderMultiRowMode(
    state: { startIndex: number; endIndex: number },
    visibleStartIndex: number,
    rowOffset: number,
    totalRowCount: number
  ): void {
    if (!this.multiRowRenderer) return;

    const effectiveRowHeight = this.multiRowRenderer.getTotalRowHeight();

    // RowPool을 사용하여 보이는 범위의 행 컨테이너 획득/반환
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    for (const [rowIndex, container] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow || virtualRow.type !== 'data') continue;

      const relativeIndex = rowIndex - visibleStartIndex;
      const offsetY = relativeIndex * effectiveRowHeight + rowOffset;

      // 기존 컨테이너 재사용: 내용만 업데이트
      this.multiRowRenderer.updateDataRow(
        container,
        virtualRow.data,
        virtualRow.dataIndex,
        offsetY
      );
    }
  }

  /**
   * 그룹 헤더 행 렌더링
   */
  private renderGroupHeader(
    rowElement: HTMLElement,
    rowIndex: number,
    groupRow: GroupHeaderRow,
    visibleStartIndex: number,
    rowOffset: number = 0
  ): void {
    // Y 위치 설정
    const relativeIndex = rowIndex - visibleStartIndex;
    const offsetY = relativeIndex * this.rowHeight + rowOffset;
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 그룹 헤더 스타일
    rowElement.classList.add('ps-group-header');
    rowElement.classList.remove('ps-selected');
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['groupId'] = groupRow.groupId;
    rowElement.dataset['rowType'] = 'group-header';

    // 셀 컨테이너 비우고 그룹 헤더 콘텐츠로 교체
    const leftContainer = rowElement.querySelector('.ps-cells-left') as HTMLElement;
    const centerContainer = rowElement.querySelector('.ps-cells-center') as HTMLElement;
    const rightContainer = rowElement.querySelector('.ps-cells-right') as HTMLElement;

    // 왼쪽과 오른쪽 컨테이너 비우기
    leftContainer.innerHTML = '';
    rightContainer.innerHTML = '';

    // 중앙에 그룹 헤더 콘텐츠 표시
    centerContainer.innerHTML = '';
    centerContainer.style.paddingLeft = `${groupRow.level * 20 + 8}px`;

    // 토글 아이콘
    const toggleIcon = this.createElement('span', 'ps-group-toggle');
    toggleIcon.textContent = groupRow.collapsed ? '▶' : '▼';
    toggleIcon.style.cursor = 'pointer';
    toggleIcon.style.marginRight = '8px';
    centerContainer.appendChild(toggleIcon);

    // 그룹 라벨
    const label = this.createElement('span', 'ps-group-label');
    label.innerHTML = `<strong>${groupRow.value}</strong> (${groupRow.itemCount} items)`;
    centerContainer.appendChild(label);

    // 집계 값 표시
    const aggregates = Object.entries(groupRow.aggregates);
    if (aggregates.length > 0) {
      const aggContainer = this.createElement('span', 'ps-group-aggregates');
      aggContainer.style.marginLeft = '16px';
      aggContainer.style.color = '#666';
      for (const [key, value] of aggregates) {
        const aggSpan = this.createElement('span', 'ps-group-aggregate');
        aggSpan.style.marginRight = '12px';
        aggSpan.textContent = `${key}: ${this.formatAggregateValue(value)}`;
        aggContainer.appendChild(aggSpan);
      }
      centerContainer.appendChild(aggContainer);
    }
  }

  /**
   * 집계 값 포맷팅
   */
  private formatAggregateValue(value: CellValue): string {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(value);
  }

  /**
   * 데이터 행 렌더링
   */
  private renderDataRow(
    rowElement: HTMLElement,
    rowIndex: number,
    dataRow: DataRow,
    columnGroups: ColumnGroups,
    visibleStartIndex: number,
    rowOffset: number = 0
  ): void {
    const rowData = dataRow.data;

    // Y 위치 설정 (viewport 기준 상대 위치)
    const relativeIndex = rowIndex - visibleStartIndex;
    const offsetY = relativeIndex * this.rowHeight + rowOffset;
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 그룹 헤더 스타일 제거
    rowElement.classList.remove('ps-group-header');
    rowElement.dataset['rowType'] = 'data';

    // 데이터 속성
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['dataIndex'] = String(dataRow.dataIndex);
    const rowId = rowData['id'];
    if (rowId !== undefined) {
      rowElement.dataset['rowId'] = String(rowId);
    }
    delete rowElement.dataset['groupId'];

    // 선택 상태
    const isSelected = rowId !== undefined && this.selectedRows.has(rowId);
    rowElement.classList.toggle('ps-selected', isSelected);

    // 셀 컨테이너 가져오기
    const leftContainer = rowElement.querySelector('.ps-cells-left') as HTMLElement;
    const centerContainer = rowElement.querySelector('.ps-cells-center') as HTMLElement;
    const rightContainer = rowElement.querySelector('.ps-cells-right') as HTMLElement;

    // 그룹 레벨에 따른 들여쓰기
    const indentLevel = dataRow.groupPath.length;
    centerContainer.style.paddingLeft = indentLevel > 0 ? `${indentLevel * 20}px` : '';

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
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!row) return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    // 그룹 헤더 클릭 처리
    const rowType = row.dataset['rowType'];
    if (rowType === 'group-header') {
      const groupId = row.dataset['groupId'];
      if (groupId) {
        this.toggleGroup(groupId);
        if (this.onGroupToggle) {
          this.onGroupToggle(groupId, this.groupManager.isCollapsed(groupId));
        }
      }
      return;
    }

    // 데이터 행 처리
    const virtualRow = this.virtualRows[rowIndex];
    if (!virtualRow || virtualRow.type !== 'data') return;

    const rowData = virtualRow.data;
    const cell = target.closest('.ps-cell') as HTMLElement | null;

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
      this.onRowClick(virtualRow.dataIndex, rowData, event);
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

    // 그룹 헤더는 더블클릭 무시
    if (row.dataset['rowType'] === 'group-header') return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    const columnKey = cell.dataset['columnKey'];
    if (!columnKey) return;

    const virtualRow = this.virtualRows[rowIndex];
    if (!virtualRow || virtualRow.type !== 'data') return;

    if (this.onCellDblClick) {
      const value = virtualRow.data[columnKey];
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
