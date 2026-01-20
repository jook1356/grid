/**
 * PureSheet - 최상위 파사드 클래스
 *
 * GridCore와 UI Layer를 통합하는 메인 클래스입니다.
 * 사용자는 이 클래스 하나로 모든 그리드 기능에 접근할 수 있습니다.
 */

import { GridCore } from '../core/GridCore';
import type { ColumnDef, Row, SortState, FilterState } from '../types';
import type { GroupingConfig } from '../types/grouping.types';
import type { PureSheetOptions, CellPosition, ColumnState, SelectionState } from './types';
import { GridRenderer } from './GridRenderer';
import { SelectionManager } from './interaction/SelectionManager';
import { EditorManager } from './interaction/EditorManager';
import { ColumnManager } from './interaction/ColumnManager';

/**
 * PureSheet 이벤트 타입
 */
export type PureSheetEventType =
  | 'data:loaded'
  | 'row:click'
  | 'row:dblclick'
  | 'cell:click'
  | 'cell:dblclick'
  | 'cell:change'
  | 'selection:changed'
  | 'column:resize'
  | 'column:reorder'
  | 'column:pin'
  | 'sort:changed'
  | 'filter:changed'
  | 'scroll';

/**
 * 이벤트 구독 해제 함수
 */
export type Unsubscribe = () => void;

/**
 * PureSheet - 그리드 라이브러리 메인 클래스
 */
export class PureSheet {
  private readonly container: HTMLElement;
  private readonly options: PureSheetOptions;

  // 코어
  private gridCore: GridCore;

  // UI 모듈
  private gridRenderer: GridRenderer;
  private selectionManager: SelectionManager;
  private editorManager: EditorManager;
  private columnManager: ColumnManager;

  // 이벤트 핸들러
  private eventHandlers: Map<string, Set<Function>> = new Map();

  // GridCore 초기화 Promise
  private initPromise: Promise<void>;

  constructor(container: HTMLElement, options: PureSheetOptions) {
    this.container = container;
    this.options = {
      rowHeight: 36,
      headerHeight: 40,
      selectionMode: 'row',
      multiSelect: true,
      showCheckboxColumn: false,
      editable: false,
      resizableColumns: true,
      reorderableColumns: true,
      theme: 'light',
      ...options,
    };

    // GridCore 초기화
    this.gridCore = new GridCore({
      columns: this.options.columns,
    });

    // GridCore Worker 초기화 (Promise 저장하여 나중에 await 가능)
    this.initPromise = this.gridCore.initialize();

    // ColumnManager 초기화
    this.columnManager = new ColumnManager({
      columns: this.options.columns,
    });

    // GridRenderer 초기화
    this.gridRenderer = new GridRenderer(this.container, {
      gridCore: this.gridCore,
      options: this.options,
      onRowClick: this.handleRowClick.bind(this),
      onCellClick: this.handleCellClick.bind(this),
      onCellDblClick: this.handleCellDblClick.bind(this),
      onDragSelectionStart: this.handleDragSelectionStart.bind(this),
      onDragSelectionUpdate: this.handleDragSelectionUpdate.bind(this),
      onDragSelectionEnd: this.handleDragSelectionEnd.bind(this),
    });

    // SelectionManager 초기화
    this.selectionManager = new SelectionManager({
      gridCore: this.gridCore,
      selectionMode: this.options.selectionMode ?? 'row',
      multiSelect: this.options.multiSelect ?? true,
    });

    // EditorManager 초기화
    this.editorManager = new EditorManager({
      gridCore: this.gridCore,
      editable: this.options.editable ?? false,
    });

    // 이벤트 연결
    this.setupEventListeners();

    // 초기 데이터 로드
    if (this.options.data) {
      void this.loadData(this.options.data);
    }
  }

  // ===========================================================================
  // 데이터 API
  // ===========================================================================

  /**
   * 데이터 로드
   */
  async loadData(data: Row[]): Promise<void> {
    // GridCore 초기화 완료 대기
    await this.initPromise;

    await this.gridCore.loadData(data);
    this.gridRenderer.refresh();
    this.emitEvent('data:loaded', {
      rowCount: data.length,
      columnCount: this.options.columns.length,
    });
  }

