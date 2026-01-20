/**
 * SelectionManager - 행/셀 선택 관리
 *
 * 행 및 셀 선택 상태를 관리하고 키보드/마우스 상호작용을 처리합니다.
 * - 단일/다중 선택
 * - Shift 범위 선택
 * - Ctrl/Cmd 토글 선택
 * - 드래그 범위 선택
 * - 키보드 네비게이션
 *
 * 선택된 셀은 Set<string>에 "rowIndex:columnKey" 형태로 저장됩니다.
 * Set.has()를 사용하여 O(1) 조회 성능을 보장합니다.
 */

import { EventEmitter } from '../../core/EventEmitter';
import type { GridCore } from '../../core/GridCore';
import type { ColumnDef, Row } from '../../types';
import type { CellPosition, SelectionMode, SelectionState } from '../types';

/**
 * SelectionManager 이벤트 타입
 */
interface SelectionManagerEvents {
  /** 선택 상태 변경 */
  selectionChanged: SelectionState;
}

/**
 * SelectionManager 설정
 */
export interface SelectionManagerOptions {
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 선택 모드 */
  selectionMode: SelectionMode;
  /** 다중 선택 허용 */
  multiSelect: boolean;
}

/**
 * 선택 관리자
 */
export class SelectionManager extends EventEmitter<SelectionManagerEvents> {
  private readonly gridCore: GridCore;
  private readonly multiSelect: boolean;

  // 선택 상태
  private state: SelectionState;

  // 컬럼 순서 캐시 (컬럼 인덱스 조회용)
  private columnIndexMap: Map<string, number> = new Map();

  // 드래그 세션 상태
  private dragAddToExisting = false;  // Ctrl 누른 상태로 드래그 시작했는지
  private preDragSelection: Set<string> = new Set();  // 드래그 시작 전 선택 상태

