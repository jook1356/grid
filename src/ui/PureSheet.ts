/**
 * PureSheet - 최상위 파사드 클래스
 *
 * GridCore와 UI Layer를 통합하는 메인 클래스입니다.
 * 사용자는 이 클래스 하나로 모든 그리드 기능에 접근할 수 있습니다.
 *
 * 설정 형식: PureSheetConfig (fields 기반)
 */

import { GridCore } from '../core/GridCore';
import type { ColumnDef, Row as RowData, SortState, FilterState, FieldDef, PureSheetConfig, PivotConfig, PivotResult, CellValue } from '../types';
import type { GroupingConfig } from '../types/grouping.types';
import type { ChangesSummary } from '../types/crud.types';
import type { CellPosition, ColumnState } from './types';
import { GridRenderer } from './GridRenderer';
import { SelectionManager } from './interaction/SelectionManager';
import { EditorManager } from './interaction/EditorManager';
import { ColumnManager } from './interaction/ColumnManager';
import { Row } from './row/Row';
import type { RowConfig, AggregateConfig } from './row/types';
import { configToInternalOptions, getGridMode, getPivotConfig, type InternalOptions } from './utils/configAdapter';
import { PivotProcessor } from '../processor/PivotProcessor';
import type { MergeManager } from './merge/MergeManager';
import { HierarchicalMergeManager } from './merge/MergeManager';
import { ChangeTracker } from '../core/ChangeTracker';
import { UndoStack } from '../core/UndoStack';
import { AddRowCommand, UpdateCellCommand, DeleteRowCommand, UndeleteRowCommand, DiscardRowCommand } from '../core/commands';
import { KeyboardShortcutManager } from './keyboard/KeyboardShortcutManager';

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
  private readonly options: InternalOptions;

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

  // 그리드 모드 ('flat' | 'pivot')
  private gridMode: 'flat' | 'pivot';

  // 원본 Config
  private originalConfig: PureSheetConfig;

  // 피벗 관련
  private pivotProcessor: PivotProcessor | null = null;
  private pivotConfig: PivotConfig | null = null;
  private pivotResult: PivotResult | null = null;

  // CRUD 및 Dirty State 관련
  private changeTracker: ChangeTracker;
  private undoStack: UndoStack;
  private keyboardShortcutManager: KeyboardShortcutManager;

  /**
   * PureSheet 생성자
   *
   * @param container - 그리드를 렌더링할 컨테이너 요소
   * @param config - 설정 (PureSheetConfig)
   *
   * @example
   * new PureSheet(container, {
   *   mode: 'flat',
   *   fields: [{ key: 'name', header: '이름', dataType: 'string' }],
   *   data: [{ name: '홍길동' }],
   *   columns: ['name'],
   * });
   */
  constructor(container: HTMLElement, config: PureSheetConfig) {
    this.container = container;
    this.originalConfig = config;

    // 그리드 모드 결정
    this.gridMode = getGridMode(config);

    // Config를 내부 옵션으로 변환
    this.options = configToInternalOptions(config);

    // 컨테이너를 포커스 가능하게 설정 (키보드 단축키 지원을 위해 필수)
    if (!this.container.hasAttribute('tabindex')) {
      this.container.setAttribute('tabindex', '0');
    }
    // 포커스 아웃라인(검정 테두리) 제거
    this.container.style.outline = 'none';

    // 피벗 모드일 때 pivotConfig 자동 설정
    if (this.gridMode === 'pivot') {
      const pivotConfigFromConfig = getPivotConfig(config);
      if (pivotConfigFromConfig) {
        this.pivotConfig = pivotConfigFromConfig;
      }
    }

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

    // CRUD 및 Undo/Redo 초기화 (EditorManager보다 먼저)
    this.changeTracker = new ChangeTracker();
    this.undoStack = new UndoStack({ maxSize: 100 });
    // keyboardShortcutManager는 EditorManager 초기화 후에 설정

    // EditorManager 초기화
    this.editorManager = new EditorManager({
      gridCore: this.gridCore,
      editable: this.options.editable ?? false,
      // 인라인 편집 시 ChangeTracker 연동
      onCellEdit: (rowId, field, _oldValue, newValue) => {
        // 추가된 행인지 확인
        const addedRow = this.changeTracker.addedRows.get(rowId);
        if (addedRow) {
          // 추가된 행도 UpdateCellCommand 사용하여 Undo/Redo 지원
          const command = new UpdateCellCommand(
            this.changeTracker,
            rowId,
            field,
            newValue,
            addedRow.data
          );
          this.undoStack.push(command);
          return;
        }

        // 기존 행은 UpdateCellCommand 사용
        const originalData = this.gridCore.getDataStore().getRowById(rowId);
        if (originalData) {
          const command = new UpdateCellCommand(
            this.changeTracker,
            rowId,
            field,
            newValue,
            originalData as RowData
          );
          this.undoStack.push(command);
        }
      },
      // 행 데이터 조회 (ChangeTracker 병합 데이터 포함)
      getRowData: (visibleIndex: number) => {
        const bodyRenderer = this.gridRenderer.getBodyRenderer();
        if (!bodyRenderer) return undefined;

        const virtualRows = bodyRenderer.getVirtualRows();
        const virtualRow = virtualRows[visibleIndex];
        if (virtualRow?.type === 'data') {
          return virtualRow.data;
        }
        return undefined;
      },
    });

    // 키보드 단축키 관리자 초기화 (Ctrl+Z/Y Undo/Redo)
    // onRefresh 콜백으로 Undo/Redo 후 새로고침 처리
    this.keyboardShortcutManager = new KeyboardShortcutManager(
      this.container,
      this.undoStack,
      { onRefresh: () => this.refresh() }
    );

    // ChangeTracker → BodyRenderer 연결 (Dirty State CSS 적용 + 데이터 병합)
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    if (bodyRenderer) {
      bodyRenderer.setGetRowState((rowId) => this.changeTracker.getRowState(rowId));
      bodyRenderer.setGetChangedFields((rowId) => this.changeTracker.getChangedFields(rowId));
      bodyRenderer.setDirtyStateCallbacks({
        getAddedRows: () => this.changeTracker.addedRows,
        getModifiedRows: () => this.changeTracker.modifiedRows,
        getDeletedRowIds: () => this.changeTracker.deletedRowIds,
      });
    }

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
   * 
   * 피벗 모드일 때 pivotConfig가 설정되어 있으면 자동으로 피벗 적용
   */
  async loadData(data: RowData[]): Promise<void> {
    // GridCore 초기화 완료 대기
    await this.initPromise;

    // DataStore에 원본 데이터 저장 (source + view 모두 설정)
    await this.gridCore.loadData(data);

    // 피벗 모드이고 pivotConfig가 있으면 피벗 적용
    if (this.gridMode === 'pivot' && this.pivotConfig) {
      await this.applyPivot();
    } else {
      this.gridRenderer.refresh();
    }

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
   * 
   * GridCore에서 정렬을 처리하고, 피벗 모드일 때는 
   * 정렬된 결과를 기반으로 피벗을 다시 적용합니다.
   * 
   * 처리 순서: GridCore(필터 → 정렬) → 피벗
   */
  async sort(sorts: SortState[]): Promise<void> {
    // GridCore에서 정렬 처리 (IndexManager 업데이트)
    await this.gridCore.sort(sorts);

    // 피벗 모드면 정렬된 데이터로 피벗 재적용
    if (this.gridMode === 'pivot' && this.pivotConfig) {
      await this.applyPivot();
    } else {
      this.gridRenderer.refresh();
    }

    this.emitEvent('sort:changed', { sorts });
  }

  /**
   * 필터 적용
   * 
   * GridCore에서 필터를 처리하고, 피벗 모드일 때는 
   * 필터링된 결과를 기반으로 피벗을 다시 적용합니다.
   * 
   * 처리 순서: GridCore(필터 → 정렬) → 피벗
   */
  async filter(filters: FilterState[]): Promise<void> {
    // GridCore에서 필터 처리 (IndexManager 업데이트)
    await this.gridCore.filter(filters);

    // 피벗 모드면 필터링된 데이터로 피벗 재적용
    if (this.gridMode === 'pivot' && this.pivotConfig) {
      await this.applyPivot();
    } else {
      this.gridRenderer.refresh();
    }

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
   * 그룹화 설정 (setGrouping의 alias)
   * @alias setGrouping
   */
  setGroupingConfig(config: GroupingConfig | null): void {
    this.setGrouping(config);
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

  // ===========================================================================
  // 셀 병합 API (Merge Manager)
  // ===========================================================================

  /**
   * MergeManager 설정
   *
   * 셀 병합 로직을 정의하는 MergeManager를 설정합니다.
   * 기본 제공 구현체:
   * - ContentMergeManager: 같은 값을 가진 연속된 셀 병합
   * - HierarchicalMergeManager: 계층적 병합 (상위 컬럼 기준)
   * - CustomMergeManager: 사용자 정의 병합 함수
   *
   * @param manager - MergeManager 인스턴스 (null이면 병합 해제)
   *
   * @example
   * ```ts
   * import { ContentMergeManager } from 'puresheet';
   *
   * // 'department' 컬럼에서 같은 값 병합
   * grid.setMergeManager(new ContentMergeManager(['department']));
   *
   * // 병합 해제
   * grid.setMergeManager(null);
   * ```
   */
  setMergeManager(manager: MergeManager | null): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.setMergeManager(manager);
  }

  /**
   * MergeManager 반환
   */
  getMergeManager(): MergeManager | null {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    return bodyRenderer?.getMergeManager() ?? null;
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
  // Dirty State CRUD API
  // ===========================================================================

  /**
   * 행 추가 (Dirty State)
   *
   * 원본 데이터에 즉시 반영하지 않고 pending 상태로 추가합니다.
   * Undo/Redo가 지원됩니다.
   *
   * @param row - 추가할 행 데이터
   * @param insertIndex - 삽입 위치 (기본: 마지막)
   * @returns 추가된 행의 ID
   */
  addRowDirty(row: Partial<RowData>, insertIndex?: number): string | number {
    const idx = insertIndex ?? this.gridCore.getDataStore().getRowCount();
    const command = new AddRowCommand(this.changeTracker, row as RowData, idx);
    this.undoStack.push(command);
    this.refresh();
    // Command에서 실제 생성된 ID 반환 (자동 생성된 ID 포함)
    return command.getAddedRowId();
  }

  /**
   * 셀 값 수정 (Dirty State)
   *
   * 원본 데이터에 즉시 반영하지 않고 pending 상태로 수정합니다.
   * Undo/Redo가 지원됩니다.
   *
   * @param rowId - 행 ID
   * @param field - 필드 이름
   * @param value - 새 값
   */
  updateCellDirty(rowId: string | number, field: string, value: CellValue): void {
    const originalData = this.gridCore.getDataStore().getRowById(rowId);
    if (!originalData) return;

    const command = new UpdateCellCommand(
      this.changeTracker,
      rowId,
      field,
      value,
      originalData as RowData
    );
    this.undoStack.push(command);
    this.refresh();
  }

  /**
   * 행 삭제 (Dirty State)
   *
   * 원본 데이터에서 즉시 삭제하지 않고 삭제 예정 상태로 표시합니다.
   * Undo/Redo가 지원됩니다.
   *
   * @param rowId - 삭제할 행 ID
   */
  deleteRowDirty(rowId: string | number): void {
    this.deleteRowDirtyCore(rowId, true);
  }

  /**
   * 행 삭제 내부 구현 (공통 로직)
   *
   * @param rowId - 삭제할 행 ID
   * @param shouldRefresh - refresh 호출 여부 (Batch 모드에서는 false)
   */
  private deleteRowDirtyCore(rowId: string | number, shouldRefresh: boolean): void {
    // 추가된 행인지 확인
    const addedRow = this.changeTracker.addedRows.get(rowId);
    if (addedRow) {
      // 추가된 행 삭제 → ChangeTracker에서 완전 제거 (deleted 상태가 아님)
      const command = new DeleteRowCommand(
        this.changeTracker,
        rowId,
        addedRow.data,
        addedRow.insertIndex
      );
      this.undoStack.push(command);
      if (shouldRefresh) this.refresh();
      return;
    }

    // 기존 행 삭제
    const originalData = this.gridCore.getDataStore().getRowById(rowId);
    const originalIndex = this.gridCore.getDataStore().getIndexById(rowId);
    if (!originalData || originalIndex === -1) return;

    const command = new DeleteRowCommand(
      this.changeTracker,
      rowId,
      originalData as RowData,
      originalIndex
    );
    this.undoStack.push(command);
    if (shouldRefresh) this.refresh();
  }

  /**
   * 선택된 행 일괄 삭제 (Dirty State)
   *
   * 현재 선택된 모든 행을 삭제 예정 상태로 표시합니다.
   * 하나의 Undo 단위로 묶여서 Ctrl+Z 한 번으로 전체 복원됩니다.
   *
   * @returns 삭제된 행 수
   */
  deleteSelectedRowsDirty(): number {
    const selectedIds = this.getSelectedRowIds();
    if (selectedIds.length === 0) return 0;

    this.beginBatch(`${selectedIds.length}개 행 삭제`);
    for (const rowId of selectedIds) {
      this.deleteRowDirtyInternal(rowId);
    }
    this.endBatch();

    return selectedIds.length;
  }

  /**
   * 삭제 예정 행 일괄 복원 (Dirty State)
   *
   * 지정된 행들의 삭제를 취소합니다.
   * 하나의 Undo 단위로 묶여서 Ctrl+Z 한 번으로 전체 취소됩니다.
   *
   * @param rowIds - 복원할 행 ID 배열
   * @returns 복원된 행 수
   */
  undeleteRowsDirty(rowIds: (string | number)[]): number {
    const validIds = rowIds.filter(id => this.changeTracker.deletedRowIds.has(id));
    if (validIds.length === 0) return 0;

    this.beginBatch(`${validIds.length}개 행 복원`);
    for (const rowId of validIds) {
      this.undeleteRowDirtyInternal(rowId);
    }
    this.endBatch();

    return validIds.length;
  }

  /**
   * 단일 행 삭제 취소 (Dirty State)
   *
   * @param rowId - 복원할 행 ID
   */
  undeleteRowDirty(rowId: string | number): void {
    if (!this.changeTracker.deletedRowIds.has(rowId)) return;
    this.undeleteRowDirtyInternal(rowId);
    this.refresh();
  }

  /**
   * 삭제 취소 내부 구현 (refresh 없이)
   */
  private undeleteRowDirtyInternal(rowId: string | number): void {
    // 삭제된 행의 원본 데이터 조회
    const originalData = this.gridCore.getDataStore().getRowById(rowId);
    const originalIndex = this.gridCore.getDataStore().getIndexById(rowId);
    if (!originalData || originalIndex === -1) return;

    const command = new UndeleteRowCommand(
      this.changeTracker,
      rowId,
      originalData as RowData,
      originalIndex
    );
    this.undoStack.push(command);
  }

  /**
   * 단일 행 변경사항 폐기 (Dirty State - Undo 지원)
   *
   * Undo/Redo가 지원됩니다.
   *
   * @param rowId - 폐기할 행 ID
   */
  discardRowDirty(rowId: string | number): void {
    const command = new DiscardRowCommand(
      this.changeTracker,
      rowId
    );
    this.undoStack.push(command);
    this.refresh();
  }

  /**
   * 선택된 행 변경사항 일괄 폐기 (Dirty State)
   *
   * 하나의 Undo 단위로 묶여서 Ctrl+Z 한 번으로 전체 복원됩니다.
   *
   * @returns 폐기된 행 수
   */
  discardSelectedRowsDirty(): number {
    const selectedIds = this.getSelectedRowIds();
    if (selectedIds.length === 0) return 0;

    this.beginBatch(`${selectedIds.length}개 행 폐기`);
    for (const rowId of selectedIds) {
      const command = new DiscardRowCommand(
        this.changeTracker,
        rowId
      );
      this.undoStack.push(command);
    }
    this.endBatch();

    return selectedIds.length;
  }

  /**
   * 행 삭제 내부 구현 (refresh 없이 - Batch 모드용)
   */
  private deleteRowDirtyInternal(rowId: string | number): void {
    this.deleteRowDirtyCore(rowId, false);
  }

  // ===========================================================================
  // Undo/Redo API
  // ===========================================================================

  /**
   * Batch 모드 시작
   *
   * beginBatch() 호출 후 endBatch() 전까지의 모든 Dirty 작업들이
   * 하나의 Undo 단위로 묶입니다.
   *
   * @param description - Batch 설명 (디버깅용)
   *
   * @example
   * grid.beginBatch('3개 행 삭제');
   * selectedIds.forEach(id => grid.deleteRowDirty(id));
   * grid.endBatch();
   * // → Ctrl+Z 1번으로 3개 행 모두 복원
   */
  beginBatch(description?: string): void {
    this.undoStack.beginBatch(description);
  }

  /**
   * Batch 모드 종료
   *
   * 버퍼에 모인 작업들을 하나의 Undo 단위로 스택에 추가합니다.
   */
  endBatch(): void {
    this.undoStack.endBatch();
    this.refresh();
  }

  /**
   * 실행 취소 (Undo)
   *
   * @returns 성공 여부
   */
  undo(): boolean {
    const result = this.undoStack.undo();
    if (result) this.refresh();
    return result;
  }

  /**
   * 다시 실행 (Redo)
   *
   * @returns 성공 여부
   */
  redo(): boolean {
    const result = this.undoStack.redo();
    if (result) this.refresh();
    return result;
  }

  /**
   * Undo 가능 여부
   */
  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }

  /**
   * Redo 가능 여부
   */
  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  // ===========================================================================
  // Dirty State 조회 API
  // ===========================================================================

  /**
   * 변경사항 존재 여부
   */
  get hasChanges(): boolean {
    return this.changeTracker.hasChanges;
  }

  /**
   * 변경사항 조회
   */
  getChanges(): ChangesSummary {
    return this.changeTracker.getChanges();
  }

  /**
   * 행 상태 조회
   */
  getRowState(rowId: string | number): 'pristine' | 'added' | 'modified' | 'deleted' {
    return this.changeTracker.getRowState(rowId);
  }

  /**
   * 변경사항 커밋 (원본 데이터에 반영)
   *
   * 모든 pending 변경사항을 DataStore에 반영합니다.
   */
  async commitChanges(): Promise<void> {
    const changes = this.getChanges();

    // DataStore에 반영
    for (const added of changes.added) {
      await this.gridCore.addRow(added.data);
    }
    for (const modified of changes.modified) {
      const index = this.gridCore.getDataStore().getIndexById(modified.rowId);
      if (index >= 0) {
        await this.gridCore.updateRow(index, modified.currentData);
      }
    }
    for (const deleted of changes.deleted) {
      const index = this.gridCore.getDataStore().getIndexById(deleted.rowId);
      if (index >= 0) {
        await this.gridCore.removeRow(index);
      }
    }

    // ChangeTracker & UndoStack 초기화
    this.changeTracker.commitComplete();
    this.undoStack.clear();

    this.refresh();
  }

  /**
   * 모든 변경사항 폐기
   */
  discardChanges(): void {
    this.changeTracker.discard();
    this.undoStack.clear();
    this.refresh();
  }

  /**
   * 특정 행 변경사항 폐기
   */
  discardRow(rowId: string | number): void {
    this.changeTracker.discardRow(rowId);
    this.refresh();
  }

  // ===========================================================================
  // 선택 API
  // ===========================================================================

  /**
   * 선택된 행 가져오기
   *
   * ChangeTracker의 pending 데이터를 포함한 최신 데이터를 반환합니다.
   */
  getSelectedRows(): RowData[] {
    const selectedIds = this.getSelectedRowIds();
    const rows: RowData[] = [];

    for (const id of selectedIds) {
      const row = this.getRowById(id);
      if (row) {
        rows.push(row);
      }
    }

    return rows;
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
   *
   * 그룹화 시 그룹 헤더를 제외한 데이터 행만 선택합니다.
   */
  selectAll(): void {
    // 그룹화 지원을 위해 virtualRows 동기화
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    if (bodyRenderer) {
      this.selectionManager.setVirtualRows(bodyRenderer.getVirtualRows());
    }
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

  /**
   * ID로 행 데이터 가져오기
   *
   * ChangeTracker의 pending 데이터를 우선 조회하고,
   * 없으면 GridCore의 원본 데이터를 반환합니다.
   *
   * @param rowId - 행 ID
   * @returns 행 데이터 또는 undefined
   */
  getRowById(rowId: string | number): RowData | undefined {
    // 추가된 행 확인
    const addedRow = this.changeTracker.addedRows.get(rowId);
    if (addedRow) {
      return addedRow.data;
    }

    // 수정된 행 확인 (currentData 반환)
    const modifiedRow = this.changeTracker.modifiedRows.get(rowId);
    if (modifiedRow) {
      return modifiedRow.currentData;
    }

    // GridCore에서 조회
    return this.gridCore.getDataStore().getRowById(rowId) as RowData | undefined;
  }

  /**
   * 선택된 행 삭제 (Dirty State)
   *
   * 추가된 행과 기존 행 모두 처리합니다.
   * - 추가된 행: ChangeTracker에서 완전 제거
   * - 기존 행: 삭제 예정 상태로 표시
   *
   * @returns 삭제된 행 수
   */
  deleteSelectedRows(): number {
    const selectedIds = this.getSelectedRowIds();
    if (selectedIds.length === 0) return 0;

    for (const id of selectedIds) {
      this.deleteRowDirty(id);
    }

    this.clearSelection();
    return selectedIds.length;
  }

  /**
   * 선택된 행의 셀 값 수정 (Dirty State)
   *
   * @param field - 수정할 필드명
   * @param value - 새 값 또는 현재 값을 받아 새 값을 반환하는 함수
   * @returns 수정된 행 수
   */
  updateSelectedCells(
    field: string,
    value: CellValue | ((currentValue: CellValue, row: RowData) => CellValue)
  ): number {
    const selectedIds = this.getSelectedRowIds();
    if (selectedIds.length === 0) return 0;

    for (const id of selectedIds) {
      const row = this.getRowById(id);
      if (row) {
        const newValue = typeof value === 'function'
          ? value(row[field] as CellValue, row)
          : value;
        this.updateCellDirty(id, field, newValue);
      }
    }

    return selectedIds.length;
  }

  /**
   * 선택된 행의 변경사항 폐기
   *
   * @returns 폐기된 행 수
   */
  discardSelectedRows(): number {
    const selectedIds = this.getSelectedRowIds();
    if (selectedIds.length === 0) return 0;

    for (const id of selectedIds) {
      this.discardRow(id);
    }

    return selectedIds.length;
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

  /**
   * formatRow 콜백 설정
   *
   * 행이 렌더링될 때마다 호출되는 콜백을 설정합니다.
   * 조건부 스타일링, 셀 포맷팅 등에 사용합니다.
   *
   * @param callback - formatRow 콜백 (null이면 해제)
   *
   * @example
   * ```ts
   * sheet.setFormatRow((info) => {
   *   if (info.type === 'data') {
   *     const { data, rowElement, cells } = info.ctx;
   *     if (data.price >= 1000) {
   *       rowElement.classList.add('highlight');
   *     }
   *   }
   * });
   * ```
   */
  setFormatRow(callback: import('../types').FormatRowCallback | null): void {
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    bodyRenderer?.setFormatRow(callback ?? undefined);
    this.refresh();
  }

  /**
   * 현재 그리드 모드 가져오기
   */
  getMode(): 'flat' | 'pivot' {
    return this.gridMode;
  }

  /**
   * 그리드 모드 변경
   *
   * @param mode - 새 모드 ('flat' | 'pivot')
   */
  async setMode(mode: 'flat' | 'pivot'): Promise<void> {
    if (this.gridMode === mode) return;

    this.gridMode = mode;

    if (mode === 'pivot') {
      // flat → pivot: 피벗 모드 활성화
      if (this.pivotConfig) {
        await this.applyPivot();
      }
    } else {
      // pivot → flat: 일반 모드로 복원
      this.restoreFromPivot();
    }

    this.refresh();
  }

  /**
   * 피벗 설정 적용
   *
   * @param config - 피벗 설정
   */
  async setPivotConfig(config: PivotConfig): Promise<void> {
    this.pivotConfig = config;

    if (this.gridMode === 'pivot') {
      await this.applyPivot();
    }
  }

  /**
   * 피벗 설정 가져오기
   */
  getPivotConfig(): PivotConfig | null {
    return this.pivotConfig;
  }

  /**
   * 피벗 결과 가져오기
   */
  getPivotResult(): PivotResult | null {
    return this.pivotResult;
  }

  /**
   * 필드 정의 가져오기 (새 API 사용 시)
   */
  getFields(): FieldDef[] | null {
    return this.originalConfig?.fields ?? null;
  }

  // ===========================================================================
  // 피벗 내부 메서드
  // ===========================================================================

  /**
   * 피벗 적용
   * 
   * 데이터 처리 순서: 필터 → 정렬 → 피벗
   * 
   * GridCore가 필터/정렬을 처리하고, 그 결과 인덱스로 필터링된 데이터만 피벗에 전달합니다.
   * 이를 통해 필터/정렬 연산의 중복을 방지합니다.
   * 
   * 1. GridCore의 IndexManager에서 보이는 인덱스 조회 (필터/정렬 적용됨)
   * 2. 해당 인덱스의 데이터만 추출하여 피벗에 전달
   * 3. PivotProcessor로 피벗 연산만 수행 (필터/정렬은 이미 적용됨)
   * 4. GridRenderer의 헤더를 PivotHeaderRenderer로 교체
   * 5. 피벗 결과를 뷰 데이터로 설정 (setViewData)
   * 6. rowHeaderColumns에 계층적 병합 자동 적용
   */
  private async applyPivot(): Promise<void> {
    if (!this.pivotConfig) return;

    // PivotProcessor 생성 (없으면)
    if (!this.pivotProcessor) {
      this.pivotProcessor = new PivotProcessor();
    }

    // DataStore에서 원본 데이터 조회
    const sourceData = this.gridCore.getDataStore().getSourceData() as RowData[];

    // 현재 viewState의 필터/정렬 상태 확인
    const viewState = this.gridCore.getViewState();
    const hasFilterOrSort = viewState.filters.length > 0 || viewState.sorts.length > 0;

    let filteredData: RowData[];

    if (hasFilterOrSort) {
      // 필터/정렬이 있으면 프로세서를 통해 올바른 인덱스를 다시 계산
      // (이전 applyPivot()에서 IndexManager가 피벗 결과 길이로 변경되었을 수 있음)
      const processor = this.gridCore.getProcessor();
      const result = await processor.query({
        filters: viewState.filters,
        sorts: viewState.sorts,
      });

      // 결과 인덱스로 데이터 추출
      filteredData = Array.from(result.indices).map(i => sourceData[i]).filter((row): row is RowData => row !== undefined);
    } else {
      // 필터/정렬이 없으면 전체 원본 데이터 사용
      filteredData = [...sourceData];
    }

    // 필터링된 데이터로 피벗 연산 수행
    // sorts를 PivotConfig에 전달하여 피벗 결과의 행 순서에 반영
    await this.pivotProcessor.initialize(filteredData);
    const pivotConfigWithSorts = {
      ...this.pivotConfig,
      sorts: viewState.sorts,
    };
    this.pivotResult = await this.pivotProcessor.pivot(pivotConfigWithSorts);

    // 피벗 헤더로 교체 (HeaderRenderer → PivotHeaderRenderer)
    this.gridRenderer.switchToPivotHeader(this.pivotResult);

    // 피벗 데이터 평탄화 (PivotRow → Row 형식으로 변환)
    const flattenedData = this.pivotResult.pivotedData.map(pivotRow => ({
      ...pivotRow.rowHeaders,
      ...pivotRow.values,
      __pivotType: pivotRow.type,
    }));

    // 피벗 컬럼
    const allColumns = [...this.pivotResult.rowHeaderColumns, ...this.pivotResult.columns];

    // 뷰 데이터만 업데이트 (원본 sourceRows는 유지됨!)
    this.gridCore.getDataStore().setViewData(flattenedData, allColumns);
    this.gridCore.getIndexManager().initialize(flattenedData.length);

    // rowHeaderColumns에 계층적 병합 자동 적용
    // 피벗의 행 헤더는 계층 구조를 가지므로 HierarchicalMergeManager 사용
    const rowHeaderKeys = this.pivotResult.rowHeaderColumns.map(col => col.key);
    if (rowHeaderKeys.length > 0) {
      const mergeManager = new HierarchicalMergeManager(rowHeaderKeys);
      this.setMergeManager(mergeManager);
    }

    // UI 새로고침
    this.gridRenderer.refresh();
  }

  /**
   * 피벗 해제 (일반 모드로 복원)
   * 
   * 1. PivotHeaderRenderer를 제거하고 HeaderRenderer로 복원
   * 2. DataStore의 원본 데이터로 복원
   * 3. 피벗용 MergeManager 해제
   */
  private restoreFromPivot(): void {
    this.pivotResult = null;

    // 피벗용 MergeManager 해제
    this.setMergeManager(null);

    // 일반 헤더로 복원 (PivotHeaderRenderer → HeaderRenderer)
    this.gridRenderer.switchToFlatHeader();

    // DataStore의 원본 데이터로 복원 (sourceRows → rows)
    this.gridCore.getDataStore().resetToSource();
    this.gridCore.getIndexManager().initialize(
      this.gridCore.getDataStore().getSourceData().length
    );
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

    // CRUD 관련 정리
    this.keyboardShortcutManager.destroy();
    this.undoStack.clear();
    this.changeTracker.removeAllListeners();

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
    this.selectionManager.on('selectionChanged', (state) => {
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
      // 편집 완료 후 컨테이너로 포커스 복원 (키보드 단축키 지원)
      this.container.focus();
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
   *
   * @param viewIndex - 화면상 행 인덱스 (그룹 헤더 포함)
   * @param row - 행 데이터
   * @param event - 마우스 이벤트
   * @param dataIndex - 실제 데이터 인덱스 (그룹 헤더 제외)
   */
  private handleRowClick(viewIndex: number, row: RowData, event: MouseEvent, dataIndex?: number): void {
    // row 선택 모드에서만 행 선택 처리
    // range/cell 모드에서는 handleCellClick에서 처리
    if (this.options.selectionMode === 'row') {
      const rowId = row['id'] as string | number | undefined;
      if (rowId !== undefined) {
        // Shift+클릭 범위 선택을 위해 virtualRows 동기화
        const bodyRenderer = this.gridRenderer.getBodyRenderer();
        if (bodyRenderer) {
          this.selectionManager.setVirtualRows(bodyRenderer.getVirtualRows());
        }
        // viewIndex를 전달하여 올바른 범위 선택
        this.selectionManager.handleRowClick(viewIndex, rowId, event);
      }
    }
    // 외부 이벤트에는 dataIndex 전달 (API 호환성)
    this.emitEvent('row:click', { row, rowIndex: dataIndex ?? viewIndex, event });
  }

  /**
   * 셀 클릭 핸들러
   */
  private handleCellClick(position: CellPosition, value: unknown, event: MouseEvent): void {
    // Shift+클릭 범위 선택을 위해 virtualRows 동기화
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    if (bodyRenderer) {
      this.selectionManager.setVirtualRows(bodyRenderer.getVirtualRows());
    }
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

    // 드래그 선택 시작 전에 virtualRows 동기화 (그룹화 시 viewIndex → dataIndex 변환용)
    const bodyRenderer = this.gridRenderer.getBodyRenderer();
    if (bodyRenderer) {
      this.selectionManager.setVirtualRows(bodyRenderer.getVirtualRows());
    }

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
