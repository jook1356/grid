/**
 * SelectionManager - 행/셀 선택 관리
 *
 * 행 및 셀 선택 상태를 관리하고 키보드/마우스 상호작용을 처리합니다.
 * - 단일/다중 선택
 * - Shift 범위 선택
 * - Ctrl/Cmd 토글 선택
 * - 키보드 네비게이션
 */

import { EventEmitter } from '../../core/EventEmitter';
import type { GridCore } from '../../core/GridCore';
import type { Row } from '../../types';
import type { CellPosition, SelectionMode, SelectionState } from '../types';

/**
 * SelectionManager 이벤트 타입
 */
interface SelectionManagerEvents {
  /** 선택 상태 변경 */
  selectionChanged: SelectionState;
  /** 포커스 셀 변경 */
  focusChanged: CellPosition | null;
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

  constructor(options: SelectionManagerOptions) {
    super();

    this.gridCore = options.gridCore;
    this.multiSelect = options.multiSelect;

    this.state = {
      selectedRows: new Set(),
      selectedCells: new Map(),
      focusedCell: null,
      selectionMode: options.selectionMode,
      anchorCell: null,
    };
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 현재 선택 상태 가져오기
   */
  getState(): SelectionState {
    return {
      ...this.state,
      selectedRows: new Set(this.state.selectedRows),
      selectedCells: new Map(this.state.selectedCells),
    };
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
   * 포커스된 셀 가져오기
   */
  getFocusedCell(): CellPosition | null {
    return this.state.focusedCell;
  }

  /**
   * 선택 모드 변경
   */
  setSelectionMode(mode: SelectionMode): void {
    this.state.selectionMode = mode;
    this.clearSelection();
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
      const row = this.gridCore.getRowByViewIndex(i);
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

    this.state.selectedRows.clear();

    const totalRows = this.gridCore.getVisibleRowCount();
    for (let i = 0; i < totalRows; i++) {
      const row = this.gridCore.getRowByViewIndex(i);
      if (row && row['id'] !== undefined) {
        this.state.selectedRows.add(row['id'] as string | number);
      }
    }

    this.emitSelectionChanged();
  }

  /**
   * 선택 해제
   */
  clearSelection(): void {
    this.state.selectedRows.clear();
    this.state.selectedCells.clear();
    this.state.focusedCell = null;
    this.state.anchorCell = null;

    this.emitSelectionChanged();
  }

  // ===========================================================================
  // 셀 선택
  // ===========================================================================

  /**
   * 셀 클릭 처리
   */
  handleCellClick(position: CellPosition, event: MouseEvent): void {
    if (this.state.selectionMode === 'none' || this.state.selectionMode === 'row') {
      return;
    }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (this.state.selectionMode === 'cell') {
      // 단일 셀 선택 모드
      this.focusCell(position);
    } else if (this.state.selectionMode === 'range') {
      // 범위 선택 모드
      if (isShift && this.state.anchorCell) {
        this.selectCellRange(this.state.anchorCell, position);
      } else if (isCtrlOrCmd && this.multiSelect) {
        this.toggleCellSelection(position);
      } else {
        this.selectSingleCell(position);
      }
    }
  }

  /**
   * 셀 포커스
   */
  focusCell(position: CellPosition): void {
    this.state.focusedCell = position;
    this.state.anchorCell = position;
    this.emit('focusChanged', position);
    this.emitSelectionChanged();
  }

  /**
   * 단일 셀 선택
   */
  selectSingleCell(position: CellPosition): void {
    this.state.selectedCells.clear();
    const key = this.getCellKey(position);
    this.state.selectedCells.set(key, position);
    this.state.focusedCell = position;
    this.state.anchorCell = position;

    this.emitSelectionChanged();
  }

  /**
   * 셀 선택 토글
   */
  toggleCellSelection(position: CellPosition): void {
    const key = this.getCellKey(position);

    if (this.state.selectedCells.has(key)) {
      this.state.selectedCells.delete(key);
    } else {
      this.state.selectedCells.set(key, position);
    }

    this.state.focusedCell = position;
    this.emitSelectionChanged();
  }

  /**
   * 셀 범위 선택
   */
  selectCellRange(start: CellPosition, end: CellPosition): void {
    // 간단한 구현: 행 범위만 처리 (컬럼 순서 파악 필요)
    const minRow = Math.min(start.rowIndex, end.rowIndex);
    const maxRow = Math.max(start.rowIndex, end.rowIndex);

    this.state.selectedCells.clear();

    for (let row = minRow; row <= maxRow; row++) {
      // 시작과 끝 컬럼 사이의 모든 셀 선택
      // 실제 구현에서는 컬럼 순서를 고려해야 함
      const position: CellPosition = { rowIndex: row, columnKey: end.columnKey };
      const key = this.getCellKey(position);
      this.state.selectedCells.set(key, position);
    }

    this.state.focusedCell = end;
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
   * 포커스 이동
   */
  private moveFocus(rowDelta: number, _colDelta: number, _extendSelection: boolean): void {
    if (!this.state.focusedCell) {
      // 첫 셀로 포커스
      this.focusCell({ rowIndex: 0, columnKey: '' });
      return;
    }

    const newRowIndex = Math.max(
      0,
      Math.min(
        this.state.focusedCell.rowIndex + rowDelta,
        this.gridCore.getVisibleRowCount() - 1
      )
    );

    const newPosition: CellPosition = {
      rowIndex: newRowIndex,
      columnKey: this.state.focusedCell.columnKey,
    };

    this.focusCell(newPosition);

    // 행 모드에서는 행도 선택
    if (this.state.selectionMode === 'row') {
      const row = this.gridCore.getRowByViewIndex(newRowIndex);
      if (row && row['id'] !== undefined) {
        this.selectSingleRow(row['id'] as string | number, newRowIndex);
      }
    }
  }

  /**
   * 첫 번째 행으로 포커스
   */
  private focusFirstRow(): void {
    this.focusCell({ rowIndex: 0, columnKey: this.state.focusedCell?.columnKey ?? '' });
  }

  /**
   * 마지막 행으로 포커스
   */
  private focusLastRow(): void {
    const lastIndex = this.gridCore.getVisibleRowCount() - 1;
    this.focusCell({
      rowIndex: Math.max(0, lastIndex),
      columnKey: this.state.focusedCell?.columnKey ?? '',
    });
  }

  /**
   * 첫 번째 셀로 포커스
   */
  private focusFirstCell(): void {
    const columns = this.gridCore.getColumns();
    const firstColumn = columns[0];
    if (firstColumn) {
      this.focusCell({
        rowIndex: this.state.focusedCell?.rowIndex ?? 0,
        columnKey: firstColumn.key,
      });
    }
  }

  /**
   * 마지막 셀로 포커스
   */
  private focusLastCell(): void {
    const columns = this.gridCore.getColumns();
    const lastColumn = columns[columns.length - 1];
    if (lastColumn) {
      this.focusCell({
        rowIndex: this.state.focusedCell?.rowIndex ?? 0,
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
   * 선택 변경 이벤트 발생
   */
  private emitSelectionChanged(): void {
    this.emit('selectionChanged', this.getState());
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.removeAllListeners();
    this.state.selectedRows.clear();
    this.state.selectedCells.clear();
  }
}