  constructor(options: SelectionManagerOptions) {
    super();

    this.gridCore = options.gridCore;
    this.multiSelect = options.multiSelect;

    this.state = {
      selectedRows: new Set(),
      selectedCells: new Set(),
      selectionMode: options.selectionMode,
      anchorCell: null,
      isDragging: false,
    };

    // 컬럼 인덱스 맵 초기화
    this.updateColumnIndexMap();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 현재 선택 상태 가져오기
   */
  getState(): SelectionState {
    // 항상 새로운 객체와 Set을 반환 (불변성 보장)
    return {
      selectedRows: new Set(this.state.selectedRows ?? []),
      selectedCells: new Set(this.state.selectedCells ?? []),
      selectionMode: this.state.selectionMode,
      anchorCell: this.state.anchorCell,
      isDragging: this.state.isDragging,
    };
  }

  /**
   * 선택된 셀 Set 가져오기 (O(1) 조회용)
   */
  getSelectedCells(): Set<string> {
    return this.state.selectedCells;
  }

  /**
   * 셀이 선택되었는지 확인 (O(1))
   */
  isCellSelected(rowIndex: number, columnKey: string): boolean {
    return this.state.selectedCells.has(`${rowIndex}:${columnKey}`);
  }

  /**
   * 선택된 행 ID 가져오기
   */
  getSelectedRowIds(): Set<string | number> {
    return new Set(this.state.selectedRows);
  }

  /**
   * 선택된 행 데이터 가져오기
   */
  getSelectedRows(): Row[] {
    const rows: Row[] = [];
    for (const id of this.state.selectedRows) {
      const row = this.gridCore.getRowById(id);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * 드래그 중인지 확인
   */
  isDragging(): boolean {
    return this.state.isDragging;
  }

  /**
   * 선택 모드 변경
   */
  setSelectionMode(mode: SelectionMode): void {
    this.state.selectionMode = mode;
    this.clearSelection();
  }

  /**
   * 컬럼 인덱스 맵 업데이트 (컬럼 순서 변경 시 호출)
   */
  updateColumnIndexMap(): void {
    this.columnIndexMap.clear();
    const columns = this.gridCore.getColumns();
    columns.forEach((col, index) => {
      this.columnIndexMap.set(col.key, index);
    });
  }

  // ===========================================================================
  // 행 선택
  // ===========================================================================

  /**
   * 행 클릭 처리
   */
  handleRowClick(rowIndex: number, rowId: string | number, event: MouseEvent): void {
    if (this.state.selectionMode === 'none') return;

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (isCtrlOrCmd && this.multiSelect) {
      // Ctrl/Cmd + 클릭: 토글
      this.toggleRowSelection(rowId);
    } else if (isShift && this.multiSelect && this.state.anchorCell) {
      // Shift + 클릭: 범위 선택
      this.selectRowRange(this.state.anchorCell.rowIndex, rowIndex);
    } else {
      // 일반 클릭: 단일 선택
      this.selectSingleRow(rowId, rowIndex);
    }
  }

  /**
   * 단일 행 선택
   */
  selectSingleRow(rowId: string | number, rowIndex?: number): void {
    this.state.selectedRows.clear();
    this.state.selectedRows.add(rowId);

    // 앵커 설정
    if (rowIndex !== undefined) {
      this.state.anchorCell = { rowIndex, columnKey: '' };
    }

    this.emitSelectionChanged();
  }

  /**
   * 행 선택 토글
   */
  toggleRowSelection(rowId: string | number): void {
    if (this.state.selectedRows.has(rowId)) {
      this.state.selectedRows.delete(rowId);
    } else {
      this.state.selectedRows.add(rowId);
    }

    this.emitSelectionChanged();
  }

  /**
   * 행 범위 선택 (Shift + 클릭)
   */
  selectRowRange(startIndex: number, endIndex: number): void {
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    this.state.selectedRows.clear();

    for (let i = minIndex; i <= maxIndex; i++) {
      const row = this.gridCore.getRowByVisibleIndex(i);
      if (row && row['id'] !== undefined) {
        this.state.selectedRows.add(row['id'] as string | number);
      }
    }

    this.emitSelectionChanged();
  }

  /**
   * 여러 행 선택
   */
  selectRows(rowIds: (string | number)[]): void {
    if (!this.multiSelect) {
      // 다중 선택 불가 시 첫 번째만
      this.state.selectedRows.clear();
      if (rowIds.length > 0 && rowIds[0] !== undefined) {
        this.state.selectedRows.add(rowIds[0]);
      }
    } else {
      this.state.selectedRows = new Set(rowIds);
    }

    this.emitSelectionChanged();
  }

  /**
   * 전체 선택
   */
  selectAll(): void {
    if (!this.multiSelect) return;

    if (this.state.selectionMode === 'range' || this.state.selectionMode === 'all') {
      // 셀 모드: 모든 셀 선택 (all 모드에서는 행도 자동 동기화됨)
      this.selectAllCells();
    } else if (this.state.selectionMode === 'row') {
      // 행 모드: 모든 행 선택
      this.state.selectedRows.clear();
      const totalRows = this.gridCore.getVisibleRowCount();
      for (let i = 0; i < totalRows; i++) {
        const row = this.gridCore.getRowByVisibleIndex(i);
        if (row && row['id'] !== undefined) {
          this.state.selectedRows.add(row['id'] as string | number);
        }
      }
    }

    this.emitSelectionChanged();
  }

  /**
   * 모든 셀 선택
   */
  selectAllCells(): void {
    if (!this.multiSelect) return;

    const totalRows = this.gridCore.getVisibleRowCount();
    const columns = this.gridCore.getColumns();

    this.state.selectedCells.clear();

    for (let row = 0; row < totalRows; row++) {
      for (const col of columns) {
        this.state.selectedCells.add(`${row}:${col.key}`);
      }
    }

    // 선택 범위 업데이트
    if (totalRows > 0 && columns.length > 0) {
      this.state.selectionRange = {
        startRow: 0,
        endRow: totalRows - 1,
        startCol: 0,
        endCol: columns.length - 1,
      };
    }

    this.emitSelectionChanged();
  }

  /**
   * 선택 해제
   */
  clearSelection(): void {
    this.state.selectedRows.clear();
    this.state.selectedCells.clear();
    this.state.anchorCell = null;
    this.state.isDragging = false;

    this.emitSelectionChanged();
  }

  // ===========================================================================
  // 셀 선택
  // ===========================================================================

  /**
   * 셀 클릭 처리
   * 
   * - 일반 클릭: 단일 셀 선택
   * - Ctrl+클릭: 셀 토글 (기존 선택 유지하며 추가/제거)
   * - Shift+클릭: 앵커→클릭 셀 범위 선택
   * - Ctrl+Shift+클릭: 기존 선택 유지 + 범위 추가
   */
  handleCellClick(position: CellPosition, event: MouseEvent): void {
    console.log('[SelectionManager] handleCellClick', {
      position,
      selectionMode: this.state.selectionMode,
    });
    // 'range' 또는 'all' 모드에서만 셀 선택 가능
    if (this.state.selectionMode !== 'range' && this.state.selectionMode !== 'all') {
      console.log('[SelectionManager] Skipped - mode is', this.state.selectionMode);
      return;
    }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (isShift && this.state.anchorCell) {
      // Shift+클릭: 범위 선택
      // Ctrl+Shift면 기존 선택 유지, 그냥 Shift면 새로 선택
      this.selectCellRange(this.state.anchorCell, position, isCtrlOrCmd);
    } else if (isCtrlOrCmd && this.multiSelect) {
      // Ctrl+클릭: 개별 셀 토글
      this.toggleCellSelection(position);
    } else {
      // 일반 클릭: 단일 셀 선택
      this.selectSingleCell(position);
    }
  }

  /**
   * 단일 셀 선택
   */
  selectSingleCell(position: CellPosition): void {
    console.log('[SelectionManager] selectSingleCell', position);
    this.state.selectedCells.clear();
    const key = this.getCellKey(position);
    this.state.selectedCells.add(key);
    this.state.anchorCell = position;  // Shift+클릭 기준점
    console.log('[SelectionManager] selectedCells after add:', [...this.state.selectedCells]);

    this.emitSelectionChanged();
  }

  /**
   * 셀 선택 토글 (Ctrl + 클릭)
   */
  toggleCellSelection(position: CellPosition): void {
    const key = this.getCellKey(position);

    if (this.state.selectedCells.has(key)) {
      this.state.selectedCells.delete(key);
    } else {
      this.state.selectedCells.add(key);
    }

    // 앵커 업데이트 (다음 Shift+클릭의 기준점)
    this.state.anchorCell = position;

    this.emitSelectionChanged();
  }

  /**
   * 셀 범위 선택 (Shift + 클릭)
   *
   * @param start - 시작 셀 (앵커)
   * @param end - 끝 셀
   * @param addToExisting - 기존 선택에 추가할지 여부 (Ctrl+Shift)
   */
  selectCellRange(start: CellPosition, end: CellPosition, addToExisting = false): void {
    if (!addToExisting) {
      this.state.selectedCells.clear();
    }

    this.addCellsInRange(start, end);
    this.emitSelectionChanged();
  }

  // ===========================================================================
  // 드래그 선택
  // ===========================================================================

  /**
   * 드래그 선택 시작
   */
  startDragSelection(position: CellPosition, event: MouseEvent): void {
    // 'range' 또는 'all' 모드에서만 드래그 선택 가능
    if (this.state.selectionMode !== 'range' && this.state.selectionMode !== 'all') return;

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    
    // Ctrl 상태 저장 (드래그 세션 동안 유지)
    this.dragAddToExisting = isCtrlOrCmd;
    
    // 드래그 시작 전 선택 상태 저장 (Ctrl+드래그 시 복원용)
    if (isCtrlOrCmd) {
      this.preDragSelection = new Set(this.state.selectedCells);
    } else {
      this.preDragSelection.clear();
      this.state.selectedCells.clear();
    }

    this.state.isDragging = true;
    this.state.anchorCell = position;  // 드래그 시작점 = 앵커

    // 시작 셀 선택
    this.state.selectedCells.add(this.getCellKey(position));

    this.emitSelectionChanged();
  }

  /**
   * 드래그 선택 업데이트 (마우스 이동 중)
   */
  updateDragSelection(position: CellPosition): void {
    if (!this.state.isDragging || !this.state.anchorCell) return;

    // Ctrl+드래그: 이전 선택 복원 후 새 범위 추가
    if (this.dragAddToExisting) {
      this.state.selectedCells = new Set(this.preDragSelection);
    } else {
      this.state.selectedCells.clear();
    }

    // 앵커에서 현재 위치까지 범위 추가
    this.addCellsInRange(this.state.anchorCell, position);
    this.emitSelectionChanged();
  }

  /**
   * 드래그 선택 완료
   */
  commitDragSelection(): void {
    if (!this.state.isDragging) return;

    this.state.isDragging = false;
    this.dragAddToExisting = false;
    this.preDragSelection.clear();
    this.emitSelectionChanged();
  }

  /**
   * 드래그 선택 취소
   */
  cancelDragSelection(): void {
    if (!this.state.isDragging) return;

    this.state.isDragging = false;
    this.dragAddToExisting = false;
    
    // 이전 선택 복원
    this.state.selectedCells = new Set(this.preDragSelection);
    this.preDragSelection.clear();

    this.emitSelectionChanged();
  }

  // ===========================================================================
  // 키보드 네비게이션
  // ===========================================================================

  /**
   * 키보드 이벤트 처리
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    const { key, ctrlKey, metaKey, shiftKey } = event;
    const isCtrlOrCmd = ctrlKey || metaKey;

    switch (key) {
      case 'ArrowUp':
        this.moveFocus(-1, 0, shiftKey);
        return true;

      case 'ArrowDown':
        this.moveFocus(1, 0, shiftKey);
        return true;

      case 'ArrowLeft':
        this.moveFocus(0, -1, shiftKey);
        return true;

      case 'ArrowRight':
        this.moveFocus(0, 1, shiftKey);
        return true;

      case 'Home':
        if (isCtrlOrCmd) {
          this.focusFirstRow();
        } else {
          this.focusFirstCell();
        }
        return true;

      case 'End':
        if (isCtrlOrCmd) {
          this.focusLastRow();
        } else {
          this.focusLastCell();
        }
        return true;

      case 'a':
      case 'A':
        if (isCtrlOrCmd) {
          this.selectAll();
          event.preventDefault();
          return true;
        }
        break;

      case 'Escape':
        this.clearSelection();
        return true;
    }

    return false;
  }

  /**
   * 셀 이동 (화살표 키)
   */
  private moveFocus(rowDelta: number, colDelta: number, extendSelection: boolean): void {
    const columns = this.gridCore.getColumns();

    if (!this.state.anchorCell) {
      // 첫 셀 선택
      const firstCol = columns[0];
      if (firstCol) {
        this.selectSingleCell({ rowIndex: 0, columnKey: firstCol.key });
      }
      return;
    }

    // 새 위치 계산
    const currentColIndex = this.getColumnIndex(this.state.anchorCell.columnKey);
    const newRowIndex = Math.max(
      0,
      Math.min(
        this.state.anchorCell.rowIndex + rowDelta,
        this.gridCore.getVisibleRowCount() - 1
      )
    );
    const newColIndex = Math.max(
      0,
      Math.min(currentColIndex + colDelta, columns.length - 1)
    );

    const newColumn = columns[newColIndex];
    if (!newColumn) return;

    const newPosition: CellPosition = {
      rowIndex: newRowIndex,
      columnKey: newColumn.key,
    };

    const isCellMode = this.state.selectionMode === 'range' || this.state.selectionMode === 'all';
    
    if (extendSelection && isCellMode) {
      // Shift + 화살표: 선택 확장 (anchorCell 유지)
      const anchor = this.state.anchorCell;
      this.selectCellRange(anchor, newPosition);
      // anchorCell은 확장 시 변경하지 않음 (시작점 유지)
    } else {
      // 일반 이동: 단일 셀 선택
      this.selectSingleCell(newPosition);
    }

    // 행 모드에서는 행도 선택 (all 모드는 emitSelectionChanged에서 자동 동기화)
    if (this.state.selectionMode === 'row') {
      const row = this.gridCore.getRowByVisibleIndex(newRowIndex);
      if (row && row['id'] !== undefined) {
        this.selectSingleRow(row['id'] as string | number, newRowIndex);
      }
    }
  }

  /**
   * 첫 번째 행으로 이동
   */
  private focusFirstRow(): void {
    const columnKey = this.state.anchorCell?.columnKey;
    if (columnKey) {
      this.selectSingleCell({ rowIndex: 0, columnKey });
    }
  }

  /**
   * 마지막 행으로 이동
   */
  private focusLastRow(): void {
    const lastIndex = this.gridCore.getVisibleRowCount() - 1;
    const columnKey = this.state.anchorCell?.columnKey;
    if (columnKey) {
      this.selectSingleCell({
        rowIndex: Math.max(0, lastIndex),
        columnKey,
      });
    }
  }

  /**
   * 첫 번째 열로 이동
   */
  private focusFirstCell(): void {
    const columns = this.gridCore.getColumns();
    const firstColumn = columns[0];
    if (firstColumn) {
      this.selectSingleCell({
        rowIndex: this.state.anchorCell?.rowIndex ?? 0,
        columnKey: firstColumn.key,
      });
    }
  }

  /**
   * 마지막 열로 이동
   */
  private focusLastCell(): void {
    const columns = this.gridCore.getColumns();
    const lastColumn = columns[columns.length - 1];
    if (lastColumn) {
      this.selectSingleCell({
        rowIndex: this.state.anchorCell?.rowIndex ?? 0,
        columnKey: lastColumn.key,
      });
    }
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 셀 키 생성
   */
  private getCellKey(position: CellPosition): string {
    return `${position.rowIndex}:${position.columnKey}`;
  }

  /**
   * 컬럼 인덱스 가져오기
   */
  private getColumnIndex(columnKey: string): number {
    return this.columnIndexMap.get(columnKey) ?? 0;
  }

  /**
   * 범위 내 모든 셀을 selectedCells에 추가
   */
  private addCellsInRange(start: CellPosition, end: CellPosition): void {
    const columns = this.gridCore.getColumns();
    const startColIndex = this.getColumnIndex(start.columnKey);
    const endColIndex = this.getColumnIndex(end.columnKey);

    const minRow = Math.min(start.rowIndex, end.rowIndex);
    const maxRow = Math.max(start.rowIndex, end.rowIndex);
    const minCol = Math.min(startColIndex, endColIndex);
    const maxCol = Math.max(startColIndex, endColIndex);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const columnKey = columns[col]?.key;
        if (columnKey) {
          this.state.selectedCells.add(`${row}:${columnKey}`);
        }
      }
    }
  }

  /**
   * 컬럼 키 가져오기 (인덱스로)
   */
  getColumnKeyByIndex(index: number): string | undefined {
    const columns = this.gridCore.getColumns();
    return columns[index]?.key;
  }

  /**
   * 컬럼 목록 가져오기
   */
  getColumns(): ColumnDef[] {
    return this.gridCore.getColumns();
  }

  /**
   * 셀 선택에서 행 선택 동기화 (all 모드 전용)
   * 선택된 셀이 있는 모든 행을 selectedRows에 추가
   */
  private syncRowsFromCells(): void {
    this.state.selectedRows.clear();
    
    for (const cellKey of this.state.selectedCells) {
      const rowIndex = parseInt(cellKey.split(':')[0], 10);
      const row = this.gridCore.getRowByVisibleIndex(rowIndex);
      if (row && row['id'] !== undefined) {
        this.state.selectedRows.add(row['id'] as string | number);
      }
    }
  }

  /**
   * 선택 변경 이벤트 발생
   */
  private emitSelectionChanged(): void {
    // 'all' 모드에서만 셀→행 자동 동기화
    if (this.state.selectionMode === 'all') {
      this.syncRowsFromCells();
    }
    
    const state = this.getState();
    console.log('[SelectionManager] emitSelectionChanged', {
      selectedCells: [...state.selectedCells],
      selectedRows: [...state.selectedRows],
    });
    this.emit('selectionChanged', state);
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.removeAllListeners();
    this.state.selectedRows.clear();
    this.state.selectedCells.clear();
    this.columnIndexMap.clear();
  }
}
