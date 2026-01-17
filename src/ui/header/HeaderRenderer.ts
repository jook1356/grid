/**
 * HeaderRenderer - 헤더 영역 렌더링
 *
 * 그리드의 헤더 영역을 렌더링하고 상호작용을 관리합니다.
 * - 컬럼 헤더 셀 렌더링
 * - 정렬 처리
 * - 컬럼 리사이즈
 * - 컬럼 재정렬 (Drag & Drop)
 */

import type { GridCore } from '../../core/GridCore';
import type { ColumnDef } from '../../types';
import type { ColumnState, ColumnGroups } from '../types';
import { HeaderCell, SortState } from './HeaderCell';

/**
 * HeaderRenderer 설정
 */
export interface HeaderRendererOptions {
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 컬럼 상태 */
  columns: ColumnState[];
  /** 헤더 높이 */
  headerHeight: number;
  /** 리사이즈 가능 여부 */
  resizable: boolean;
  /** 재정렬 가능 여부 */
  reorderable: boolean;
  /** 정렬 변경 콜백 */
  onSortChange?: (sorts: SortState[]) => void;
  /** 컬럼 너비 변경 콜백 */
  onColumnResize?: (columnKey: string, width: number) => void;
  /** 컬럼 순서 변경 콜백 */
  onColumnReorder?: (order: string[]) => void;
}

/**
 * 헤더 영역 렌더러
 */
export class HeaderRenderer {
  private readonly gridCore: GridCore;
  private readonly container: HTMLElement;
  private readonly headerHeight: number;
  private readonly resizable: boolean;
  private readonly reorderable: boolean;

  // 상태
  private columns: ColumnState[] = [];
  private columnDefs: Map<string, ColumnDef> = new Map();
  private sortStates: SortState[] = [];

  // 헤더 셀 인스턴스
  private headerCells: Map<string, HeaderCell> = new Map();

  // 드롭 인디케이터
  private dropIndicator: HTMLElement | null = null;

  // 콜백
  private onSortChange?: HeaderRendererOptions['onSortChange'];
  private onColumnResize?: HeaderRendererOptions['onColumnResize'];
  private onColumnReorder?: HeaderRendererOptions['onColumnReorder'];

  // 리사이즈 상태
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizeColumnKey = '';

