/**
 * GridRenderer - DOM 렌더링 총괄
 *
 * 그리드의 전체 DOM 구조를 생성하고 관리합니다.
 * - 헤더, 바디 영역 생성 (HeaderRenderer, BodyRenderer에 위임)
 * - CSS 변수를 통한 컬럼 너비 관리
 * - 테마 적용
 */

import type { GridCore } from '../core/GridCore';
import type { ColumnDef } from '../types';
import type { PivotResult } from '../types/pivot.types';
import type { ColumnState, SortState } from './types';
import type { InternalOptions } from './utils/configAdapter';
import { BodyRenderer } from './body/BodyRenderer';
import { HeaderRenderer } from './header/HeaderRenderer';
import { PivotHeaderRenderer } from './pivot/PivotHeaderRenderer';
import { DEFAULT_COLUMN_WIDTH, toCSSValue } from './utils/cssUtils';

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
  /** 행 클릭 콜백 (viewIndex, dataIndex 모두 전달) */
  onRowClick?: (viewIndex: number, row: Record<string, unknown>, event: MouseEvent, dataIndex?: number) => void;
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
  private scrollProxyY: HTMLElement | null = null;
  private scrollProxyX: HTMLElement | null = null;
  private spacerY: HTMLElement | null = null;
  private spacerX: HTMLElement | null = null;
  private styleElement: HTMLStyleElement | null = null;

  // 모듈
  private headerRenderer: HeaderRenderer | null = null;
  private pivotHeaderRenderer: PivotHeaderRenderer | null = null;
  private bodyRenderer: BodyRenderer | null = null;

  // 현재 헤더 모드
  private headerMode: 'flat' | 'pivot' = 'flat';

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

  // 스크롤 동기화 플래그
  private isSyncingHeaderScroll = false;

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
    // 컬럼 변경사항이 있을 수 있으므로 스타일 블록 업데이트
    this.updateColumnStyleBlock();
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
   *
   * CSS 변수를 업데이트한 후 헤더 셀의 실제 너비를 측정합니다.
   * 이를 통해 minWidth/maxWidth 제약이 자동으로 적용됩니다.
   * (%, rem, em 등 모든 단위의 minWidth/maxWidth 지원)
   */
  setColumnWidth(columnKey: string, width: number): void {
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      // 0. flex 속성 제거 (드래그 리사이즈 시 flex 비활성화)
      const columnDef = this.options.columns.find((c) => c.key === columnKey);
      if (columnDef?.flex !== undefined) {
        columnDef.flex = undefined;
        // 헤더 셀의 flex 스타일 제거
        const headerCell = this.headerElement?.querySelector<HTMLElement>(
          `.ps-header-cell[data-column-key="${columnKey}"]`
        );
        if (headerCell) {
          headerCell.style.flex = '';
        }
        // 바디 셀들은 flex 스타일을 사용하지 않으므로 순회 불필요
      }

      // 1. CSS 변수 업데이트
      this.updateColumnWidthCSS(columnKey, width);

      // 2. 헤더 셀의 실제 너비 측정 (minWidth/maxWidth가 적용된 값)
      const headerCell = this.headerElement?.querySelector<HTMLElement>(
        `.ps-header-cell[data-column-key="${columnKey}"]`
      );

      // 헤더 셀이 있으면 실제 측정된 너비 사용, 없으면 요청된 너비 사용
      const actualWidth = headerCell?.offsetWidth ?? width;

      // 3. 측정된 값으로 상태 및 CSS 변수 업데이트
      state.width = actualWidth;
      if (actualWidth !== width) {
        this.updateColumnWidthCSS(columnKey, actualWidth);
      }

      this.headerRenderer?.updateColumnWidth(columnKey, actualWidth);
      this.bodyRenderer?.updateColumnWidth(columnKey, actualWidth);
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

  // ===========================================================================
  // 피벗 모드 지원
  // ===========================================================================

  /**
   * 헤더 요소 반환
   */
  getHeaderElement(): HTMLElement | null {
    return this.headerElement;
  }

  /**
   * 그리드 컨테이너 반환
   */
  getGridContainer(): HTMLElement | null {
    return this.gridContainer;
  }

  /**
   * 현재 헤더 모드 반환
   */
  getHeaderMode(): 'flat' | 'pivot' {
    return this.headerMode;
  }

  /**
   * 피벗 헤더로 전환
   *
   * 기존 HeaderRenderer를 제거하고 PivotHeaderRenderer로 교체합니다.
   *
   * @param pivotResult - 피벗 연산 결과
   */
  switchToPivotHeader(pivotResult: PivotResult): void {
    if (!this.headerElement) return;

    // 기존 HeaderRenderer 제거
    if (this.headerRenderer) {
      this.headerRenderer.destroy();
      this.headerRenderer = null;
    }

    // 기존 PivotHeaderRenderer 제거 (이미 있는 경우)
    if (this.pivotHeaderRenderer) {
      this.pivotHeaderRenderer.destroy();
      this.pivotHeaderRenderer = null;
    }

    // fieldDefs 맵 생성 (options.columns에서 width 정보 참조용)
    // ColumnDef는 FieldDef의 width/minWidth/maxWidth를 포함함
    const fieldDefs = new Map<string, import('../types').FieldDef>();
    for (const col of this.options.columns) {
      // ColumnDef를 FieldDef로 캐스팅 (width 관련 속성만 필요)
      fieldDefs.set(col.key, col as unknown as import('../types').FieldDef);
    }

    // columnFieldCount 계산
    // headerLevelCount는 columnFields 개수 + valueFields 레벨(1)
    // valueFields가 여러 개여도 마지막 레벨 하나만 차지함
    const columnFieldCount = pivotResult.headerLevelCount - 1;

    // 피벗 컬럼 참조 저장 (콜백에서 사용)
    const pivotColumns = pivotResult.columns;

    // PivotHeaderRenderer 생성
    this.pivotHeaderRenderer = new PivotHeaderRenderer(this.headerElement, {
      headerTree: pivotResult.columnHeaderTree,
      levelCount: pivotResult.headerLevelCount,
      rowHeaderColumns: pivotResult.rowHeaderColumns,
      dataColumns: pivotColumns,
      headerHeight: this.options.rowHeight ?? 36,
      fieldDefs,
      columnFieldCount,
      gridContainer: this.gridContainer!,
      // 컬럼 너비 변경 콜백 (가상 스크롤용)
      onColumnWidthChange: (valueField, width) => {
        // 해당 valueField를 가진 모든 컬럼의 너비 업데이트
        for (const state of this.columnStates) {
          const colDef = pivotColumns.find(c => c.key === state.key);
          if (colDef?.pivotValueField === valueField) {
            state.width = width;
            // HorizontalVirtualScroller에도 알림 (offset 재계산)
            this.bodyRenderer?.updateColumnWidth(state.key, width);
          }
        }
      },
    });

    // 컬럼 상태 업데이트 (행 헤더 + 피벗 컬럼)
    const allColumns = [...pivotResult.rowHeaderColumns, ...pivotColumns];
    this.updateColumnStates(allColumns);

    this.headerMode = 'pivot';
    this.updateColumnStyleBlock(); // 피벗 모드전환 시 스타일 업데이트
  }

  /**
   * 일반 헤더로 복원
   * 
   * PivotHeaderRenderer를 제거하고 HeaderRenderer로 복원합니다.
   */
  switchToFlatHeader(): void {
    if (!this.headerElement) return;

    // PivotHeaderRenderer 제거
    if (this.pivotHeaderRenderer) {
      this.pivotHeaderRenderer.destroy();
      this.pivotHeaderRenderer = null;
    }

    // 기존 컬럼 상태 복원
    this.initializeColumnStates();

    // HeaderRenderer 재생성
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
      onHeaderCellResize: this.handleHeaderCellResize.bind(this),
    });

    // BodyRenderer 컬럼 복원
    this.bodyRenderer?.updateColumns(this.columnStates);

    this.headerMode = 'flat';
    this.updateColumnStyleBlock(); // 일반 모드 복원 시 스타일 업데이트
  }

  /**
   * 피벗 헤더 렌더러 반환
   */
  getPivotHeaderRenderer(): PivotHeaderRenderer | null {
    return this.pivotHeaderRenderer;
  }

  /**
   * 컬럼 상태 직접 업데이트 (피벗 모드에서 사용)
   *
   * @param columns - 새 컬럼 정의
   */
  updateColumnStates(columns: ColumnDef[]): void {
    this.columnStates = columns.map((col, index) => ({
      key: col.key,
      width: DEFAULT_COLUMN_WIDTH,
      pinned: col.pinned ?? col.frozen ?? 'none',
      visible: col.hidden !== true,
      order: index,
    }));

    // CSS 변수 업데이트
    this.initializeColumnWidthCSS();

    // BodyRenderer에 반영
    this.bodyRenderer?.updateColumns(this.columnStates);
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.headerRenderer?.destroy();
    this.pivotHeaderRenderer?.destroy();
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
   *
   * 초기 width는 기본값을 사용합니다.
   * 실제 픽셀값은 렌더링 후 measureColumnWidths()에서 측정됩니다.
   */
  private initializeColumnStates(): void {
    const columns = this.gridCore.getColumns();
    this.columnStates = columns.map((col, index) => ({
      key: col.key,
      // 초기값은 기본값, 렌더링 후 measureColumnWidths에서 실제 값으로 업데이트
      width: DEFAULT_COLUMN_WIDTH,
      pinned: col.frozen ?? 'none',
      visible: col.hidden !== true,
      order: index,
    }));
  }

  /**
   * DOM 구조 생성
   * 
   * 구조:
   * .ps-grid-container (flex column)
   *   ├── .ps-main-area (flex row)
   *   │    ├── .ps-content-wrapper (flex column)
   *   │    │    ├── .ps-header
   *   │    │    └── .ps-body
   *   │    └── .ps-scroll-proxy-y (세로 스크롤바)
   *   └── .ps-scroll-area-x (flex row)
   *        ├── .ps-scroll-proxy-x (가로 스크롤바)
   *        └── .ps-scroll-corner (우측 하단 코너)
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

    // === 메인 영역 (콘텐츠 + 세로 스크롤바) ===
    const mainArea = document.createElement('div');
    mainArea.className = 'ps-main-area';

    // 콘텐츠 래퍼 (헤더 + 바디)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'ps-content-wrapper';

    // 헤더 영역
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'ps-header';
    contentWrapper.appendChild(this.headerElement);

    // 바디 영역
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'ps-body';
    contentWrapper.appendChild(this.bodyElement);

    mainArea.appendChild(contentWrapper);

    // 세로 프록시 스크롤바
    this.scrollProxyY = document.createElement('div');
    this.scrollProxyY.className = 'ps-scroll-proxy-y';
    this.spacerY = document.createElement('div');
    this.spacerY.className = 'ps-scroll-spacer-y';
    this.scrollProxyY.appendChild(this.spacerY);
    mainArea.appendChild(this.scrollProxyY);

    this.gridContainer.appendChild(mainArea);

    // === 가로 스크롤 영역 ===
    const scrollAreaX = document.createElement('div');
    scrollAreaX.className = 'ps-scroll-area-x';

    // 가로 프록시 스크롤바
    this.scrollProxyX = document.createElement('div');
    this.scrollProxyX.className = 'ps-scroll-proxy-x';
    this.spacerX = document.createElement('div');
    this.spacerX.className = 'ps-scroll-spacer-x';
    this.scrollProxyX.appendChild(this.spacerX);
    scrollAreaX.appendChild(this.scrollProxyX);

    // 우측 하단 코너 (스크롤바 교차점)
    const scrollCorner = document.createElement('div');
    scrollCorner.className = 'ps-scroll-corner';
    scrollAreaX.appendChild(scrollCorner);

    this.gridContainer.appendChild(scrollAreaX);

    // 컨테이너에 추가
    this.container.appendChild(this.gridContainer);

    // 스타일 요소 생성 및 초기화
    this.styleElement = document.createElement('style');
    this.styleElement.setAttribute('data-id', 'grid-column-styles');
    this.gridContainer.appendChild(this.styleElement);
    this.updateColumnStyleBlock();

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
      onHeaderCellResize: this.handleHeaderCellResize.bind(this),
    });

    // BodyRenderer 초기화 (외부 스크롤 프록시 전달)
    this.bodyRenderer = new BodyRenderer(this.bodyElement, {
      rowHeight: this.options.rowHeight ?? 36,
      headerHeight: this.options.headerHeight ?? 40,
      gridCore: this.gridCore,
      columns: this.columnStates,
      selectionMode: this.options.selectionMode ?? 'row',
      groupingConfig: this.options.groupingConfig,
      rowTemplate: this.options.rowTemplate,
      scrollProxyY: this.scrollProxyY,
      scrollProxyX: this.scrollProxyX,
      spacerY: this.spacerY,
      spacerX: this.spacerX,
      onRowClick: this.onRowClick,
      onCellClick: this.onCellClick,
      onCellDblClick: this.onCellDblClick,
      onGroupToggle: this.onGroupToggle,
      onDragSelectionStart: this.onDragSelectionStart,
      onDragSelectionUpdate: this.onDragSelectionUpdate,
      onDragSelectionEnd: this.onDragSelectionEnd,
      formatRow: this.options.formatRow,
    });

    // 가로 스크롤 동기화 설정
    this.setupHorizontalScrollSync();
  }

  /**
   * 헤더와 바디의 가로 스크롤 동기화
   */
  private setupHorizontalScrollSync(): void {
    if (!this.headerElement || !this.bodyRenderer || !this.scrollProxyX) return;

    const viewport = this.bodyRenderer.getViewport();
    const header = this.headerElement;
    const scrollProxyX = this.scrollProxyX;

    // 가로 프록시 스크롤바 스크롤 시 → 헤더 동기화
    scrollProxyX.addEventListener('scroll', () => {
      if (this.isSyncingHeaderScroll) return;

      const scrollLeft = scrollProxyX.scrollLeft;
      // 피벗 모드일 때는 PivotHeaderRenderer의 updateScrollPosition 사용
      if (this.headerMode === 'pivot' && this.pivotHeaderRenderer) {
        this.pivotHeaderRenderer.updateScrollPosition(scrollLeft);
      } else {
        header.scrollLeft = scrollLeft;
      }
    }, { passive: true });

    // Viewport 스크롤 시 → 헤더도 스크롤
    viewport.addEventListener('scroll', () => {
      if (this.isSyncingHeaderScroll) return;

      const scrollLeft = viewport.scrollLeft;
      // 피벗 모드일 때는 PivotHeaderRenderer의 updateScrollPosition 사용
      if (this.headerMode === 'pivot' && this.pivotHeaderRenderer) {
        this.pivotHeaderRenderer.updateScrollPosition(scrollLeft);
      } else {
        header.scrollLeft = scrollLeft;
      }
    }, { passive: true });

    // 헤더 스크롤 시 → Viewport와 프록시도 스크롤 (드래그 등으로 직접 스크롤할 경우)
    header.addEventListener('scroll', () => {
      if (this.isSyncingHeaderScroll) return;

      this.isSyncingHeaderScroll = true;
      const scrollLeft = header.scrollLeft;
      if (Math.abs(viewport.scrollLeft - scrollLeft) > 1) {
        viewport.scrollLeft = scrollLeft;
      }
      if (Math.abs(scrollProxyX.scrollLeft - scrollLeft) > 1) {
        scrollProxyX.scrollLeft = scrollLeft;
      }
      requestAnimationFrame(() => {
        this.isSyncingHeaderScroll = false;
      });
    }, { passive: true });

    // 가로 가상화: BodyRenderer의 HorizontalVirtualScroller 범위 변경 → HeaderRenderer에 전달
    const horizontalScroller = this.bodyRenderer.getHorizontalVirtualScroller();
    horizontalScroller.on('rangeChanged', (range) => {
      this.headerRenderer?.setHorizontalVirtualRange(range);
    });

    // 초기 범위 동기화
    const initialRange = horizontalScroller.getVisibleRange();
    if (initialRange) {
      this.headerRenderer?.setHorizontalVirtualRange(initialRange);
    }

    // 렌더링 후 헤더 셀의 clientWidth를 측정하여 CSS 변수 업데이트
    this.measureColumnWidths();
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

  /**
   * 헤더 셀 리사이즈 처리 (Passive)
   * HeaderCell -> HeaderRenderer -> GridRenderer
   *
   * flex 컬럼의 실시간 너비 변경을 options.columns에도 반영합니다.
   */
  private handleHeaderCellResize(columnKey: string, width: number): void {
    // options.columns의 columnDef.width 업데이트 (flex 컬럼 실시간 동기화)
    const columnDef = this.options.columns.find((c) => c.key === columnKey);
    if (columnDef) {
      columnDef.width = width;
    }

    // columnState도 업데이트
    const state = this.columnStates.find((c) => c.key === columnKey);
    if (state) {
      state.width = width;
    }

    // BodyRenderer에 알림 (Spacer 업데이트 등)
    this.bodyRenderer?.updateColumnWidth(columnKey, width);
    // 총 너비 CSS 변수 업데이트
    this.updateTotalColumnWidthCSS();
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 너비 CSS 변수 초기화
   *
   * width, minWidth, maxWidth를 CSS 변수로 설정합니다.
   * 데이터 셀에서 이 CSS 변수를 참조하여 헤더와 동일한 제약을 적용합니다.
   */
  private initializeColumnWidthCSS(): void {
    if (!this.gridContainer) return;

    const columns = this.options.columns;

    for (const col of this.columnStates) {
      this.gridContainer.style.setProperty(`--col-${col.key}-width`, `${col.width}px`);

      // minWidth, maxWidth CSS 변수 설정
      const colDef = columns.find((c) => c.key === col.key);
      if (colDef) {
        const minWidthValue = toCSSValue(colDef.minWidth);
        const maxWidthValue = toCSSValue(colDef.maxWidth);

        if (minWidthValue) {
          this.gridContainer.style.setProperty(`--col-${col.key}-min-width`, minWidthValue);
        }
        if (maxWidthValue) {
          this.gridContainer.style.setProperty(`--col-${col.key}-max-width`, maxWidthValue);
        }
      }
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

  /**
   * 동적 컬럼 스타일 블록 업데이트
   * 
   * 각 셀에 인라인으로 width를 지정하는 대신,
   * data-column-key 속성을 기반으로 한 CSS 규칙을 생성하여 주입합니다.
   * 이를 통해 DOM 크기를 줄이고 렌더링 성능을 개선합니다.
   */
  private updateColumnStyleBlock(): void {
    if (!this.styleElement || !this.gridContainer) return;

    // 현재 GridCore의 컬럼 정보 사용 (피벗 여부 등 메타데이터 포함)
    const columns = this.gridCore.getColumns();
    const rules: string[] = [];

    for (const col of columns) {
      // CSS 변수 이름 결정 (피벗 모드 vs 일반 모드)
      // 피벗 값 필드인 경우: --pivot-col-{valueField}-width
      // 일반 컬럼인 경우: --col-{key}-width
      const varName = col.pivotValueField
        ? `--pivot-col-${col.pivotValueField}-width`
        : `--col-${col.key}-width`;

      // CSS 규칙 생성
      // .ps-cell[data-column-key="KEY"] { width: var(--variable-name); }
      // fallback은 calc() 내부 등 복잡성을 고려하여 생략하거나 필요한 경우 추가
      // (여기서는 변수만 사용, 변수가 없으면 기본값은 0이 되거나 상속됨 - 초기화 시 설정됨)
      rules.push(`.ps-cell[data-column-key="${col.key}"] { width: var(${varName}); }`);

      // 집계 셀(subtotal, grandtotal)도 동일한 너비 사용
      // (Row.ts에서 ps-cell 클래스를 공유하므로 위 규칙으로 커버됨)
    }

    this.styleElement.textContent = rules.join('\n');
  }

  /**
   * 헤더 셀의 clientWidth를 측정하여 CSS 변수 업데이트
   *
   * 헤더 셀에 적용된 width/minWidth/maxWidth/flex 인라인 스타일에 의해
   * 실제로 렌더링된 너비를 측정하고, 이 값을 CSS 변수로 설정합니다.
   * 이를 통해 데이터 셀들도 헤더와 동일한 너비를 갖게 됩니다.
   */
  private measureColumnWidths(): void {
    if (!this.headerElement || !this.gridContainer) return;

    // columnStates를 Map으로 변환 (O(1) 조회)
    const stateMap = new Map(this.columnStates.map((s) => [s.key, s]));

    // 렌더링이 완료된 후 측정 (브라우저가 레이아웃을 계산한 후)
    requestAnimationFrame(() => {
      const headerCells = this.headerElement!.querySelectorAll<HTMLElement>('.ps-header-cell');

      headerCells.forEach((cell) => {
        const columnKey = cell.dataset['columnKey'];
        if (!columnKey) return;

        // 실제 렌더링된 너비 측정 (offsetWidth = border 포함)
        const measuredWidth = cell.offsetWidth;
        if (measuredWidth <= 0) return;

        // ColumnState 업데이트 (Map 조회로 O(1))
        const state = stateMap.get(columnKey);
        if (state) {
          state.width = measuredWidth;
        }

        // CSS 변수 설정 (헤더와 데이터 셀 동기화)
        this.gridContainer!.style.setProperty(
          `--col-${columnKey}-width`,
          `${measuredWidth}px`
        );
      });

      // 총 너비 업데이트
      this.updateTotalColumnWidthCSS();

      // BodyRenderer에 컬럼 너비 변경 알림
      this.bodyRenderer?.updateColumns(this.columnStates);
    });
  }
}