  /**
   * 행 추가
   */
  async addRow(row: Row): Promise<void> {
    await this.gridCore.addRow(row);
    this.gridRenderer.refresh();
  }

  /**
   * 행 업데이트 (ID 기반)
   */
  async updateRow(id: string | number, updates: Partial<Row>): Promise<void> {
    const index = this.gridCore.getDataStore().getIndexById(id);
    if (index >= 0) {
      await this.gridCore.updateRow(index, updates);
      this.gridRenderer.refresh();
    }
  }

  /**
   * 행 삭제 (ID 기반)
   */
  async removeRow(id: string | number): Promise<void> {
    const index = this.gridCore.getDataStore().getIndexById(id);
    if (index >= 0) {
      await this.gridCore.removeRow(index);
      this.gridRenderer.refresh();
    }
  }

  /**
   * 모든 데이터 가져오기
   */
  getAllData(): Row[] {
    return this.gridCore.getAllData();
  }

  /**
   * 보이는 데이터 가져오기 (필터/정렬 적용 후)
   */
  getVisibleData(): Row[] {
    const result: Row[] = [];
    const count = this.gridCore.getVisibleRowCount();
    for (let i = 0; i < count; i++) {
      const row = this.gridCore.getRowByVisibleIndex(i);
      if (row) result.push(row);
    }
    return result;
  }

  // ===========================================================================
  // 뷰 API
  // ===========================================================================

  /**
   * 정렬 적용
   */
  async sort(sorts: SortState[]): Promise<void> {
    await this.gridCore.sort(sorts);
    this.gridRenderer.refresh();
    this.emitEvent('sort:changed', { sorts });
  }

  /**
   * 필터 적용
   */
  async filter(filters: FilterState[]): Promise<void> {
    await this.gridCore.filter(filters);
    this.gridRenderer.refresh();
    this.emitEvent('filter:changed', { filters });
  }

  /**
   * 새로고침
   */
  refresh(): void {
    this.gridRenderer.refresh();
  }

  // ===========================================================================
  // 그룹화 API
  // ===========================================================================

  /**
   * 그룹화 설정
   *
   * 헤더와 바디의 들여쓰기가 자동으로 동기화됩니다.
   *
   * @param config - 그룹화 설정 (null이면 그룹화 해제)
   */
  setGrouping(config: GroupingConfig | null): void {
    // GridRenderer를 통해 그룹화 설정 및 헤더 indent 동기화
    this.gridRenderer.setGroupingConfig(config);
  }

  /**
   * 그룹화 컬럼 설정 (간단한 API)
   *
   * @param columns - 그룹화할 컬럼 키 배열
   */
  groupBy(columns: string[]): void {
    if (columns.length === 0) {
      this.setGrouping(null);
    } else {
      this.setGrouping({ columns });
    }
  }

  /**
   * 그룹화 해제
   */
  clearGrouping(): void {
    this.setGrouping(null);
  }

