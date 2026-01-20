/**
 * PureSheet - 최상위 파사드 클래스
 *
 * GridCore와 UI Layer를 통합하는 메인 클래스입니다.
 * 사용자는 이 클래스 하나로 모든 그리드 기능에 접근할 수 있습니다.
 */

import { GridCore } from '../core/GridCore';
import type { ColumnDef, Row as RowData, SortState, FilterState } from '../types';
import type { GroupingConfig } from '../types/grouping.types';
import type { PivotConfig, PivotResult } from '../core/ViewConfig';
import type { PureSheetOptions, CellPosition, ColumnState, SelectionState } from './types';
import { GridRenderer } from './GridRenderer';
import { SelectionManager } from './interaction/SelectionManager';
import { EditorManager } from './interaction/EditorManager';
import { ColumnManager } from './interaction/ColumnManager';
import { Row } from './row/Row';
import type { RowConfig, AggregateConfig } from './row/types';

/**
 * PureSheet 이벤트 타입
 */
export type PureSheetEventType =
  | 'data:loaded'
  | 'row:click'
  | 'row:dblclick'
  | 'row:pinned'
  | 'row:unpinned'
  | 'cell:click'
  | 'cell:dblclick'
  | 'cell:change'
  | 'selection:changed'
  | 'column:resize'
  | 'column:reorder'
  | 'column:pin'
  | 'sort:changed'
  | 'filter:changed'
  | 'pivot:changed'
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
      onColumnReorder: this.handleColumnReorder.bind(this),
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

    // 초기 데이터 로드 및 피봇 설정
    if (this.options.data) {
      void this.loadData(this.options.data).then(() => {
        // 피봇 설정이 있으면 적용
        if (this.options.pivotConfig) {
          void this.setPivotConfig(this.options.pivotConfig);
        }
      });
    }
  }

  // ===========================================================================
  // 데이터 API
  // ===========================================================================

  /**
   * 데이터 로드
   */
  async loadData(data: RowData[]): Promise<void> {
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
  async addRow(row: RowData): Promise<void> {
    await this.gridCore.addRow(row);
    this.gridRenderer.refresh();
  }

  /**
   * 행 업데이트 (ID 기반)
   */
  async updateRow(id: string | number, updates: Partial<RowData>): Promise<void> {
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
  getAllData(): RowData[] {
    return this.gridCore.getAllData();
  }

  /**
   * 보이는 데이터 가져오기 (필터/정렬 적용 후)
   */
  getVisibleData(): RowData[] {
    const result: RowData[] = [];
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

  // ===========================================================================
  // 피봇 API
  // ===========================================================================

  /**
   * 피봇 모드 설정
   *
   * 데이터를 피봇하여 행↔열 변환을 수행합니다.
   * rowFields는 자동으로 좌측 고정 컬럼이 됩니다.
   *
   * @param config - 피봇 설정
   * @returns 피봇 결과 (새로운 rows, columns)
   *
   * @example
   * const result = await sheet.setPivotConfig({
   *   rowFields: ['department'],
   *   columnFields: ['year', 'quarter'],
   *   valueFields: [{ field: 'sales', aggregate: 'sum' }]
   * });
   */
  async setPivotConfig(config: PivotConfig): Promise<PivotResult> {
    // GridCore 초기화 완료 대기
    await this.initPromise;

    // 피봇 실행
    const result = await this.gridCore.setPivotConfig(config);

    // 피봇된 컬럼으로 GridRenderer 업데이트
    this.gridRenderer.updateColumns(
      result.columns.map((col, index) => ({
        key: col.key,
        width: col.width ?? 100,
        pinned: config.rowFields.includes(col.key) ? 'left' as const : 'none' as const,
        visible: true,
        order: index,
      }))
    );

    // 피봇된 데이터로 그리드 새로고침
    await this.gridCore.loadData(result.rows, result.columns);
    this.gridRenderer.refresh();

    return result;
  }

  /**
   * 피봇 모드 해제 (일반 모드로 복귀)
   *
   * @example
   * sheet.clearPivot();
   */
  clearPivot(): void {
    this.gridCore.clearPivot();
    this.gridRenderer.refresh();
  }

  /**
   * 피봇 모드 여부 확인
   */
  isPivotMode(): boolean {
    return this.gridCore.isPivotMode();
  }

  /**
   * 현재 피봇 설정 가져오기
   */
  getPivotConfig(): PivotConfig | null {
    return this.gridCore.getPivotConfig();
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
  // 고정 행 API (Pinned Rows)
  // ===========================================================================

  /**
   * 상단에 행 고정
   *
   * @param row - Row 인스턴스 또는 RowConfig
   * @returns 추가된 Row 인스턴스
   */
  pinRowTop(row: Row | RowConfig): Row {
    const rowInstance = row instanceof Row ? row : new Row(row);
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.pinRowTop(rowInstance);
    this.emitEvent('row:pinned', { row: rowInstance, position: 'top' });
    return rowInstance;
  }

  /**
   * 하단에 행 고정
   *
   * @param row - Row 인스턴스 또는 RowConfig
   * @returns 추가된 Row 인스턴스
   */
  pinRowBottom(row: Row | RowConfig): Row {
    const rowInstance = row instanceof Row ? row : new Row(row);
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.pinRowBottom(rowInstance);
    this.emitEvent('row:pinned', { row: rowInstance, position: 'bottom' });
    return rowInstance;
  }

  /**
   * 행 고정 해제
   *
   * @param rowId - 해제할 Row의 ID
   * @returns 해제 성공 여부
   */
  unpinRow(rowId: string): boolean {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    const result = bodyRenderer?.unpinRow(rowId) ?? false;
    if (result) {
      this.emitEvent('row:unpinned', { rowId });
    }
    return result;
  }

  /**
   * 모든 고정 행 가져오기
   */
  getPinnedRows(): { top: Row[]; bottom: Row[] } {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    return bodyRenderer?.getPinnedRows() ?? { top: [], bottom: [] };
  }

  /**
   * 모든 고정 행 제거
   */
  clearPinnedRows(): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.clearPinnedRows();
    this.emitEvent('row:unpinned', { rowId: '*', position: 'all' });
  }

  /**
   * 고정 행 새로고침
   */
  refreshPinnedRows(): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.refreshPinnedRows();
  }

  /**
   * 총합계 행 추가 (편의 메서드)
   *
   * @param aggregates - 집계 설정 배열
   * @returns 추가된 Row 인스턴스
   */
  addGrandTotalRow(aggregates: AggregateConfig[]): Row {
    const row = new Row({
      structural: true,
      variant: 'grandtotal',
      aggregates,
      pinned: 'bottom',
    });
    return this.pinRowBottom(row);
  }

  /**
   * 필터 행 추가 (편의 메서드)
   *
   * 헤더 바로 아래에 필터 입력 행을 추가합니다.
   *
   * @returns 추가된 Row 인스턴스
   */
  addFilterRow(): Row {
    const row = new Row({
      structural: true,
      variant: 'filter',
      pinned: 'top',
    });
    return this.pinRowTop(row);
  }

  // ===========================================================================
  // 선택 API
  // ===========================================================================

  /**
   * 선택된 행 가져오기
   */
  getSelectedRows(): RowData[] {
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
    this.selectionManager.on('selectionChanged', (event) => {
      const state = event.payload;  // event = { type, payload, timestamp }
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
  private handleRowClick(rowIndex: number, row: RowData, event: MouseEvent): void {
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
   * - row 모드: 행만 업데이트
   * - range 모드: 셀만 업데이트
   * - all 모드: 셀 + 행 (셀에서 파생)
   */
  private updateSelectionUI(): void {
    const mode = this.options.selectionMode;
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    
    if (mode === 'row') {
      // row 모드: 행만 업데이트
      this.gridRenderer.updateSelection(this.selectionManager.getSelectedRowIds());
      // 셀 선택은 비움
      if (bodyRenderer) {
        bodyRenderer.updateCellSelection(new Set());
      }
    } else if (mode === 'range' || mode === 'all') {
      // range/all 모드: 셀 업데이트 (all에서는 행도 자동 처리됨)
      if (bodyRenderer) {
        bodyRenderer.updateCellSelection(this.selectionManager.getSelectedCells());
      }
    }
  }

  // ===========================================================================
  // 드래그 선택 핸들러
  // ===========================================================================

  /**
   * 드래그 선택 시작 핸들러
   */
  private handleDragSelectionStart(position: CellPosition, event: MouseEvent): void {
    // 'none' 모드 외에는 드래그 선택 활성화
    if (this.options.selectionMode === 'none') return;

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
   * 컬럼 순서 변경 핸들러
   */
  private handleColumnReorder(order: string[]): void {
    // 컬럼 순서 변경 시 SelectionManager의 컬럼 인덱스 맵 업데이트
    this.selectionManager.updateColumnIndexMap(order);
    this.emitEvent('column:reorder', { order });
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
