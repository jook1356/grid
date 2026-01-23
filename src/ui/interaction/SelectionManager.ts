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
 * 선택된 셀은 Set<string>에 "dataIndex:columnKey" 형태로 저장됩니다.
 * dataIndex는 실제 데이터의 인덱스이며, 그룹화 시에도 정확한 데이터를 참조합니다.
 * Set.has()를 사용하여 O(1) 조회 성능을 보장합니다.
 */

import { SimpleEventEmitter } from '../../core/SimpleEventEmitter';
import type { GridCore } from '../../core/GridCore';
import type { ColumnDef, Row } from '../../types';
import type { VirtualRow } from '../../types/grouping.types';
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
export class SelectionManager extends SimpleEventEmitter<SelectionManagerEvents> {
  private readonly gridCore: GridCore;
  private readonly multiSelect: boolean;

  // 선택 상태
  private state: SelectionState;

  // 컬럼 순서 캐시 (컬럼 인덱스 조회용)
  private columnIndexMap: Map<string, number> = new Map();
  // 인덱스 → 컬럼 키 역방향 맵 (범위 선택용)
  private columnKeysByIndex: string[] = [];

  // 드래그 세션 상태
  private dragAddToExisting = false;  // Ctrl 누른 상태로 드래그 시작했는지
  private preDragSelection: Set<string> = new Set();  // 드래그 시작 전 셀 선택 상태
  private preDragRowSelection: Set<string | number> = new Set();  // 드래그 시작 전 행 선택 상태

