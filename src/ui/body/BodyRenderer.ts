/**
 * BodyRenderer - 바디 영역 렌더링
 *
 * VirtualScroller와 연동하여 보이는 행만 렌더링합니다.
 * RowPool을 사용하여 DOM 요소를 재사용합니다.
 * GroupManager를 통해 그룹화된 데이터를 렌더링합니다.
 * MultiRowRenderer를 통해 Multi-Row 레이아웃을 지원합니다.
 * Row 클래스를 사용하여 행을 렌더링합니다.
 * 드래그 선택을 지원합니다.
 */

import type { GridCore } from '../../core/GridCore';
import type { Row as RowData, ColumnDef } from '../../types';
import type { VirtualRow, GroupHeaderRow, DataRow, GroupingConfig, RowTemplate } from '../../types/grouping.types';
import type { ColumnState, ColumnGroups, CellPosition } from '../types';
import type { RowRenderContext } from '../row/types';
import { VirtualScroller } from '../VirtualScroller';
import { RowPool } from './RowPool';
import { GroupManager } from '../grouping/GroupManager';
import { MultiRowRenderer } from '../multirow/MultiRowRenderer';
import { Row } from '../row/Row';

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
  /** 선택 모드 */
  selectionMode?: 'none' | 'row' | 'range' | 'all';
  /** 그룹화 설정 (선택) */
  groupingConfig?: GroupingConfig;
  /** Multi-Row 템플릿 (선택) */
  rowTemplate?: RowTemplate;
  /** 행 클릭 콜백 */
  onRowClick?: (rowIndex: number, row: RowData, event: MouseEvent) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 그룹 토글 콜백 */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
  /** 드래그 선택 시작 콜백 */
  onDragSelectionStart?: (position: CellPosition, event: MouseEvent) => void;
  /** 드래그 선택 업데이트 콜백 */
  onDragSelectionUpdate?: (position: CellPosition) => void;
  /** 드래그 선택 완료 콜백 */
  onDragSelectionEnd?: () => void;
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
  private selectedRowIndices: Set<number> = new Set();  // 셀 선택에서 파생된 행 인덱스

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

  // 선택 모드
  private selectionMode: 'none' | 'row' | 'range' | 'all' = 'row';

  // 콜백
  private onRowClick?: BodyRendererOptions['onRowClick'];
  private onCellClick?: BodyRendererOptions['onCellClick'];
  private onCellDblClick?: BodyRendererOptions['onCellDblClick'];
  private onGroupToggle?: BodyRendererOptions['onGroupToggle'];
  private onDragSelectionStart?: BodyRendererOptions['onDragSelectionStart'];
  private onDragSelectionUpdate?: BodyRendererOptions['onDragSelectionUpdate'];
  private onDragSelectionEnd?: BodyRendererOptions['onDragSelectionEnd'];

  // 드래그 선택 상태
  private isDragging = false;
  private isActualDrag = false;  // 실제로 드래그했는지 (셀이 바뀌었는지)
  private justFinishedDrag = false;  // 방금 드래그 완료 (클릭 무시용)
  private dragStartPosition: CellPosition | null = null;
  private lastDragColumnKey: string | null = null;  // 드래그 중 마지막 컬럼 키
  private dragStartEvent: MouseEvent | null = null;  // 드래그 시작 이벤트 저장

  // 선택된 셀 Set (O(1) 조회용)
  private selectedCells: Set<string> = new Set();

  // 자동 스크롤 관련
  private autoScrollAnimationId: number | null = null;
  private autoScrollSpeed = 0;

  // 이벤트 핸들러 바인딩 (제거용)
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;

  constructor(container: HTMLElement, options: BodyRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.rowHeight = options.rowHeight;
    this.columns = options.columns;
    this.selectionMode = options.selectionMode ?? 'row';
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;
    this.onGroupToggle = options.onGroupToggle;
    this.onDragSelectionStart = options.onDragSelectionStart;
    this.onDragSelectionUpdate = options.onDragSelectionUpdate;
    this.onDragSelectionEnd = options.onDragSelectionEnd;

    // 이벤트 핸들러 바인딩
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);

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
      // VirtualScroller에 렌더링용 높이 설정 (visibleRowCount 계산용)
      this.virtualScroller.setRenderRowHeight(this.multiRowRenderer.getTotalRowHeight());
    }

    // VirtualScroller 연결 (rowContainer도 전달하여 네이티브 스크롤 지원)
    this.virtualScroller.attach(this.scrollProxy, this.viewport, this.spacer, this.rowContainer);

    // 이벤트 바인딩
    this.virtualScroller.on('rangeChanged', this.onRangeChanged.bind(this));
    this.viewport.addEventListener('click', this.handleClick.bind(this));
    this.viewport.addEventListener('dblclick', this.handleDblClick.bind(this));
    this.viewport.addEventListener('mousedown', this.handleMouseDown.bind(this));

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
   *
   * 그룹화 depth에 따라 헤더 indent CSS 변수도 자동으로 업데이트됩니다.
   */
  setGroupingConfig(config: GroupingConfig | null): void {
    if (config) {
      this.groupManager.setConfig(config);
    } else {
      this.groupManager.setGroupColumns([]);
    }

    // 헤더 indent CSS 변수 자동 업데이트
    this.updateGroupIndentCSS(config?.columns?.length ?? 0);

    this.refresh();
  }

  /**
   * 그룹 indent CSS 변수 업데이트
   *
   * 상위 .ps-grid-container에 --ps-group-indent 변수를 설정합니다.
   */
  private updateGroupIndentCSS(depth: number): void {
    const gridContainer = this.container.closest('.ps-grid-container') as HTMLElement | null;
    if (gridContainer) {
      const indentPx = depth * 20; // 20px per level
      gridContainer.style.setProperty('--ps-group-indent', `${indentPx}px`);
    }
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
      // VirtualScroller에 렌더링용 높이 설정
      this.virtualScroller.setRenderRowHeight(this.multiRowRenderer.getTotalRowHeight());
    } else {
      this.multiRowRenderer = null;
      // 단일 행 높이로 복원
      this.virtualScroller.setRenderRowHeight(this.rowHeight);
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
   * 렌더링용 행 높이 설정
   *
   * 가변 높이 row를 지원할 때 사용합니다.
   * VirtualScroller의 visibleRowCount 계산에 사용됩니다.
   *
   * 참고: 인덱스 기반 스크롤을 사용하므로 spacer 높이는 변경되지 않습니다.
   */
  setRenderRowHeight(height: number): void {
    this.virtualScroller.setRenderRowHeight(height);
  }

  /**
   * 선택 상태 업데이트 (명시적 행 선택 - ID 기준)
   * 주의: 이 메서드 단독으로는 UI를 업데이트하지 않습니다.
   * updateCellSelection과 함께 호출되어야 합니다.
   */
  updateSelection(selectedRows: Set<string | number>): void {
    this.selectedRows = selectedRows;
    // 행 스타일은 updateCellSelection에서 통합 처리
  }

  /**
   * 셀 선택 상태 업데이트
   * 'all' 모드에서는 선택된 셀이 있는 행도 함께 하이라이트됩니다.
   * 'range' 모드에서는 셀만 하이라이트되고 행은 건드리지 않습니다.
   */
  updateCellSelection(selectedCells: Set<string>): void {
    this.selectedCells = selectedCells;
    
    // 'range' 모드가 아닐 때만 행 하이라이트 (all 모드에서만 행도 선택)
    if (this.selectionMode !== 'range') {
      // 선택된 셀에서 행 인덱스 추출
      this.selectedRowIndices.clear();
      for (const cellKey of selectedCells) {
        const rowIndex = parseInt(cellKey.split(':')[0], 10);
        if (!isNaN(rowIndex)) {
          this.selectedRowIndices.add(rowIndex);
        }
      }
      this.updateCombinedRowSelectionStyles();
    } else {
      // range 모드: 행 선택 초기화 (셀만 선택)
      this.selectedRowIndices.clear();
      this.updateCombinedRowSelectionStyles();
    }
    
    this.updateCellSelectionStyles();
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
   * VirtualScroller 인스턴스 반환 (자동 스크롤용)
   */
  getVirtualScroller(): VirtualScroller {
    return this.virtualScroller;
  }

  /**
   * 컬럼 상태 반환
   */
  getColumnStates(): ColumnState[] {
    return this.columns;
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    // 드래그 이벤트 정리
    this.cleanupDragEvents();
    this.stopAutoScroll();

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

    const columnGroups = this.getColumnGroups();
    const totalRowCount = this.virtualRows.length;

    // Multi-Row 모드
    if (this.multiRowRenderer) {
      this.renderMultiRowMode(state, totalRowCount);
      return;
    }

    // 렌더링 컨텍스트 생성
    const baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'> = {
      columns: this.columns,
      columnGroups,
      columnDefs: this.columnDefs,
      rowHeight: this.rowHeight,
      gridCore: this.gridCore,
    };

    // 일반 모드
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    for (const [rowIndex, rowElement] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow) continue;

      // VirtualRow 타입에 따라 Row 인스턴스 생성 및 렌더링
      if (virtualRow.type === 'group-header') {
        this.renderGroupHeaderRow(rowElement, rowIndex, virtualRow, baseContext);
      } else {
        this.renderDataRowWithRowClass(rowElement, rowIndex, virtualRow, baseContext);
      }
    }
  }

  /**
   * Multi-Row 모드 렌더링
   *
   * RowPool을 사용하여 컨테이너를 재활용합니다.
   * 스크롤 시 DOM 생성을 최소화하여 성능을 개선합니다.
   * Row 클래스 인스턴스를 생성하여 MultiRowRenderer에 전달합니다.
   */
  private renderMultiRowMode(
    state: { startIndex: number; endIndex: number },
    totalRowCount: number
  ): void {
    if (!this.multiRowRenderer) return;

    // RowPool을 사용하여 보이는 범위의 행 컨테이너 획득/반환
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    for (const [rowIndex, container] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow || virtualRow.type !== 'data') continue;

      // 청크 내 상대 위치 (청크 기반 네이티브 스크롤용)
      const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);

      // Row 인스턴스 생성 (Row는 데이터만 보유, MultiRowRenderer가 스타일링)
      const row = new Row({
        structural: false,
        variant: 'data',
        data: virtualRow.data as Record<string, unknown>,
      });

      // MultiRowRenderer를 통해 렌더링
      this.multiRowRenderer.renderRow(
        row,
        container,
        virtualRow.dataIndex,
        offsetY
      );
    }
  }

  /**
   * 그룹 헤더 행 렌더링 (Row 클래스 사용)
   */
  private renderGroupHeaderRow(
    rowElement: HTMLElement,
    rowIndex: number,
    groupRow: GroupHeaderRow,
    baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'>
  ): void {
    // 청크 내 상대 위치 설정 (청크 기반 네이티브 스크롤용)
    const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 데이터 속성 설정 (BodyRenderer 책임)
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['groupId'] = groupRow.groupId;
    rowElement.dataset['rowType'] = 'group-header';
    rowElement.classList.remove('ps-selected');

    // Row 인스턴스 생성
    const row = new Row({
      structural: true,
      variant: 'group-header',
      group: {
        id: groupRow.groupId,
        level: groupRow.level,
        path: groupRow.path.map(p => String(p.value)),
        value: groupRow.value,
        column: groupRow.column,
        collapsed: groupRow.collapsed,
        itemCount: groupRow.itemCount,
        aggregates: groupRow.aggregates,
      },
    });

    // 렌더링 컨텍스트 완성
    const context: RowRenderContext = {
      ...baseContext,
      rowIndex,
    };

    // Row 클래스로 렌더링 위임
    row.render(rowElement, context);
  }


  /**
   * 데이터 행 렌더링 (Row 클래스 사용)
   */
  private renderDataRowWithRowClass(
    rowElement: HTMLElement,
    rowIndex: number,
    dataRow: DataRow,
    baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'>
  ): void {
    const rowData = dataRow.data;

    // 청크 내 상대 위치 설정 (청크 기반 네이티브 스크롤용)
    const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 데이터 속성 (BodyRenderer 책임)
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['dataIndex'] = String(dataRow.dataIndex);
    rowElement.dataset['rowType'] = 'data';
    const rowId = rowData['id'];
    if (rowId !== undefined) {
      rowElement.dataset['rowId'] = String(rowId);
    }
    delete rowElement.dataset['groupId'];

    // 선택 상태 (BodyRenderer 책임)
    const isSelectedByCell = this.selectedRowIndices.has(rowIndex);
    const isSelectedByRow = rowId !== undefined && this.selectedRows.has(rowId);
    rowElement.classList.toggle('ps-selected', isSelectedByCell || isSelectedByRow);

    // 그룹 레벨에 따른 들여쓰기 (CSS 변수로 설정)
    const indentLevel = dataRow.groupPath.length;
    rowElement.style.setProperty('--ps-group-indent', `${indentLevel * 20}px`);

    // Row 인스턴스 생성
    const row = new Row({
      structural: false,
      variant: 'data',
      data: rowData as Record<string, unknown>,
    });

    // 렌더링 컨텍스트 완성
    const context: RowRenderContext = {
      ...baseContext,
      rowIndex,
      dataIndex: dataRow.dataIndex,
    };

    // Row 클래스로 렌더링 위임
    row.render(rowElement, context);

    // 셀 선택 상태 적용 (Row 렌더링 후)
    this.applyCellSelectionToRow(rowElement, rowIndex);
  }

  /**
   * 셀 선택 상태 적용 (Row 렌더링 후 호출)
   */
  private applyCellSelectionToRow(rowElement: HTMLElement, rowIndex: number): void {
    const cells = rowElement.querySelectorAll('.ps-cell');
    cells.forEach((cell) => {
      const el = cell as HTMLElement;
      const columnKey = el.dataset['columnKey'];
      if (columnKey) {
        const cellKey = `${rowIndex}:${columnKey}`;
        const isSelected = this.selectedCells.has(cellKey);
        el.classList.toggle('ps-cell-selected', isSelected);
      }
    });
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
    // 드래그 직후 클릭은 무시 (드래그에서 이미 처리됨)
    if (this.justFinishedDrag) {
      this.justFinishedDrag = false;
      return;
    }

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
   * 통합 행 선택 스타일 업데이트
   * - selectedRows: 명시적 행 선택 (행 ID 기준)
   * - selectedRowIndices: 셀 선택에서 파생된 행 (행 인덱스 기준)
   */
  private updateCombinedRowSelectionStyles(): void {
    for (const [rowIndex, rowElement] of this.rowPool.getActiveRows()) {
      // 1. 셀 선택에서 파생된 행 인덱스 체크
      let isSelected = this.selectedRowIndices.has(rowIndex);
      
      // 2. 명시적 행 선택 (ID 기준) 체크
      if (!isSelected && this.selectedRows.size > 0) {
        const rowData = this.gridCore.getRowByVisibleIndex(rowIndex);
        if (rowData) {
          const rowId = rowData['id'];
          isSelected = rowId !== undefined && this.selectedRows.has(rowId);
        }
      }
      
      rowElement.classList.toggle('ps-selected', isSelected);
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

  // ===========================================================================
  // 드래그 선택 (Drag Selection)
  // ===========================================================================

  /**
   * 마우스 다운 이벤트 처리 (드래그 준비)
   */
  private handleMouseDown(event: MouseEvent): void {
    // 왼쪽 버튼만 처리
    if (event.button !== 0) return;

    // 셀에서 시작했는지 확인
    const cellPosition = this.getCellPositionFromEvent(event);
    if (!cellPosition) return;

    // 그룹 헤더에서는 드래그 선택 안함
    const target = event.target as HTMLElement;
    const row = target.closest('.ps-row') as HTMLElement | null;
    if (row?.dataset['rowType'] === 'group-header') return;

    // 드래그 준비 (아직 실제 드래그 시작 아님)
    this.isDragging = true;
    this.isActualDrag = false;  // 셀이 바뀌기 전까지는 클릭으로 간주
    this.dragStartPosition = cellPosition;
    this.lastDragColumnKey = cellPosition.columnKey;
    this.dragStartEvent = event;  // 이벤트 저장 (나중에 드래그 시작 시 사용)

    // 전역 이벤트 리스너 등록 (viewport 밖에서도 드래그 추적)
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);

    // 텍스트 선택 방지
    event.preventDefault();
  }

  /**
   * 마우스 이동 이벤트 처리 (드래그 중)
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStartPosition) return;

    // 현재 마우스 위치에서 셀 위치 계산
    const cellPosition = this.getCellPositionFromMousePosition(event);
    if (!cellPosition) return;

    // 셀이 바뀌었는지 확인 (실제 드래그 시작)
    const cellChanged = cellPosition.rowIndex !== this.dragStartPosition.rowIndex ||
                        cellPosition.columnKey !== this.dragStartPosition.columnKey;

    if (!this.isActualDrag && cellChanged) {
      // 처음으로 다른 셀로 이동 → 실제 드래그 시작
      this.isActualDrag = true;
      
      // 드래그 시작 콜백 호출 (저장해둔 이벤트로)
      if (this.onDragSelectionStart && this.dragStartEvent) {
        this.onDragSelectionStart(this.dragStartPosition, this.dragStartEvent);
      }
    }

    // 실제 드래그 중일 때만 업데이트
    if (this.isActualDrag) {
      // 마지막 컬럼 키 저장 (자동 스크롤 시 사용)
      this.lastDragColumnKey = cellPosition.columnKey;

      // 콜백 호출
      if (this.onDragSelectionUpdate) {
        this.onDragSelectionUpdate(cellPosition);
      }

      // 자동 스크롤 체크
      this.checkAutoScroll(event);
    }
  }

  /**
   * 마우스 업 이벤트 처리 (드래그 종료)
   */
  private handleMouseUp(_event: MouseEvent): void {
    if (!this.isDragging) return;

    const wasDragging = this.isActualDrag;

    this.isDragging = false;
    this.isActualDrag = false;
    this.dragStartPosition = null;
    this.lastDragColumnKey = null;
    this.dragStartEvent = null;

    // 자동 스크롤 중지
    this.stopAutoScroll();

    // 실제 드래그했을 때만 드래그 종료 콜백 호출
    // (클릭만 한 경우는 click 이벤트에서 처리)
    if (wasDragging) {
      this.justFinishedDrag = true;  // 클릭 이벤트 무시용 플래그
      if (this.onDragSelectionEnd) {
        this.onDragSelectionEnd();
      }
    }

    // 전역 이벤트 리스너 제거
    this.cleanupDragEvents();
  }

  /**
   * 드래그 이벤트 정리
   */
  private cleanupDragEvents(): void {
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  /**
   * 이벤트에서 셀 위치 추출
   */
  private getCellPositionFromEvent(event: MouseEvent): CellPosition | null {
    const target = event.target as HTMLElement;
    const cell = target.closest('.ps-cell') as HTMLElement | null;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!cell || !row) return null;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    const columnKey = cell.dataset['columnKey'];

    if (rowIndex < 0 || !columnKey) return null;

    return { rowIndex, columnKey };
  }

  /**
   * 마우스 좌표에서 셀 위치 계산 (viewport 밖에서도 동작)
   */
  private getCellPositionFromMousePosition(event: MouseEvent): CellPosition | null {
    const viewportRect = this.viewport.getBoundingClientRect();
    const effectiveRowHeight = this.getEffectiveRowHeight();

    // 마우스 Y 좌표 → 행 인덱스
    // viewport 내부의 Y 좌표 (음수면 위, viewportHeight 초과면 아래)
    const viewportY = event.clientY - viewportRect.top;
    
    // 현재 보이는 첫 번째 행 인덱스 기준으로 계산
    const visibleStartIndex = this.virtualScroller.getVisibleStartIndex();
    let rowIndex = visibleStartIndex + Math.floor(viewportY / effectiveRowHeight);

    // 범위 제한
    rowIndex = Math.max(0, Math.min(rowIndex, this.virtualRows.length - 1));

    // 마우스 X 좌표 → 컬럼 키
    const relativeX = event.clientX - viewportRect.left + this.viewport.scrollLeft;
    const columnKey = this.getColumnKeyFromX(relativeX);

    if (!columnKey) return null;

    return { rowIndex, columnKey };
  }

  /**
   * X 좌표에서 컬럼 키 찾기
   */
  private getColumnKeyFromX(x: number): string | null {
    const columnGroups = this.getColumnGroups();
    const allColumns = [...columnGroups.left, ...columnGroups.center, ...columnGroups.right];

    let accumulatedWidth = 0;
    for (const col of allColumns) {
      accumulatedWidth += col.width;
      if (x < accumulatedWidth) {
        return col.key;
      }
    }

    // X가 모든 컬럼을 넘어가면 마지막 컬럼 반환
    return allColumns[allColumns.length - 1]?.key ?? null;
  }

  /**
   * 셀 선택 스타일 업데이트
   */
  private updateCellSelectionStyles(): void {
    for (const [rowIndex, rowElement] of this.rowPool.getActiveRows()) {
      const cells = rowElement.querySelectorAll('.ps-cell');
      cells.forEach((cell) => {
        const el = cell as HTMLElement;
        const columnKey = el.dataset['columnKey'];
        if (columnKey) {
          const cellKey = `${rowIndex}:${columnKey}`;
          const isSelected = this.selectedCells.has(cellKey);
          el.classList.toggle('ps-cell-selected', isSelected);
        }
      });
    }
  }

  // ===========================================================================
  // 자동 스크롤 (드래그 중 viewport 경계 도달 시)
  // ===========================================================================

  /**
   * 자동 스크롤 필요 여부 체크
   */
  private checkAutoScroll(event: MouseEvent): void {
    const viewportRect = this.viewport.getBoundingClientRect();
    const edgeThreshold = 50; // 경계에서 50px 이내면 자동 스크롤

    const distanceFromTop = event.clientY - viewportRect.top;
    const distanceFromBottom = viewportRect.bottom - event.clientY;

    if (distanceFromTop < edgeThreshold && distanceFromTop > 0) {
      // 위쪽으로 스크롤
      this.autoScrollSpeed = -Math.ceil((edgeThreshold - distanceFromTop) / 10);
      this.startAutoScroll();
    } else if (distanceFromBottom < edgeThreshold && distanceFromBottom > 0) {
      // 아래쪽으로 스크롤
      this.autoScrollSpeed = Math.ceil((edgeThreshold - distanceFromBottom) / 10);
      this.startAutoScroll();
    } else {
      // 스크롤 중지
      this.stopAutoScroll();
    }
  }

  /**
   * 자동 스크롤 시작
   */
  private startAutoScroll(): void {
    if (this.autoScrollAnimationId !== null) return;

    const scroll = () => {
      if (!this.isDragging || this.autoScrollSpeed === 0) {
        this.stopAutoScroll();
        return;
      }

      // 현재 보이는 시작 인덱스 가져오기
      const currentStartIndex = this.virtualScroller.getVisibleStartIndex();
      const newStartIndex = currentStartIndex + this.autoScrollSpeed;

      // 스크롤
      this.virtualScroller.scrollToRow(newStartIndex);

      // 드래그 선택 업데이트 (현재 마우스 위치 기준)
      if (this.onDragSelectionUpdate && this.dragStartPosition && this.lastDragColumnKey) {
        const visibleStart = this.virtualScroller.getVisibleStartIndex();
        const visibleCount = this.virtualScroller.getVisibleRowCount();
        const targetRow = this.autoScrollSpeed > 0
          ? Math.min(visibleStart + visibleCount - 1, this.virtualRows.length - 1)
          : Math.max(visibleStart, 0);

        // 마지막으로 드래그한 컬럼 키 유지
        this.onDragSelectionUpdate({
          rowIndex: targetRow,
          columnKey: this.lastDragColumnKey,
        });
      }

      this.autoScrollAnimationId = requestAnimationFrame(scroll);
    };

    this.autoScrollAnimationId = requestAnimationFrame(scroll);
  }

  /**
   * 자동 스크롤 중지
   */
  private stopAutoScroll(): void {
    if (this.autoScrollAnimationId !== null) {
      cancelAnimationFrame(this.autoScrollAnimationId);
      this.autoScrollAnimationId = null;
    }
    this.autoScrollSpeed = 0;
  }
}
