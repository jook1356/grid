/**
 * HeaderCell - 헤더 셀 컴포넌트
 *
 * 단일 헤더 셀을 렌더링하고 상호작용을 처리합니다.
 * - 정렬 인디케이터
 * - 리사이즈 핸들
 * - 드래그 앤 드롭
 * - Multi-Row 레이아웃 (CSS Grid 배치)
 */

import type { ColumnDef } from '../../types';
import type { ColumnState, SortState } from '../types';
import { toCSSValue, DEFAULT_COLUMN_WIDTH } from '../utils/cssUtils';

// SortState는 ../types에서 re-export

/**
 * Multi-Row 셀 배치 정보
 */
export interface CellPlacement {
  /** 그리드 행 위치 (1-based) */
  gridRow: number;
  /** 그리드 컬럼 위치 (1-based) */
  gridColumn: number;
  /** 행 스팬 */
  rowSpan: number;
  /** 컬럼 스팬 */
  colSpan: number;
  /** 총 그리드 컬럼 수 */
  gridColumnCount: number;
  /** 총 그리드 행 수 */
  gridRowCount: number;
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
  /** Multi-Row 배치 정보 (없으면 일반 모드) */
  placement?: CellPlacement;
  /** 리사이즈 시 사용할 컬럼 키 (Multi-Row에서 다를 수 있음) */
  resizeColumnKey?: string;
  /** 정렬 클릭 콜백 */
  onSortClick?: (columnKey: string) => void;
  /** 리사이즈 시작 콜백 */
  onResizeStart?: (columnKey: string, startX: number) => void;
  /** 드래그 시작 콜백 */
  onDragStart?: (columnKey: string, event: DragEvent) => void;
  /** 드래그 오버 콜백 */
  onDragOver?: (columnKey: string, event: DragEvent) => void;
  /** 드롭 콜백 */
  /** 드롭 콜백 */
  onDrop?: (columnKey: string, event: DragEvent) => void;
  /** 리사이즈 콜백 (Passive) */
  onResize?: (width: number) => void;
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
    // Multi-Row 모드에서는 CSS Grid가 너비를 관리하므로 width 스타일을 설정하지 않음
    if (!this.options.placement) {
      this.element.style.width = `var(--col-${this.options.columnState.key}-width, ${width}px)`;
    }
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
    const { columnState, columnDef, sortState, resizable, reorderable, placement } = this.options;

    const cell = document.createElement('div');
    cell.className = 'ps-header-cell';
    cell.dataset['columnKey'] = columnState.key;

    // Multi-Row 모드
    if (placement) {
      this.applyMultiRowStyles(cell, placement);
    } else {
      // 일반 모드: 인라인 스타일로 너비 설정
      // 렌더링 후 clientWidth를 측정하여 CSS 변수로 동기화
      this.applyWidthStyles(cell, columnDef);
    }

    // 드래그 앤 드롭 설정 (Multi-Row 모드에서는 비활성화)
    if (reorderable && !placement) {
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

    // 툴팁
    cell.title = columnDef.header ?? columnState.key;

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
   * 너비 관련 인라인 스타일 적용
   *
   * 헤더 셀에 width/minWidth/maxWidth/flex를 인라인 스타일로 적용합니다.
   * 렌더링 후 clientWidth를 측정하여 CSS 변수로 설정됩니다.
   */
  private applyWidthStyles(cell: HTMLElement, columnDef: ColumnDef): void {
    // width: 숫자면 px, 문자열이면 그대로
    const widthValue = toCSSValue(columnDef.width) ?? `${DEFAULT_COLUMN_WIDTH}px`;
    cell.style.width = widthValue;

    // minWidth
    const minWidthValue = toCSSValue(columnDef.minWidth);
    if (minWidthValue) {
      cell.style.minWidth = minWidthValue;
    }

    // maxWidth
    const maxWidthValue = toCSSValue(columnDef.maxWidth);
    if (maxWidthValue) {
      cell.style.maxWidth = maxWidthValue;
    }

    // flex: 남은 공간 비율 분배
    if (columnDef.flex !== undefined) {
      cell.style.flex = String(columnDef.flex);
    }
  }

  /**
   * Multi-Row 스타일 적용
   */
  private applyMultiRowStyles(cell: HTMLElement, placement: CellPlacement): void {
    const { gridRow, gridColumn, rowSpan, colSpan, gridColumnCount, gridRowCount } = placement;

    cell.classList.add('ps-multi-row-cell');

    // Grid 배치
    cell.style.gridRow = rowSpan > 1 ? `${gridRow} / span ${rowSpan}` : String(gridRow);
    cell.style.gridColumn = colSpan > 1 ? `${gridColumn} / span ${colSpan}` : String(gridColumn);

    // 첫 번째 그리드 컬럼
    if (gridColumn === 1) {
      cell.classList.add('ps-first-column');
    }

    // 마지막 그리드 컬럼 (border-right 제거용)
    const endColumn = gridColumn + colSpan - 1;
    if (endColumn >= gridColumnCount) {
      cell.classList.add('ps-last-column');
    }

    // 마지막 그리드 행
    const endRow = gridRow + rowSpan - 1;
    if (endRow >= gridRowCount) {
      cell.classList.add('ps-last-row');
    }

    // rowSpan이 있는 셀
    if (rowSpan > 1) {
      cell.classList.add('ps-rowspan');
    }

    // Flex 정렬
    cell.style.display = 'flex';
    cell.style.alignItems = 'center';
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
    // Multi-Row에서는 resizeColumnKey를 사용, 일반 모드에서는 columnState.key 사용
    const resizeKey = this.options.resizeColumnKey ?? this.options.columnState.key;
    this.options.onResizeStart?.(resizeKey, e.clientX);
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

