/**
 * GridRenderer - DOM 렌더링 총괄
 *
 * 그리드의 전체 DOM 구조를 생성하고 관리합니다.
 * - 헤더, 바디 영역 생성 (HeaderRenderer, BodyRenderer에 위임)
 * - CSS 변수를 통한 컬럼 너비 관리
 * - 테마 적용
 */

import type { GridCore } from '../core/GridCore';
import type { ColumnState, SortState } from './types';
import type { InternalOptions } from './utils/configAdapter';
import { BodyRenderer } from './body/BodyRenderer';
import { HeaderRenderer } from './header/HeaderRenderer';

// CSS 스타일 삽입 여부 추적
let styleInjected = false;

/**
 * GridRenderer 설정
 */
export interface GridRendererOptions {
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 내부 옵션 */
  options: InternalOptions;
  /** 행 클릭 콜백 */
  onRowClick?: (rowIndex: number, row: Record<string, unknown>, event: MouseEvent) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (
    position: { rowIndex: number; columnKey: string },
    value: unknown,
    event: MouseEvent
  ) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (
    position: { rowIndex: number; columnKey: string },
    value: unknown,
    event: MouseEvent
  ) => void;
  /** 그룹 토글 콜백 */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
  /** 정렬 변경 콜백 */
  onSortChange?: (sorts: SortState[]) => void;
  /** 컬럼 순서 변경 콜백 */
  onColumnReorder?: (order: string[]) => void;
  /** 드래그 선택 시작 콜백 */
  onDragSelectionStart?: (position: { rowIndex: number; columnKey: string }, event: MouseEvent) => void;
  /** 드래그 선택 업데이트 콜백 */
  onDragSelectionUpdate?: (position: { rowIndex: number; columnKey: string }) => void;
  /** 드래그 선택 완료 콜백 */
  onDragSelectionEnd?: () => void;
}

/**
 * 그리드 DOM 렌더러
 */
export class GridRenderer {
  private readonly gridCore: GridCore;
  private readonly container: HTMLElement;
  private readonly options: InternalOptions;

  // 컬럼 상태
  private columnStates: ColumnState[] = [];

  // DOM 요소
  private gridContainer: HTMLElement | null = null;
  private headerElement: HTMLElement | null = null;
  private bodyElement: HTMLElement | null = null;

  // 모듈
  private headerRenderer: HeaderRenderer | null = null;
  private bodyRenderer: BodyRenderer | null = null;

  // 콜백
  private onRowClick?: GridRendererOptions['onRowClick'];
  private onCellClick?: GridRendererOptions['onCellClick'];
  private onCellDblClick?: GridRendererOptions['onCellDblClick'];
  private onGroupToggle?: GridRendererOptions['onGroupToggle'];
  private onSortChange?: GridRendererOptions['onSortChange'];
  private onColumnReorder?: GridRendererOptions['onColumnReorder'];
  private onDragSelectionStart?: GridRendererOptions['onDragSelectionStart'];
  private onDragSelectionUpdate?: GridRendererOptions['onDragSelectionUpdate'];
  private onDragSelectionEnd?: GridRendererOptions['onDragSelectionEnd'];

  // ResizeObserver
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, options: GridRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.options = options.options;
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;
    this.onGroupToggle = options.onGroupToggle;
    this.onSortChange = options.onSortChange;
    this.onColumnReorder = options.onColumnReorder;
    this.onDragSelectionStart = options.onDragSelectionStart;
    this.onDragSelectionUpdate = options.onDragSelectionUpdate;
    this.onDragSelectionEnd = options.onDragSelectionEnd;

    // 스타일 삽입
    this.injectStyles();

    // 컬럼 상태 초기화
    this.initializeColumnStates();

    // DOM 구조 생성
    this.createDOMStructure();

    // ResizeObserver 설정
    this.setupResizeObserver();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 전체 새로고침
   */
  refresh(): void {
    this.bodyRenderer?.refresh();
  }

  /**
   * 컬럼 상태 가져오기
   */
  getColumnStates(): ColumnState[] {
    return [...this.columnStates];
  }

