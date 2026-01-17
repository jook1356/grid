/**
 * HeaderCell - 헤더 셀 컴포넌트
 *
 * 단일 헤더 셀을 렌더링하고 상호작용을 처리합니다.
 * - 정렬 인디케이터
 * - 리사이즈 핸들
 * - 드래그 앤 드롭
 */

import type { ColumnDef } from '../../types';
import type { ColumnState, SortState } from '../types';

/**
 * 정렬 상태 타입 (UI 전용)
 */
export interface SortState {
  /** 컬럼 키 */
  columnKey: string;
  /** 정렬 방향 */
  direction: 'asc' | 'desc';
}

/**
 * HeaderCell 설정
 */
export interface HeaderCellOptions {
  /** 컬럼 상태 */
  columnState: ColumnState;
  /** 컬럼 정의 */
  columnDef: ColumnDef;
  /** 현재 정렬 상태 */
  sortState?: SortState;
  /** 리사이즈 가능 여부 */
  resizable: boolean;
  /** 재정렬 가능 여부 */
  reorderable: boolean;
  /** 정렬 클릭 콜백 */
  onSortClick?: (columnKey: string) => void;
  /** 리사이즈 시작 콜백 */
  onResizeStart?: (columnKey: string, startX: number) => void;
  /** 드래그 시작 콜백 */
  onDragStart?: (columnKey: string, event: DragEvent) => void;
  /** 드래그 오버 콜백 */
  onDragOver?: (columnKey: string, event: DragEvent) => void;
  /** 드롭 콜백 */
  onDrop?: (columnKey: string, event: DragEvent) => void;
}

/**
 * 헤더 셀 클래스
 */
export class HeaderCell {
  private readonly options: HeaderCellOptions;
  private element: HTMLElement;

  constructor(options: HeaderCellOptions) {
    this.options = options;
    this.element = this.createElement();
  }

  /**
   * DOM 요소 가져오기
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 정렬 상태 업데이트
   */
  updateSortState(sortState?: SortState): void {
    const { columnState } = this.options;

    // 정렬 클래스 제거
    this.element.classList.remove('ps-sorted', 'ps-sort-asc', 'ps-sort-desc');

    // 정렬 아이콘 업데이트
    const sortIcon = this.element.querySelector('.ps-sort-icon');
    if (sortIcon) {
      if (sortState?.columnKey === columnState.key) {
        this.element.classList.add('ps-sorted');
        this.element.classList.add(sortState.direction === 'asc' ? 'ps-sort-asc' : 'ps-sort-desc');
        sortIcon.textContent = sortState.direction === 'asc' ? '▲' : '▼';
      } else {
        sortIcon.textContent = '';
      }
    }
  }

  /**
   * 너비 업데이트
   */
  updateWidth(width: number): void {
    this.element.style.width = `var(--col-${this.options.columnState.key}-width, ${width}px)`;
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.element.remove();
  }

  /**
   * DOM 요소 생성
   */
  private createElement(): HTMLElement {
    const { columnState, columnDef, sortState, resizable, reorderable } = this.options;

    const cell = document.createElement('div');
    cell.className = 'ps-header-cell';
    cell.style.width = `var(--col-${columnState.key}-width, ${columnState.width}px)`;
    cell.dataset['columnKey'] = columnState.key;

    // 드래그 앤 드롭 설정
    if (reorderable) {
      cell.draggable = true;
      cell.addEventListener('dragstart', this.handleDragStart.bind(this));
      cell.addEventListener('dragover', this.handleDragOver.bind(this));
      cell.addEventListener('drop', this.handleDrop.bind(this));
      cell.addEventListener('dragend', this.handleDragEnd.bind(this));
    }

    // 헤더 텍스트 컨테이너
    const textContainer = document.createElement('div');
    textContainer.className = 'ps-header-text';
    textContainer.textContent = columnDef.header ?? columnState.key;

    // 정렬 아이콘
    const sortIcon = document.createElement('span');
    sortIcon.className = 'ps-sort-icon';
    if (sortState?.columnKey === columnState.key) {
      cell.classList.add('ps-sorted');
      cell.classList.add(sortState.direction === 'asc' ? 'ps-sort-asc' : 'ps-sort-desc');
      sortIcon.textContent = sortState.direction === 'asc' ? '▲' : '▼';
    }
    textContainer.appendChild(sortIcon);

    cell.appendChild(textContainer);

    // 클릭 이벤트 (정렬)
    if (columnDef.sortable !== false) {
      textContainer.style.cursor = 'pointer';
      textContainer.addEventListener('click', this.handleSortClick.bind(this));
    }

    // 리사이즈 핸들
    if (resizable) {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'ps-resize-handle';
      resizeHandle.addEventListener('mousedown', this.handleResizeStart.bind(this));
      cell.appendChild(resizeHandle);
    }

    return cell;
  }

  /**
   * 정렬 클릭 처리
   */
  private handleSortClick(e: MouseEvent): void {
    e.stopPropagation();
    this.options.onSortClick?.(this.options.columnState.key);
  }

  /**
   * 리사이즈 시작 처리
   */
  private handleResizeStart(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.options.onResizeStart?.(this.options.columnState.key, e.clientX);
  }

  /**
   * 드래그 시작 처리
   */
  private handleDragStart(e: DragEvent): void {
    this.element.classList.add('ps-dragging');
    e.dataTransfer?.setData('text/plain', this.options.columnState.key);
    e.dataTransfer!.effectAllowed = 'move';
    this.options.onDragStart?.(this.options.columnState.key, e);
  }

  /**
   * 드래그 오버 처리
   */
  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    this.options.onDragOver?.(this.options.columnState.key, e);
  }

  /**
   * 드롭 처리
   */
  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    this.options.onDrop?.(this.options.columnState.key, e);
  }

  /**
   * 드래그 종료 처리
   */
  private handleDragEnd(): void {
    this.element.classList.remove('ps-dragging');
  }
}