  /**
   * 그룹 접기/펼치기 토글
   */
  toggleGroup(groupId: string): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.toggleGroup(groupId);
  }

  /**
   * 모든 그룹 펼치기
   */
  expandAllGroups(): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.expandAllGroups();
  }

  /**
   * 모든 그룹 접기
   */
  collapseAllGroups(): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.collapseAllGroups();
  }

  // ===========================================================================
  // 선택 API
  // ===========================================================================

  /**
   * 선택된 행 가져오기
   */
  getSelectedRows(): Row[] {
    return this.selectionManager.getSelectedRows();
  }

  /**
   * 선택된 행 ID 가져오기
   */
  getSelectedRowIds(): (string | number)[] {
    return Array.from(this.selectionManager.getSelectedRowIds());
  }

  /**
   * 행 선택
   */
  selectRows(ids: (string | number)[]): void {
    this.selectionManager.selectRows(ids);
    this.updateSelectionUI();
  }

  /**
   * 전체 선택
   */
  selectAll(): void {
    this.selectionManager.selectAll();
    this.updateSelectionUI();
  }

  /**
   * 선택 해제
   */
  clearSelection(): void {
    this.selectionManager.clearSelection();
    this.updateSelectionUI();
  }

  // ===========================================================================
  // 컬럼 API
  // ===========================================================================

  /**
   * 컬럼 왼쪽 고정
   */
  pinColumnLeft(key: string): void {
    this.columnManager.pin(key, 'left');
    this.gridRenderer.setColumnPinned(key, 'left');
    this.emitEvent('column:pin', { columnKey: key, position: 'left' });
  }

  /**
   * 컬럼 오른쪽 고정
   */
  pinColumnRight(key: string): void {
    this.columnManager.pin(key, 'right');
    this.gridRenderer.setColumnPinned(key, 'right');
    this.emitEvent('column:pin', { columnKey: key, position: 'right' });
  }

  /**
   * 컬럼 고정 해제
   */
  unpinColumn(key: string): void {
    this.columnManager.unpin(key);
    this.gridRenderer.setColumnPinned(key, 'none');
    this.emitEvent('column:pin', { columnKey: key, position: 'none' });
  }

  /**
   * 컬럼 너비 설정
   */
  setColumnWidth(key: string, width: number): void {
    this.columnManager.setWidth(key, width);
    this.gridRenderer.setColumnWidth(key, width);
    this.emitEvent('column:resize', { columnKey: key, width });
  }

  /**
   * 컬럼 순서 설정
   */
  setColumnOrder(order: string[]): void {
    this.columnManager.setOrder(order);
    this.gridRenderer.setColumnOrder(order);
    this.emitEvent('column:reorder', { order });
  }

  /**
   * 컬럼 숨기기
   */
  hideColumn(key: string): void {
    this.columnManager.hide(key);
    this.gridRenderer.setColumnVisible(key, false);
  }

  /**
   * 컬럼 표시
   */
  showColumn(key: string): void {
    this.columnManager.show(key);
    this.gridRenderer.setColumnVisible(key, true);
  }

  /**
   * 컬럼 상태 가져오기
   */
  getColumnState(): ColumnState[] {
    return this.columnManager.getState();
  }

  /**
   * 컬럼 상태 저장 (JSON)
   */
  saveColumnState(): string {
    return this.columnManager.serialize();
  }

  /**
   * 컬럼 상태 복원 (JSON)
   */
  loadColumnState(json: string): void {
    this.columnManager.deserialize(json);
    // GridRenderer에 반영
    for (const state of this.columnManager.getState()) {
      this.gridRenderer.setColumnWidth(state.key, state.width);
      this.gridRenderer.setColumnPinned(state.key, state.pinned);
      this.gridRenderer.setColumnVisible(state.key, state.visible);
    }
  }

  // ===========================================================================
  // 이벤트 API
  // ===========================================================================

  /**
   * 이벤트 구독
   */
  on(event: PureSheetEventType, handler: Function): Unsubscribe {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * 이벤트 구독 해제
   */
  off(event: PureSheetEventType, handler: Function): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  // ===========================================================================
  // 상태 API
  // ===========================================================================

  /**
   * 총 행 수
   */
  getTotalRowCount(): number {
    return this.gridCore.getTotalRowCount();
  }

  /**
   * 보이는 행 수 (필터 적용 후)
   */
  getVisibleRowCount(): number {
    return this.gridCore.getVisibleRowCount();
  }

  /**
   * 컬럼 정의 가져오기
   */
  getColumns(): ColumnDef[] {
    return this.gridCore.getColumns();
  }

  // ===========================================================================
  // 정리
  // ===========================================================================

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.gridRenderer.destroy();
    this.selectionManager.destroy();
    this.editorManager.destroy();
    this.columnManager.destroy();
    this.gridCore.destroy();
    this.eventHandlers.clear();
  }

  // ===========================================================================
  // 내부 이벤트 핸들러
  // ===========================================================================

  /**
   * 이벤트 리스너 설정
   */
  private setupEventListeners(): void {
    // SelectionManager 이벤트
    this.selectionManager.on('selectionChanged', (state: SelectionState) => {
      this.updateSelectionUI();
      this.emitEvent('selection:changed', {
        selectedRows: Array.from(state.selectedRows ?? []),
        selectedCells: Array.from(state.selectedCells ?? []),
      });
    });

    // EditorManager 이벤트
    this.editorManager.on('editCommit', (payload) => {
      this.emitEvent('cell:change', {
        rowIndex: payload.position.rowIndex,
        columnKey: payload.position.columnKey,
        oldValue: payload.oldValue,
        newValue: payload.newValue,
      });
      this.gridRenderer.refresh();
    });

    // ColumnManager 이벤트
    this.columnManager.on('widthChanged', (payload) => {
      this.gridRenderer.setColumnWidth(payload.columnKey, payload.width);
    });

    // 키보드 이벤트
    this.container.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  /**
   * 행 클릭 핸들러
   */
  private handleRowClick(rowIndex: number, row: Row, event: MouseEvent): void {
    // row 선택 모드에서만 행 선택 처리
    // range/cell 모드에서는 handleCellClick에서 처리
    if (this.options.selectionMode === 'row') {
      const rowId = row['id'] as string | number | undefined;
      if (rowId !== undefined) {
        this.selectionManager.handleRowClick(rowIndex, rowId, event);
      }
    }
    this.emitEvent('row:click', { row, rowIndex, event });
  }

  /**
   * 셀 클릭 핸들러
   */
  private handleCellClick(position: CellPosition, value: unknown, event: MouseEvent): void {
    this.selectionManager.handleCellClick(position, event);

    const row = this.gridCore.getRowByVisibleIndex(position.rowIndex);
    this.emitEvent('cell:click', {
      row,
      columnKey: position.columnKey,
      value,
      event,
    });
  }

  /**
   * 셀 더블클릭 핸들러
   */
  private handleCellDblClick(position: CellPosition, value: unknown, event: MouseEvent): void {
    const row = this.gridCore.getRowByVisibleIndex(position.rowIndex);
    this.emitEvent('cell:dblclick', {
      row,
      columnKey: position.columnKey,
      value,
      event,
    });

    // 편집 시작
    if (this.options.editable) {
      const cell = (event.target as HTMLElement).closest('.ps-cell') as HTMLElement;
      if (cell) {
        this.editorManager.startEdit(position, cell);
      }
    }
  }

  /**
   * 키보드 이벤트 핸들러
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // 에디터가 처리
    if (this.editorManager.handleKeyDown(event)) {
      return;
    }

    // 선택 매니저가 처리
    if (this.selectionManager.handleKeyDown(event)) {
      return;
    }
  }

  /**
   * 선택 UI 업데이트
   */
  private updateSelectionUI(): void {
    // row 모드에서만 명시적 행 선택 업데이트
    if (this.options.selectionMode === 'row') {
      this.gridRenderer.updateSelection(this.selectionManager.getSelectedRowIds());
    }
    // 셀 선택 업데이트 (행 하이라이트도 여기서 처리)
    this.updateCellSelectionUI();
  }

  /**
   * 셀 선택 UI 업데이트
   */
  private updateCellSelectionUI(): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    if (bodyRenderer) {
      bodyRenderer.updateCellSelection(this.selectionManager.getSelectedCells());
    }
  }

  // ===========================================================================
  // 드래그 선택 핸들러
  // ===========================================================================

  /**
   * 드래그 선택 시작 핸들러
   */
  private handleDragSelectionStart(position: CellPosition, event: MouseEvent): void {
    // range 모드에서만 드래그 선택 활성화
    if (this.options.selectionMode !== 'range') return;

    this.selectionManager.startDragSelection(position, event);
  }

  /**
   * 드래그 선택 업데이트 핸들러
   */
  private handleDragSelectionUpdate(position: CellPosition): void {
    if (!this.selectionManager.isDragging()) return;

    this.selectionManager.updateDragSelection(position);
  }

  /**
   * 드래그 선택 완료 핸들러
   */
  private handleDragSelectionEnd(): void {
    this.selectionManager.commitDragSelection();
  }

  /**
   * 이벤트 발생
   */
  private emitEvent(event: PureSheetEventType, payload: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      }
    }
  }
}