  /**
   * 컬럼 너비 설정
   */
  setColumnWidth(columnKey: string, width: number): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.width = Math.max(50, width);
      this.updateColumnWidthCSS(columnKey, state.width);
      this.headerRenderer?.updateColumnWidth(columnKey, state.width);
    }
  }

  /**
   * 컬럼 고정 설정
   */
  setColumnPinned(columnKey: string, pinned: 'left' | 'right' | 'none'): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.pinned = pinned;
      this.headerRenderer?.updateColumns(this.columnStates);
      this.bodyRenderer?.updateColumns(this.columnStates);
    }
  }

  /**
   * 컬럼 가시성 설정
   */
  setColumnVisible(columnKey: string, visible: boolean): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.visible = visible;
      this.headerRenderer?.updateColumns(this.columnStates);
      this.bodyRenderer?.updateColumns(this.columnStates);
    }
  }

  /**
   * 컬럼 순서 설정
   */
  setColumnOrder(order: string[]): void {
    order.forEach((key, index) => {
      const state = this.columnStates.find((c) => c.key === key);
      if (state) {
        state.order = index;
      }
    });
    this.columnStates.sort((a, b) => a.order - b.order);
    this.headerRenderer?.updateColumns(this.columnStates);
    this.bodyRenderer?.updateColumns(this.columnStates);
  }

  /**
   * 정렬 상태 업데이트
   */
  updateSortState(sortStates: SortState[]): void {
    this.headerRenderer?.updateSortState(sortStates);
  }

  /**
   * 선택 상태 업데이트
   */
  updateSelection(selectedRows: Set<string | number>): void {
    this.bodyRenderer?.updateSelection(selectedRows);
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    this.bodyRenderer?.scrollToRow(rowIndex);
  }

  /**
   * HeaderRenderer 인스턴스 반환
   */
  getHeaderRenderer(): HeaderRenderer | null {
    return this.headerRenderer;
  }

  /**
   * BodyRenderer 인스턴스 반환
   */
  getBodyRenderer(): BodyRenderer | null {
    return this.bodyRenderer;
  }

  /**
   * 렌더링용 행 높이 설정 (가변 높이 row 지원)
   *
   * 가변 높이 row를 지원할 때 사용합니다.
   *
   * @example
   * // 평균 또는 최대 행 높이 설정
   * renderer.setRenderRowHeight(50);
   */
  setRenderRowHeight(height: number): void {
    this.bodyRenderer?.setRenderRowHeight(height);
  }

  /**
   * 그룹화 설정
   *
   * BodyRenderer에 위임하며, CSS 변수도 자동으로 업데이트됩니다.
   *
   * @param config - 그룹화 설정 (null이면 그룹화 해제)
   */
  setGroupingConfig(config: import('../types/grouping.types').GroupingConfig | null): void {
    // BodyRenderer에 위임 (CSS 변수 설정도 BodyRenderer가 처리)
    this.bodyRenderer?.setGroupingConfig(config);
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.headerRenderer?.destroy();
    this.bodyRenderer?.destroy();

    if (this.gridContainer) {
      this.gridContainer.remove();
    }
  }

  // ===========================================================================
  // 초기화 (Private)
  // ===========================================================================

  /**
   * 스타일 삽입 (한 번만)
   */
  private injectStyles(): void {
    if (styleInjected) return;

    // 동적으로 CSS를 삽입하는 대신, 사용자가 CSS 파일을 import하도록 안내
    // 여기서는 최소한의 인라인 스타일만 적용
    styleInjected = true;
  }

  /**
   * 컬럼 상태 초기화
   */
  private initializeColumnStates(): void {
    const columns = this.gridCore.getColumns();
    this.columnStates = columns.map((col, index) => ({
      key: col.key,
      width: col.width ?? 100,
      pinned: col.frozen ?? 'none',
      visible: col.hidden !== true,
      order: index,
    }));
  }

  /**
   * DOM 구조 생성
   */
  private createDOMStructure(): void {
    // 메인 컨테이너
    this.gridContainer = document.createElement('div');
    this.gridContainer.className = 'ps-grid-container';

    // 테마 적용
    if (this.options.theme === 'dark') {
      this.gridContainer.classList.add('ps-theme-dark');
    }

    // CSS 변수로 컬럼 너비 설정
    this.initializeColumnWidthCSS();

    // 그룹화 설정이 있으면 초기 indent CSS 변수 설정
    if (this.options.groupingConfig?.columns?.length) {
      const indentPx = this.options.groupingConfig.columns.length * 20;
      this.gridContainer.style.setProperty('--ps-group-indent', `${indentPx}px`);
    }

    // 헤더 영역
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'ps-header';
    this.gridContainer.appendChild(this.headerElement);

    // 바디 영역
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'ps-body';
    this.gridContainer.appendChild(this.bodyElement);

    // 컨테이너에 추가
    this.container.appendChild(this.gridContainer);

    // HeaderRenderer 초기화
    this.headerRenderer = new HeaderRenderer(this.headerElement, {
      gridCore: this.gridCore,
      columns: this.columnStates,
      headerHeight: this.options.rowHeight ?? 36,
      resizable: this.options.resizableColumns !== false,
      reorderable: this.options.reorderableColumns ?? false,
      rowTemplate: this.options.rowTemplate,
      onSortChange: this.handleSortChange.bind(this),
      onColumnResize: this.handleColumnResize.bind(this),
      onColumnReorder: this.handleColumnReorder.bind(this),
    });

    // BodyRenderer 초기화
    this.bodyRenderer = new BodyRenderer(this.bodyElement, {
      rowHeight: this.options.rowHeight ?? 36,
      gridCore: this.gridCore,
      columns: this.columnStates,
      selectionMode: this.options.selectionMode ?? 'row',
      groupingConfig: this.options.groupingConfig,
      rowTemplate: this.options.rowTemplate,
      onRowClick: this.onRowClick,
      onCellClick: this.onCellClick,
      onCellDblClick: this.onCellDblClick,
      onGroupToggle: this.onGroupToggle,
      onDragSelectionStart: this.onDragSelectionStart,
      onDragSelectionUpdate: this.onDragSelectionUpdate,
      onDragSelectionEnd: this.onDragSelectionEnd,
    });

    // 가로 스크롤 동기화 설정
    this.setupHorizontalScrollSync();
  }

  /**
   * 헤더와 바디의 가로 스크롤 동기화
   */
  private setupHorizontalScrollSync(): void {
    if (!this.headerElement || !this.bodyRenderer) return;

    const viewport = this.bodyRenderer.getViewport();
    const header = this.headerElement;

    // Viewport 스크롤 시 → 헤더도 스크롤
    viewport.addEventListener('scroll', () => {
      header.scrollLeft = viewport.scrollLeft;
    }, { passive: true });

    // 헤더 스크롤 시 → Viewport도 스크롤 (드래그 등으로 직접 스크롤할 경우)
    header.addEventListener('scroll', () => {
      if (Math.abs(viewport.scrollLeft - header.scrollLeft) > 1) {
        viewport.scrollLeft = header.scrollLeft;
      }
    }, { passive: true });
  }

  /**
   * ResizeObserver 설정
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(() => {
      this.bodyRenderer?.handleResize();
    });

    if (this.gridContainer) {
      this.resizeObserver.observe(this.gridContainer);
    }
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * 정렬 변경 처리
   */
  private handleSortChange(sorts: SortState[]): void {
    this.onSortChange?.(sorts);
  }

  /**
   * 컬럼 리사이즈 처리
   */
  private handleColumnResize(columnKey: string, width: number): void {
    this.setColumnWidth(columnKey, width);
  }

  /**
   * 컬럼 순서 변경 처리
   */
  private handleColumnReorder(order: string[]): void {
    this.setColumnOrder(order);
    this.onColumnReorder?.(order);
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 너비 CSS 변수 초기화
   */
  private initializeColumnWidthCSS(): void {
    if (!this.gridContainer) return;

    for (const col of this.columnStates) {
      this.gridContainer.style.setProperty(`--col-${col.key}-width`, `${col.width}px`);
    }

    // 총 컬럼 너비 계산하여 CSS 변수로 저장 (그룹 헤더 너비 동기화용)
    this.updateTotalColumnWidthCSS();
  }

  /**
   * 컬럼 너비 CSS 변수 업데이트
   */
  private updateColumnWidthCSS(columnKey: string, width: number): void {
    if (!this.gridContainer) return;
    this.gridContainer.style.setProperty(`--col-${columnKey}-width`, `${width}px`);

    // 총 컬럼 너비도 업데이트
    this.updateTotalColumnWidthCSS();
  }

  /**
   * 총 컬럼 너비 CSS 변수 업데이트
   *
   * 보이는 컬럼들의 너비 합계를 --ps-row-width에 저장합니다.
   * 그룹 헤더 행은 이 값을 참조하여 데이터 행과 너비를 동기화합니다.
   */
  private updateTotalColumnWidthCSS(): void {
    if (!this.gridContainer) return;

    const totalWidth = this.columnStates
      .filter((col) => col.visible)
      .reduce((sum, col) => sum + col.width, 0);

    this.gridContainer.style.setProperty('--ps-row-width', `${totalWidth}px`);
  }
}