  constructor(container: HTMLElement, options: HeaderRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.columns = options.columns;
    this.headerHeight = options.headerHeight;
    this.resizable = options.resizable;
    this.reorderable = options.reorderable;
    this.onSortChange = options.onSortChange;
    this.onColumnResize = options.onColumnResize;
    this.onColumnReorder = options.onColumnReorder;

    // 컬럼 정의 맵 생성
    for (const col of this.gridCore.getColumns()) {
      this.columnDefs.set(col.key, col);
    }

    // 드롭 인디케이터 생성
    this.dropIndicator = document.createElement('div');
    this.dropIndicator.className = 'ps-drop-indicator';
    this.dropIndicator.style.display = 'none';

    // 초기 렌더링
    this.render();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 컬럼 상태 업데이트 및 다시 렌더링
   */
  updateColumns(columns: ColumnState[]): void {
    this.columns = columns;
    this.render();
  }

  /**
   * 정렬 상태 업데이트
   */
  updateSortState(sortStates: SortState[]): void {
    this.sortStates = sortStates;

    // 모든 헤더 셀의 정렬 상태 업데이트
    for (const [key, cell] of this.headerCells) {
      const sortState = sortStates.find((s) => s.columnKey === key);
      cell.updateSortState(sortState);
    }
  }

  /**
   * 특정 컬럼 너비 업데이트
   */
  updateColumnWidth(columnKey: string, width: number): void {
    const state = this.columns.find((c) => c.key === columnKey);
    if (state) {
      state.width = width;
      this.headerCells.get(columnKey)?.updateWidth(width);
    }
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    for (const cell of this.headerCells.values()) {
      cell.destroy();
    }
    this.headerCells.clear();
    this.container.innerHTML = '';
  }

  // ===========================================================================
  // 렌더링 (Private)
  // ===========================================================================

  /**
   * 헤더 렌더링
   */
  private render(): void {
    // 기존 셀 정리
    for (const cell of this.headerCells.values()) {
      cell.destroy();
    }
    this.headerCells.clear();
    this.container.innerHTML = '';

    // 헤더 행 생성
    const headerRow = document.createElement('div');
    headerRow.className = 'ps-header-row';
    headerRow.style.height = `${this.headerHeight}px`;

    const columnGroups = this.getColumnGroups();

    // Left 영역
    const leftContainer = this.createCellsContainer('ps-cells-left', columnGroups.left);
    headerRow.appendChild(leftContainer);

    // Center 영역
    const centerContainer = this.createCellsContainer('ps-cells-center', columnGroups.center);
    headerRow.appendChild(centerContainer);

    // Right 영역
    const rightContainer = this.createCellsContainer('ps-cells-right', columnGroups.right);
    headerRow.appendChild(rightContainer);

    this.container.appendChild(headerRow);
    this.container.appendChild(this.dropIndicator!);
  }

  /**
   * 셀 컨테이너 생성
   */
  private createCellsContainer(className: string, columns: ColumnState[]): HTMLElement {
    const container = document.createElement('div');
    container.className = className;

    for (const colState of columns) {
      const colDef = this.columnDefs.get(colState.key);
      if (!colDef) continue;

      const sortState = this.sortStates.find((s) => s.columnKey === colState.key);

      const headerCell = new HeaderCell({
        columnState: colState,
        columnDef: colDef,
        sortState,
        resizable: this.resizable,
        reorderable: this.reorderable,
        onSortClick: this.handleSortClick.bind(this),
        onResizeStart: this.handleResizeStart.bind(this),
        onDragStart: this.handleDragStart.bind(this),
        onDragOver: this.handleDragOver.bind(this),
        onDrop: this.handleDrop.bind(this),
      });

      this.headerCells.set(colState.key, headerCell);
      container.appendChild(headerCell.getElement());
    }

    return container;
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * 정렬 클릭 처리
   */
  private handleSortClick(columnKey: string): void {
    const existing = this.sortStates.find((s) => s.columnKey === columnKey);

    let newSortStates: SortState[];

    if (!existing) {
      // 새 정렬 추가
      newSortStates = [{ columnKey, direction: 'asc' }];
    } else if (existing.direction === 'asc') {
      // 오름차순 → 내림차순
      newSortStates = [{ columnKey, direction: 'desc' }];
    } else {
      // 내림차순 → 정렬 해제
      newSortStates = [];
    }

    this.sortStates = newSortStates;
    this.updateSortState(newSortStates);
    this.onSortChange?.(newSortStates);
  }

  /**
   * 리사이즈 시작 처리
   */
  private handleResizeStart(columnKey: string, startX: number): void {
    this.resizing = true;
    this.resizeStartX = startX;
    this.resizeColumnKey = columnKey;

    const state = this.columns.find((c) => c.key === columnKey);
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

      this.updateColumnWidth(this.resizeColumnKey, newWidth);
      this.onColumnResize?.(this.resizeColumnKey, newWidth);
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

  // 드래그 상태
  private draggedColumnKey: string | null = null;

  /**
   * 드래그 시작 처리
   */
  private handleDragStart(columnKey: string, _event: DragEvent): void {
    this.draggedColumnKey = columnKey;
  }

  /**
   * 드래그 오버 처리
   */
  private handleDragOver(columnKey: string, event: DragEvent): void {
    if (!this.draggedColumnKey || this.draggedColumnKey === columnKey) {
      this.hideDropIndicator();
      return;
    }

    const cell = this.headerCells.get(columnKey)?.getElement();
    if (!cell) return;

    const rect = cell.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const isLeft = event.clientX < midX;

    // 드롭 인디케이터 표시
    this.showDropIndicator(isLeft ? rect.left : rect.right);
  }

  /**
   * 드롭 처리
   */
  private handleDrop(targetColumnKey: string, event: DragEvent): void {
    if (!this.draggedColumnKey || this.draggedColumnKey === targetColumnKey) {
      this.hideDropIndicator();
      this.draggedColumnKey = null;
      return;
    }

    const cell = this.headerCells.get(targetColumnKey)?.getElement();
    if (!cell) return;

    const rect = cell.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const insertBefore = event.clientX < midX;

    // 새 순서 계산
    const newOrder = this.calculateNewOrder(this.draggedColumnKey, targetColumnKey, insertBefore);

    this.hideDropIndicator();
    this.draggedColumnKey = null;

    this.onColumnReorder?.(newOrder);
  }

  /**
   * 새 컬럼 순서 계산
   */
  private calculateNewOrder(draggedKey: string, targetKey: string, insertBefore: boolean): string[] {
    const visibleColumns = this.columns
      .filter((c) => c.visible)
      .sort((a, b) => a.order - b.order);

    const order = visibleColumns.map((c) => c.key);
    const draggedIndex = order.indexOf(draggedKey);
    let targetIndex = order.indexOf(targetKey);

    // 드래그된 항목 제거
    order.splice(draggedIndex, 1);

    // 대상 인덱스 조정 (제거 후)
    if (draggedIndex < targetIndex) {
      targetIndex--;
    }

    // 새 위치에 삽입
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    order.splice(insertIndex, 0, draggedKey);

    return order;
  }

  /**
   * 드롭 인디케이터 표시
   */
  private showDropIndicator(x: number): void {
    if (!this.dropIndicator) return;

    const containerRect = this.container.getBoundingClientRect();
    this.dropIndicator.style.display = 'block';
    this.dropIndicator.style.left = `${x - containerRect.left}px`;
  }

  /**
   * 드롭 인디케이터 숨기기
   */
  private hideDropIndicator(): void {
    if (!this.dropIndicator) return;
    this.dropIndicator.style.display = 'none';
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 그룹 분류
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

    const sortByOrder = (a: ColumnState, b: ColumnState) => a.order - b.order;
    left.sort(sortByOrder);
    center.sort(sortByOrder);
    right.sort(sortByOrder);

    return { left, center, right };
  }
}