  // 가상 행 (그룹화된 경우 그룹 헤더 포함) - viewIndex 기반 범위 선택용
  private virtualRows: VirtualRow[] = [];

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
   *
   * @param dataIndex - 실제 데이터 인덱스 (그룹 헤더 제외)
   * @param columnKey - 컬럼 키
   */
  isCellSelected(dataIndex: number, columnKey: string): boolean {
    return this.state.selectedCells.has(`${dataIndex}:${columnKey}`);
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
   * 셀 선택이 가능한 모드인지 확인 (range, all)
   */
  private isCellSelectionMode(): boolean {
    return this.state.selectionMode === 'range' || this.state.selectionMode === 'all';
  }

  /**
   * 선택 모드 변경
   */
  setSelectionMode(mode: SelectionMode): void {
    this.state.selectionMode = mode;
    this.clearSelection();
  }

  /**
   * 가상 행 설정 (그룹화 시 viewIndex → dataIndex 변환용)
   *
   * 그룹화가 적용되면 viewIndex와 dataIndex가 다르며, 그룹 헤더도 포함됩니다.
   * 드래그 선택 시 viewIndex 범위를 순회하며 데이터 행만 선택합니다.
   */
  setVirtualRows(virtualRows: VirtualRow[]): void {
    this.virtualRows = virtualRows;
  }

  /**
   * 컬럼 인덱스 맵 업데이트 (컬럼 순서 변경 시 호출)
   * @param columnKeys - 현재 UI에 표시된 컬럼 순서 (생략 시 gridCore에서 가져옴)
   */
  updateColumnIndexMap(columnKeys?: string[]): void {
    this.columnIndexMap.clear();
    this.columnKeysByIndex = [];
    
    if (columnKeys) {
      // UI에서 전달된 순서 사용
      this.columnKeysByIndex = [...columnKeys];
      columnKeys.forEach((key, index) => {
        this.columnIndexMap.set(key, index);
      });
    } else {
      // 초기화 시 gridCore에서 가져옴
      const columns = this.gridCore.getColumns();
      columns.forEach((col, index) => {
        this.columnIndexMap.set(col.key, index);
        this.columnKeysByIndex.push(col.key);
      });
    }
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
   *
   * viewIndex 범위를 사용하여 데이터 행만 선택합니다.
   * 그룹화 시 그룹 헤더는 건너뜁니다.
   */
  selectRowRange(startIndex: number, endIndex: number): void {
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    this.state.selectedRows.clear();

    // virtualRows가 있으면 viewIndex 기준으로 데이터 행만 선택 (ChangeTracker 데이터 포함)
    if (this.virtualRows.length > 0) {
      for (let viewIdx = minIndex; viewIdx <= maxIndex; viewIdx++) {
        const virtualRow = this.virtualRows[viewIdx];
        if (virtualRow && virtualRow.type === 'data') {
          const rowId = this.getRowId(virtualRow.data);
          if (rowId !== undefined) {
            this.state.selectedRows.add(rowId);
          }
        }
      }
    } else {
      // virtualRows가 없으면 기존 방식 (그룹화 비활성)
      for (let i = minIndex; i <= maxIndex; i++) {
        const row = this.gridCore.getRowByVisibleIndex(i);
        const rowId = this.getRowId(row);
        if (rowId !== undefined) {
          this.state.selectedRows.add(rowId);
        }
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
   *
   * 그룹화 시 그룹 헤더를 제외한 데이터 행만 선택합니다.
   */
  selectAll(): void {
    if (!this.multiSelect) return;

    if (this.isCellSelectionMode()) {
      // 셀 모드: 모든 셀 선택 (all 모드에서는 행도 자동 동기화됨)
      this.selectAllCells();
    } else if (this.state.selectionMode === 'row') {
      // 행 모드: 모든 행 선택
      this.state.selectedRows.clear();

      if (this.virtualRows.length > 0) {
        // 그룹화 활성: virtualRows에서 데이터 행만 선택 (ChangeTracker 데이터 포함)
        for (const virtualRow of this.virtualRows) {
          if (virtualRow.type === 'data') {
            const rowId = this.getRowId(virtualRow.data);
            if (rowId !== undefined) {
              this.state.selectedRows.add(rowId);
            }
          }
        }
      } else {
        // 그룹화 비활성: 기존 방식
        const totalRows = this.gridCore.getVisibleRowCount();
        for (let i = 0; i < totalRows; i++) {
          const row = this.gridCore.getRowByVisibleIndex(i);
          const rowId = this.getRowId(row);
          if (rowId !== undefined) {
            this.state.selectedRows.add(rowId);
          }
        }
      }
    }

    this.emitSelectionChanged();
  }

  /**
   * 모든 셀 선택
   *
   * dataIndex 기반으로 모든 데이터 셀을 선택합니다.
   * 그룹 헤더는 선택 대상에서 제외됩니다.
   */
  selectAllCells(): void {
    if (!this.multiSelect) return;

    const columns = this.gridCore.getColumns();
    this.state.selectedCells.clear();

    if (this.virtualRows.length > 0) {
      // 그룹화 활성: virtualRows에서 데이터 행만 선택
      for (const virtualRow of this.virtualRows) {
        if (virtualRow.type === 'data') {
          for (const col of columns) {
            this.state.selectedCells.add(`${virtualRow.dataIndex}:${col.key}`);
          }
        }
      }
    } else {
      // 그룹화 비활성: 기존 방식
      const totalRows = this.gridCore.getVisibleRowCount();
      for (let dataIndex = 0; dataIndex < totalRows; dataIndex++) {
        for (const col of columns) {
          this.state.selectedCells.add(`${dataIndex}:${col.key}`);
        }
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
    // 셀 선택 모드에서만 처리
    if (!this.isCellSelectionMode()) return;

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
    this.state.selectedCells.clear();
    const key = this.getCellKey(position);
    this.state.selectedCells.add(key);
    this.state.anchorCell = position;  // Shift+클릭 기준점

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
   * viewIndex 범위를 사용하여 데이터 행만 선택합니다.
   * 그룹화 시 그룹 헤더는 건너뜁니다.
   *
   * @param start - 시작 셀 (앵커)
   * @param end - 끝 셀
   * @param addToExisting - 기존 선택에 추가할지 여부 (Ctrl+Shift)
   */
  selectCellRange(start: CellPosition, end: CellPosition, addToExisting = false): void {
    if (!addToExisting) {
      this.state.selectedCells.clear();
    }

    // virtualRows가 있으면 viewIndex 기반으로 선택 (드래그와 동일)
    if (this.virtualRows.length > 0) {
      this.addCellsInRangeByViewIndex(start, end);
    } else {
      // virtualRows가 없으면 기존 방식 (그룹화 비활성)
      this.addCellsInRange(start, end);
    }
    this.emitSelectionChanged();
  }

  // ===========================================================================
  // 드래그 선택
  // ===========================================================================

  /**
   * 드래그 선택 시작
   *
   * dataIndex를 기준으로 드래그 선택을 시작합니다.
   * 그룹 헤더에서는 드래그 선택이 시작되지 않습니다.
   */
  startDragSelection(position: CellPosition, event: MouseEvent): void {
    // 'none' 모드에서는 드래그 선택 불가
    if (this.state.selectionMode === 'none') return;

    // 그룹 헤더에서는 드래그 선택 안함 (dataIndex가 없음)
    if (position.dataIndex === undefined) return;

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    // Ctrl 상태 저장 (드래그 세션 동안 유지)
    this.dragAddToExisting = isCtrlOrCmd;

    this.state.isDragging = true;
    this.state.anchorCell = position;  // 드래그 시작점 = 앵커 (dataIndex 포함)

    if (this.state.selectionMode === 'row') {
      // row 모드: 행 선택
      if (isCtrlOrCmd) {
        this.preDragRowSelection = new Set(this.state.selectedRows);
      } else {
        this.preDragRowSelection.clear();
        this.state.selectedRows.clear();
      }
      // 시작 행 선택 (virtualRows 사용 - ChangeTracker 데이터 포함)
      const virtualRow = this.virtualRows[position.rowIndex];
      if (virtualRow?.type === 'data') {
        const rowId = this.getRowId(virtualRow.data);
        if (rowId !== undefined) {
          this.state.selectedRows.add(rowId);
        }
      }
    } else {
      // range/all 모드: 셀 선택
      if (isCtrlOrCmd) {
        this.preDragSelection = new Set(this.state.selectedCells);
      } else {
        this.preDragSelection.clear();
        this.state.selectedCells.clear();
      }
      // 시작 셀 선택 (dataIndex 기반 키)
      this.state.selectedCells.add(this.getCellKey(position));
    }

    this.emitSelectionChanged();
  }

  /**
   * 드래그 선택 업데이트 (마우스 이동 중)
   *
   * viewIndex 범위를 사용하여 데이터 행만 선택합니다.
   * 그룹 헤더 위에서는 업데이트하지 않습니다.
   */
  updateDragSelection(position: CellPosition): void {
    if (!this.state.isDragging || !this.state.anchorCell) return;

    // 그룹 헤더 위에서는 업데이트하지 않음 (dataIndex가 없음)
    if (position.dataIndex === undefined) return;

    if (this.state.selectionMode === 'row') {
      // row 모드: 행 범위 선택 (viewIndex 기준으로 순회, 데이터 행만 선택)
      if (this.dragAddToExisting) {
        this.state.selectedRows = new Set(this.preDragRowSelection);
      } else {
        this.state.selectedRows.clear();
      }

      // viewIndex 범위로 순회 (그룹 헤더 포함한 화면상 범위)
      const anchorViewIndex = this.state.anchorCell.rowIndex;
      const currentViewIndex = position.rowIndex;
      const startViewIndex = Math.min(anchorViewIndex, currentViewIndex);
      const endViewIndex = Math.max(anchorViewIndex, currentViewIndex);

      // viewIndex 범위 내의 데이터 행만 선택 (virtualRows 사용 - ChangeTracker 데이터 포함)
      for (let viewIdx = startViewIndex; viewIdx <= endViewIndex; viewIdx++) {
        const virtualRow = this.virtualRows[viewIdx];
        if (virtualRow && virtualRow.type === 'data') {
          const rowId = this.getRowId(virtualRow.data);
          if (rowId !== undefined) {
            this.state.selectedRows.add(rowId);
          }
        }
      }
    } else {
      // range/all 모드: 셀 범위 선택 (viewIndex 기준으로 순회)
      if (this.dragAddToExisting) {
        this.state.selectedCells = new Set(this.preDragSelection);
      } else {
        this.state.selectedCells.clear();
      }
      // viewIndex 범위 내의 데이터 행만 선택
      this.addCellsInRangeByViewIndex(this.state.anchorCell, position);
    }

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
    this.preDragRowSelection.clear();
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
    this.state.selectedRows = new Set(this.preDragRowSelection);
    this.preDragSelection.clear();
    this.preDragRowSelection.clear();

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
   *
   * dataIndex를 기준으로 이동합니다.
   */
  private moveFocus(rowDelta: number, colDelta: number, extendSelection: boolean): void {
    if (!this.state.anchorCell) {
      // 첫 셀 선택
      const firstColKey = this.columnKeysByIndex[0];
      if (firstColKey) {
        this.selectSingleCell({ rowIndex: 0, columnKey: firstColKey, dataIndex: 0 });
      }
      return;
    }

    // dataIndex 기준으로 이동
    const currentDataIndex = this.state.anchorCell.dataIndex !== undefined
      ? this.state.anchorCell.dataIndex
      : this.state.anchorCell.rowIndex;

    const currentColIndex = this.getColumnIndex(this.state.anchorCell.columnKey);
    const newDataIndex = Math.max(
      0,
      Math.min(
        currentDataIndex + rowDelta,
        this.gridCore.getVisibleRowCount() - 1
      )
    );
    const newColIndex = Math.max(
      0,
      Math.min(currentColIndex + colDelta, this.columnKeysByIndex.length - 1)
    );

    const newColumnKey = this.columnKeysByIndex[newColIndex];
    if (!newColumnKey) return;

    const newPosition: CellPosition = {
      rowIndex: newDataIndex,
      columnKey: newColumnKey,
      dataIndex: newDataIndex,
    };

    if (extendSelection && this.isCellSelectionMode()) {
      // Shift + 화살표: 선택 확장 (anchorCell 유지)
      const anchor = this.state.anchorCell;
      this.selectCellRange(anchor, newPosition);
    } else {
      // 일반 이동: 단일 셀 선택
      this.selectSingleCell(newPosition);
    }

    // 행 모드에서는 행도 선택 (virtualRows 사용 - ChangeTracker 데이터 포함)
    if (this.state.selectionMode === 'row') {
      const virtualRow = this.virtualRows[newPosition.rowIndex];
      if (virtualRow?.type === 'data') {
        const rowId = this.getRowId(virtualRow.data);
        if (rowId !== undefined) {
          this.selectSingleRow(rowId, newDataIndex);
        }
      }
    }
  }

  /**
   * 첫 번째 행으로 이동
   */
  private focusFirstRow(): void {
    const columnKey = this.state.anchorCell?.columnKey;
    if (columnKey) {
      this.selectSingleCell({ rowIndex: 0, columnKey, dataIndex: 0 });
    }
  }

  /**
   * 마지막 행으로 이동
   */
  private focusLastRow(): void {
    const lastIndex = this.gridCore.getVisibleRowCount() - 1;
    const columnKey = this.state.anchorCell?.columnKey;
    if (columnKey) {
      const dataIndex = Math.max(0, lastIndex);
      this.selectSingleCell({ rowIndex: dataIndex, columnKey, dataIndex });
    }
  }

  /**
   * 첫 번째 열로 이동
   */
  private focusFirstCell(): void {
    const firstColumnKey = this.columnKeysByIndex[0];
    if (firstColumnKey) {
      const dataIndex = this.state.anchorCell?.dataIndex ?? this.state.anchorCell?.rowIndex ?? 0;
      this.selectSingleCell({ rowIndex: dataIndex, columnKey: firstColumnKey, dataIndex });
    }
  }

  /**
   * 마지막 열로 이동
   */
  private focusLastCell(): void {
    const lastColumnKey = this.columnKeysByIndex[this.columnKeysByIndex.length - 1];
    if (lastColumnKey) {
      const dataIndex = this.state.anchorCell?.dataIndex ?? this.state.anchorCell?.rowIndex ?? 0;
      this.selectSingleCell({ rowIndex: dataIndex, columnKey: lastColumnKey, dataIndex });
    }
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 셀 키 생성
   *
   * dataIndex가 있으면 dataIndex를 사용하고, 없으면 rowIndex를 fallback으로 사용합니다.
   */
  private getCellKey(position: CellPosition): string {
    const index = position.dataIndex !== undefined ? position.dataIndex : position.rowIndex;
    return `${index}:${position.columnKey}`;
  }

  /**
   * 행에서 ID 추출
   *
   * 타입 안전하게 row['id']를 추출합니다.
   */
  private getRowId(row: Row | undefined): string | number | undefined {
    if (!row) return undefined;
    const id = row['id'];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return undefined;
  }

  /**
   * 컬럼 인덱스 가져오기
   */
  private getColumnIndex(columnKey: string): number {
    return this.columnIndexMap.get(columnKey) ?? 0;
  }

  /**
   * 범위 내 모든 셀을 selectedCells에 추가
   *
   * dataIndex를 기준으로 범위를 계산합니다.
   * (Shift+클릭 등 비드래그 선택 시 사용)
   */
  private addCellsInRange(start: CellPosition, end: CellPosition): void {
    const startColIndex = this.getColumnIndex(start.columnKey);
    const endColIndex = this.getColumnIndex(end.columnKey);

    // dataIndex 우선 사용
    const startDataIndex = start.dataIndex !== undefined ? start.dataIndex : start.rowIndex;
    const endDataIndex = end.dataIndex !== undefined ? end.dataIndex : end.rowIndex;

    const minRow = Math.min(startDataIndex, endDataIndex);
    const maxRow = Math.max(startDataIndex, endDataIndex);
    const minCol = Math.min(startColIndex, endColIndex);
    const maxCol = Math.max(startColIndex, endColIndex);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const columnKey = this.columnKeysByIndex[col];
        if (columnKey) {
          this.state.selectedCells.add(`${row}:${columnKey}`);
        }
      }
    }
  }

  /**
   * viewIndex 범위 내의 데이터 행만 selectedCells에 추가
   *
   * 그룹화 시 viewIndex 범위를 순회하며 데이터 행의 dataIndex만 사용합니다.
   * 그룹 헤더는 건너뜁니다.
   */
  private addCellsInRangeByViewIndex(start: CellPosition, end: CellPosition): void {
    const startColIndex = this.getColumnIndex(start.columnKey);
    const endColIndex = this.getColumnIndex(end.columnKey);

    // viewIndex 범위 계산
    const startViewIndex = start.rowIndex;
    const endViewIndex = end.rowIndex;
    const minViewIndex = Math.min(startViewIndex, endViewIndex);
    const maxViewIndex = Math.max(startViewIndex, endViewIndex);

    const minCol = Math.min(startColIndex, endColIndex);
    const maxCol = Math.max(startColIndex, endColIndex);

    // viewIndex 범위 내의 데이터 행만 처리
    for (let viewIdx = minViewIndex; viewIdx <= maxViewIndex; viewIdx++) {
      const virtualRow = this.virtualRows[viewIdx];
      // 데이터 행만 선택 (그룹 헤더 건너뜀)
      if (virtualRow && virtualRow.type === 'data') {
        const dataIndex = virtualRow.dataIndex;
        for (let col = minCol; col <= maxCol; col++) {
          const columnKey = this.columnKeysByIndex[col];
          if (columnKey) {
            this.state.selectedCells.add(`${dataIndex}:${columnKey}`);
          }
        }
      }
    }
  }

  /**
   * 컬럼 키 가져오기 (현재 UI 순서의 인덱스로)
   */
  getColumnKeyByIndex(index: number): string | undefined {
    return this.columnKeysByIndex[index];
  }

  /**
   * 컬럼 목록 가져오기
   */
  getColumns(): readonly ColumnDef[] {
    return this.gridCore.getColumns();
  }

  /**
   * 셀 선택에서 행 선택 동기화 (all 모드 전용)
   * 선택된 셀이 있는 모든 행을 selectedRows에 추가
   *
   * 셀 키는 "dataIndex:columnKey" 형식이므로 dataIndex를 기준으로 조회합니다.
   */
  private syncRowsFromCells(): void {
    this.state.selectedRows.clear();

    for (const cellKey of this.state.selectedCells) {
      const dataIndexStr = cellKey.split(':')[0] ?? '0';
      const dataIndex = parseInt(dataIndexStr, 10);

      // virtualRows에서 dataIndex로 찾기 (ChangeTracker 데이터 포함)
      const virtualRow = this.virtualRows.find(
        (vr) => vr.type === 'data' && vr.dataIndex === dataIndex
      );
      if (virtualRow?.type === 'data') {
        const rowId = this.getRowId(virtualRow.data);
        if (rowId !== undefined) {
          this.state.selectedRows.add(rowId);
        }
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
    
    this.emit('selectionChanged', this.getState());
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.removeAllListeners();
    this.state.selectedRows.clear();
    this.state.selectedCells.clear();
    this.columnIndexMap.clear();
    this.columnKeysByIndex = [];
  }
}
