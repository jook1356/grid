/**
 * BodyRenderer - 바디 영역 렌더링
 *
 * VirtualScroller와 연동하여 보이는 행만 렌더링합니다.
 * RowPool을 사용하여 DOM 요소를 재사용합니다.
 * GroupManager를 통해 그룹화된 데이터를 렌더링합니다.
 * MultiRowRenderer를 통해 Multi-Row 레이아웃을 지원합니다.
 * Row 클래스를 사용하여 행을 렌더링합니다.
 * 드래그 선택을 지원합니다.
 */

import type { GridCore } from '../../core/GridCore';
import type { Row as RowData, ColumnDef, CellValue } from '../../types';
import type { VirtualRow, GroupHeaderRow, DataRow, GroupingConfig, RowTemplate, RowState } from '../../types/grouping.types';
import type { AddedRow, ModifiedRow } from '../../types/crud.types';
import type { ColumnState, ColumnGroups, CellPosition } from '../types';
import type { RowRenderContext, MergeInfoGetter } from '../row/types';
import { VirtualScroller } from '../VirtualScroller';
import { HorizontalVirtualScroller } from '../HorizontalVirtualScroller';
import { RowPool } from './RowPool';
import { GroupManager } from '../grouping/GroupManager';
import { VirtualRowBuilder } from '../row/VirtualRowBuilder';
import { MultiRowRenderer } from '../multirow/MultiRowRenderer';
import { Row } from '../row/Row';
import type { MergeManager, CellMergeInfo } from '../merge/MergeManager';
import type { HorizontalVirtualRange } from '../types';

/**
 * 고정 행 설정
 */
export interface PinnedRowsConfig {
  /** 상단 고정 행 */
  top?: Row[];
  /** 하단 고정 행 */
  bottom?: Row[];
}

// =============================================================================
// formatRow API 타입
// =============================================================================

/**
 * 셀 정보 (formatRow 컨텍스트용)
 */
export interface CellInfo {
  /** 셀 DOM 요소 */
  element: HTMLElement;
  /** 셀 값 */
  value: CellValue;
  /** 원본 값 (modified일 때) */
  originalValue?: CellValue;
  /** 이 셀이 수정되었는지 */
  isModified: boolean;
}

/**
 * 데이터 행 포맷팅 컨텍스트
 */
export interface DataRowContext {
  /** 뷰 인덱스 (가상화 기준) */
  viewIndex: number;
  /** 데이터 인덱스 (원본 데이터 기준) */
  dataIndex: number;
  /** 행 식별자 (불변, CRUD 안전) */
  rowId?: string | number;
  /** 행 데이터 */
  data: RowData;
  /** 그룹 경로 */
  groupPath: string[];
  /** 행 변경 상태 (Dirty State) */
  rowState: RowState;
  /** 원본 데이터 (modified일 때) */
  originalData?: RowData;
  /** 변경된 필드 목록 */
  changedFields?: Set<string>;
  /** 행 DOM 요소 */
  rowElement: HTMLElement;
  /** 셀 정보 맵 (columnKey → CellInfo) */
  cells: Record<string, CellInfo>;
}

/**
 * 그룹 헤더 포맷팅 컨텍스트
 */
export interface GroupHeaderContext {
  /** 뷰 인덱스 */
  viewIndex: number;
  /** 그룹 ID */
  groupId: string;
  /** 그룹 컬럼 */
  column: string;
  /** 그룹 값 */
  value: CellValue;
  /** 그룹 레벨 */
  level: number;
  /** 하위 항목 수 */
  itemCount: number;
  /** 접힘 상태 */
  collapsed: boolean;
  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
  /** 행 DOM 요소 */
  element: HTMLElement;
}

/**
 * 부분합 행 포맷팅 컨텍스트
 */
export interface SubtotalContext {
  /** 뷰 인덱스 */
  viewIndex: number;
  /** 레벨 */
  level: number;
  /** 집계 값들 */
  aggregates: Record<string, CellValue>;
  /** 행 DOM 요소 */
  element: HTMLElement;
  /** 셀 정보 맵 */
  cells: Record<string, CellInfo>;
}

/**
 * 통합 포맷 정보 (Discriminated Union)
 */
export type FormatRowInfo =
  | { type: 'data'; ctx: DataRowContext }
  | { type: 'group-header'; ctx: GroupHeaderContext }
  | { type: 'subtotal'; ctx: SubtotalContext }
  | { type: 'grand-total'; ctx: SubtotalContext };

/**
 * formatRow 콜백 타입
 */
export type FormatRowCallback = (info: FormatRowInfo) => void;

/**
 * MergeManager 설정
 */
export interface MergeManagerOptions {
  /** MergeManager 인스턴스 */
  mergeManager?: MergeManager;
}

/**
 * 가로 가상화 설정
 */
export interface HorizontalVirtualizationOptions {
  /**
   * 가로 가상화 활성화 여부
   * @default false (자동 활성화 임계값 이상이면 자동 활성화)
   */
  enabled?: boolean;

  /**
   * 자동 활성화 임계값 (Center 컬럼 수)
   * 이 수 이상이면 자동으로 가상화 활성화
   * @default 30
   */
  autoEnableThreshold?: number;

  /**
   * 좌우 추가 렌더링할 컬럼 수 (overscan)
   * @default 2
   */
  overscan?: number;
}

/**
 * BodyRenderer 설정
 */
export interface BodyRendererOptions {
  /** 기본 행 높이 */
  rowHeight: number;
  /** 헤더 높이 (스크롤바 오프셋 계산용) */
  headerHeight?: number;
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 컬럼 상태 */
  columns: ColumnState[];
  /** 선택 모드 */
  selectionMode?: 'none' | 'row' | 'range' | 'all';
  /** 그룹화 설정 (선택) */
  groupingConfig?: GroupingConfig;
  /** Multi-Row 템플릿 (선택) */
  rowTemplate?: RowTemplate;
  /** 고정 행 설정 (선택) */
  pinnedRows?: PinnedRowsConfig;
  /** MergeManager 인스턴스 (선택) */
  mergeManager?: MergeManager;
  /** 외부 세로 스크롤 프록시 (선택) - GridRenderer에서 전달 */
  scrollProxyY?: HTMLElement;
  /** 외부 가로 스크롤 프록시 (선택) - GridRenderer에서 전달 */
  scrollProxyX?: HTMLElement;
  /** 외부 세로 스페이서 (선택) - GridRenderer에서 전달 */
  spacerY?: HTMLElement;
  /** 외부 가로 스페이서 (선택) - GridRenderer에서 전달 */
  spacerX?: HTMLElement;
  /** 가로 가상화 설정 (선택) */
  horizontalVirtualization?: HorizontalVirtualizationOptions;
  /** 행 클릭 콜백 (viewIndex, dataIndex 모두 전달) */
  onRowClick?: (viewIndex: number, row: RowData, event: MouseEvent, dataIndex?: number) => void;
  /** 셀 클릭 콜백 */
  onCellClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 셀 더블클릭 콜백 */
  onCellDblClick?: (position: CellPosition, value: unknown, event: MouseEvent) => void;
  /** 그룹 토글 콜백 */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
  /** 드래그 선택 시작 콜백 */
  onDragSelectionStart?: (position: CellPosition, event: MouseEvent) => void;
  /** 드래그 선택 업데이트 콜백 */
  onDragSelectionUpdate?: (position: CellPosition) => void;
  /** 드래그 선택 완료 콜백 */
  onDragSelectionEnd?: () => void;
  /** 행 포맷팅 콜백 (Wijmo formatItem 대체) */
  formatRow?: FormatRowCallback;
  /** 행 상태 조회 콜백 (ChangeTracker 연동용) */
  getRowState?: (rowId: string | number) => RowState;
  /** 변경된 필드 조회 콜백 (ChangeTracker 연동용) */
  getChangedFields?: (rowId: string | number) => Set<string> | undefined;
  /** 추가된 행 목록 조회 콜백 (ChangeTracker 연동용) */
  getAddedRows?: () => ReadonlyMap<string | number, AddedRow>;
  /** 수정된 행 목록 조회 콜백 (ChangeTracker 연동용) */
  getModifiedRows?: () => ReadonlyMap<string | number, ModifiedRow>;
  /** 삭제된 행 ID 목록 조회 콜백 (ChangeTracker 연동용) */
  getDeletedRowIds?: () => Set<string | number>;
}

/**
 * 바디 영역 렌더러
 */
export class BodyRenderer {
  private readonly gridCore: GridCore;
  private readonly rowHeight: number;

  // 컬럼 상태
  private columns: ColumnState[] = [];
  private columnDefs: Map<string, ColumnDef> = new Map();

  // 선택 상태
  private selectedRows: Set<string | number> = new Set();
  private selectedRowIndices: Set<number> = new Set();  // 셀 선택에서 파생된 행 인덱스

  // DOM 요소
  private container: HTMLElement;
  private pinnedTopContainer: HTMLElement;
  private scrollWrapper: HTMLElement;
  private scrollProxyY: HTMLElement;
  private scrollProxyX: HTMLElement;
  private viewport: HTMLElement;
  private spacerY: HTMLElement;
  private spacerX: HTMLElement;
  private rowContainer: HTMLElement;
  private pinnedBottomContainer: HTMLElement;

  // 외부 스크롤 프록시 여부
  // @ts-expect-error 향후 사용 예정
  private _externalScrollProxy: boolean = false;

  // 모듈
  private virtualScroller: VirtualScroller;
  private horizontalVirtualScroller: HorizontalVirtualScroller;
  private rowPool: RowPool;
  private groupManager: GroupManager;
  private virtualRowBuilder: VirtualRowBuilder;
  private multiRowRenderer: MultiRowRenderer | null = null;

  // Multi-Row 설정
  // @ts-expect-error 향후 사용 예정
  private _rowTemplate: RowTemplate | null = null;

  // 고정 행
  private pinnedTopRows: Row[] = [];
  private pinnedBottomRows: Row[] = [];

  // 스크롤 동기화 플래그
  private isSyncingHorizontalScroll = false;

  // 가상 행 (그룹화된 경우 그룹 헤더 포함)
  private virtualRows: VirtualRow[] = [];

  // 선택 모드
  private selectionMode: 'none' | 'row' | 'range' | 'all' = 'row';

  // 콜백
  private onRowClick?: BodyRendererOptions['onRowClick'];
  private onCellClick?: BodyRendererOptions['onCellClick'];
  private onCellDblClick?: BodyRendererOptions['onCellDblClick'];
  private onGroupToggle?: BodyRendererOptions['onGroupToggle'];
  private onDragSelectionStart?: BodyRendererOptions['onDragSelectionStart'];
  private onDragSelectionUpdate?: BodyRendererOptions['onDragSelectionUpdate'];
  private onDragSelectionEnd?: BodyRendererOptions['onDragSelectionEnd'];
  private formatRow?: FormatRowCallback;
  private getRowState?: BodyRendererOptions['getRowState'];
  private getChangedFields?: BodyRendererOptions['getChangedFields'];
  private getAddedRows?: BodyRendererOptions['getAddedRows'];
  private getModifiedRows?: BodyRendererOptions['getModifiedRows'];
  private getDeletedRowIds?: BodyRendererOptions['getDeletedRowIds'];

  // 드래그 선택 상태
  private isDragging = false;
  private isActualDrag = false;  // 실제로 드래그했는지 (셀이 바뀌었는지)
  private justFinishedDrag = false;  // 방금 드래그 완료 (클릭 무시용)
  private dragStartPosition: CellPosition | null = null;
  private lastDragColumnKey: string | null = null;  // 드래그 중 마지막 컬럼 키
  private dragStartEvent: MouseEvent | null = null;  // 드래그 시작 이벤트 저장

  // 선택된 셀 Set (O(1) 조회용)
  private selectedCells: Set<string> = new Set();

  // 자동 스크롤 관련
  private autoScrollAnimationId: number | null = null;
  private autoScrollSpeed = 0;

  // 이벤트 핸들러 바인딩 (제거용)
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;

  // 셀 병합 관리자
  private mergeManager: MergeManager | null = null;

  constructor(container: HTMLElement, options: BodyRendererOptions) {
    this.container = container;
    this.gridCore = options.gridCore;
    this.rowHeight = options.rowHeight;
    this.columns = options.columns;
    this.selectionMode = options.selectionMode ?? 'row';
    this.onRowClick = options.onRowClick;
    this.onCellClick = options.onCellClick;
    this.onCellDblClick = options.onCellDblClick;
    this.onGroupToggle = options.onGroupToggle;
    this.onDragSelectionStart = options.onDragSelectionStart;
    this.onDragSelectionUpdate = options.onDragSelectionUpdate;
    this.onDragSelectionEnd = options.onDragSelectionEnd;
    this.formatRow = options.formatRow;
    this.getRowState = options.getRowState;
    this.getChangedFields = options.getChangedFields;
    this.getAddedRows = options.getAddedRows;
    this.getModifiedRows = options.getModifiedRows;
    this.getDeletedRowIds = options.getDeletedRowIds;

    // 이벤트 핸들러 바인딩
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);

    // 컬럼 정의 맵 생성
    for (const col of this.gridCore.getColumns()) {
      this.columnDefs.set(col.key, col);
    }

    // DOM 구조 생성
    // 상단 고정 영역
    this.pinnedTopContainer = this.createElement('div', 'ps-pinned-top');

    // 스크롤 영역 래퍼 (flex 레이아웃에서 나머지 공간 차지)
    this.scrollWrapper = this.createElement('div', 'ps-scroll-wrapper');

    // 스크롤 프록시와 스페이서 (외부에서 전달받거나 내부 생성)
    if (options.scrollProxyY && options.scrollProxyX && options.spacerY && options.spacerX) {
      // 외부에서 전달받은 경우 (그리드 컨테이너 레벨에 위치)
      this.scrollProxyY = options.scrollProxyY;
      this.scrollProxyX = options.scrollProxyX;
      this.spacerY = options.spacerY;
      this.spacerX = options.spacerX;
      this._externalScrollProxy = true;
    } else {
      // 내부에서 생성 (기존 방식 - fallback)
      this.scrollProxyY = this.createElement('div', 'ps-scroll-proxy-y');
      this.spacerY = this.createElement('div', 'ps-scroll-spacer-y');
      this.scrollProxyY.appendChild(this.spacerY);
      this.scrollWrapper.appendChild(this.scrollProxyY);

      this.scrollProxyX = this.createElement('div', 'ps-scroll-proxy-x');
      this.spacerX = this.createElement('div', 'ps-scroll-spacer-x');
      this.scrollProxyX.appendChild(this.spacerX);
      // 가로 스크롤바는 scrollWrapper 바깥에 추가해야 하지만 fallback에서는 일단 내부에
      this._externalScrollProxy = false;
    }

    this.viewport = this.createElement('div', 'ps-viewport');
    this.rowContainer = this.createElement('div', 'ps-row-container');
    this.viewport.appendChild(this.rowContainer);

    // 스크롤 래퍼에 viewport 추가
    this.scrollWrapper.appendChild(this.viewport);

    // 하단 고정 영역
    this.pinnedBottomContainer = this.createElement('div', 'ps-pinned-bottom');

    // DOM 추가 순서: top → scroll-wrapper → bottom
    this.container.appendChild(this.pinnedTopContainer);
    this.container.appendChild(this.scrollWrapper);
    this.container.appendChild(this.pinnedBottomContainer);

    // 모듈 초기화
    this.virtualScroller = new VirtualScroller({
      estimatedRowHeight: this.rowHeight,
    });

    // 가로 가상화 스크롤러 초기화
    this.horizontalVirtualScroller = new HorizontalVirtualScroller({
      enabled: options.horizontalVirtualization?.enabled,
      autoEnableThreshold: options.horizontalVirtualization?.autoEnableThreshold,
      overscan: options.horizontalVirtualization?.overscan,
    });

    this.rowPool = new RowPool(this.rowContainer, this.columns.length);

    // GroupManager 초기화
    this.groupManager = new GroupManager({
      config: options.groupingConfig,
    });

    // VirtualRowBuilder 초기화
    this.virtualRowBuilder = new VirtualRowBuilder();

    // Multi-Row 템플릿이 있으면 MultiRowRenderer 및 RowPool 초기화
    if (options.rowTemplate) {
      this._rowTemplate = options.rowTemplate;
      this.multiRowRenderer = new MultiRowRenderer(
        options.rowTemplate,
        this.columnDefs,
        this.rowHeight
      );
      // RowPool에도 템플릿 설정 (Multi-Row 컨테이너 구조 사용)
      this.rowPool.setMultiRowTemplate(options.rowTemplate);
      // VirtualScroller에 렌더링용 높이 설정 (visibleRowCount 계산용)
      this.virtualScroller.setRenderRowHeight(this.multiRowRenderer.getTotalRowHeight());
    }

    // VirtualScroller 연결 (rowContainer도 전달하여 네이티브 스크롤 지원)
    this.virtualScroller.attach(this.scrollProxyY, this.viewport, this.spacerY, this.rowContainer);

    // Spacer 오프셋 설정: scrollProxyY가 헤더를 포함한 main-area 전체 높이를 가지므로
    // 헤더 높이만큼 spacer에 추가하여 스크롤바가 올바르게 표시되도록 함
    if (options.headerHeight) {
      this.virtualScroller.setSpacerOffset(options.headerHeight);
    }

    // HorizontalVirtualScroller 연결
    this.horizontalVirtualScroller.attach(this.scrollProxyX, this.viewport, this.spacerX);

    // 이벤트 바인딩
    this.virtualScroller.on('rangeChanged', this.onRangeChanged.bind(this));
    this.horizontalVirtualScroller.on('rangeChanged', this.onHorizontalRangeChanged.bind(this));
    this.viewport.addEventListener('click', this.handleClick.bind(this));
    this.viewport.addEventListener('dblclick', this.handleDblClick.bind(this));
    this.viewport.addEventListener('mousedown', this.handleMouseDown.bind(this));

    // 가로 스크롤 프록시 이벤트 바인딩 (가상화 비활성화 시에도 동기화 필요)
    this.scrollProxyX.addEventListener('scroll', this.handleProxyXScroll.bind(this), { passive: true });
    this.viewport.addEventListener('scroll', this.handleViewportScroll.bind(this), { passive: true });

    // 고정 행 초기화
    if (options.pinnedRows) {
      if (options.pinnedRows.top) {
        this.pinnedTopRows = [...options.pinnedRows.top];
      }
      if (options.pinnedRows.bottom) {
        this.pinnedBottomRows = [...options.pinnedRows.bottom];
      }
    }

    // MergeManager 초기화
    if (options.mergeManager) {
      this.setMergeManager(options.mergeManager);
    }

    // 초기 행 수 설정
    this.updateVirtualRows();

    // 가로 스페이서 너비 초기화
    this.updateHorizontalSpacerWidth();

    // 가로 가상화: Center 컬럼 설정
    this.updateHorizontalVirtualScroller();

    // 고정 행 렌더링
    this.renderPinnedRows();
  }

  /**
   * 가로 프록시 스크롤바 스크롤 핸들러
   */
  private handleProxyXScroll(): void {
    if (this.isSyncingHorizontalScroll) return;

    const scrollLeft = this.scrollProxyX.scrollLeft;

    // viewport와 고정 영역 동기화
    if (Math.abs(this.viewport.scrollLeft - scrollLeft) > 1) {
      this.isSyncingHorizontalScroll = true;
      this.viewport.scrollLeft = scrollLeft;
      // 다음 프레임에서 플래그 해제
      requestAnimationFrame(() => {
        this.isSyncingHorizontalScroll = false;
      });
    }
    this.pinnedTopContainer.scrollLeft = scrollLeft;
    this.pinnedBottomContainer.scrollLeft = scrollLeft;
  }

  /**
   * Viewport 스크롤 핸들러 (가로 스크롤 프록시와 동기화)
   */
  private handleViewportScroll(): void {
    if (this.isSyncingHorizontalScroll) return;

    const scrollLeft = this.viewport.scrollLeft;

    // 프록시 스크롤바와 동기화
    if (Math.abs(this.scrollProxyX.scrollLeft - scrollLeft) > 1) {
      this.isSyncingHorizontalScroll = true;
      this.scrollProxyX.scrollLeft = scrollLeft;
      // 다음 프레임에서 플래그 해제
      requestAnimationFrame(() => {
        this.isSyncingHorizontalScroll = false;
      });
    }
    // 고정 영역 동기화
    this.pinnedTopContainer.scrollLeft = scrollLeft;
    this.pinnedBottomContainer.scrollLeft = scrollLeft;
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 데이터 변경 시 새로고침
   *
   * 가상화된 행과 고정된 행 모두 다시 렌더링합니다.
   * 고정된 집계 행(subtotal, grandtotal)은 데이터 기반으로 자동 재계산됩니다.
   */
  refresh(): void {
    // MergeManager에 최신 컬럼 정의 전달 및 캐시 무효화
    if (this.mergeManager) {
      const columns = this.gridCore.getColumns();
      this.mergeManager.setColumns(columns);
      // 데이터 변경 시 MergeManager 캐시 무효화
      this.mergeManager.invalidateCache();
    }

    // 컬럼 정의 최신화 (피벗 등 동적 컬럼 변경 대응)
    this.columnDefs.clear();
    for (const col of this.gridCore.getColumns()) {
      this.columnDefs.set(col.key, col);
    }

    // VirtualRowBuilder 캐시 무효화
    // 데이터 변경 시 (특히 피벗 설정 변경 시) 캐시된 VirtualRows가
    // 이전 데이터를 참조하는 것을 방지
    this.virtualRowBuilder.invalidate();

    // RowPool 초기화: 이전 데이터가 남아있는 DOM 요소를 모두 제거
    // 피벗 설정 변경 시 컬럼 구조가 완전히 바뀌므로 기존 셀을 재활용할 수 없음
    this.rowPool.clear();

    this.updateVirtualRows();
    this.renderVisibleRows();
    this.renderPinnedRows(); // 고정 행도 다시 렌더링 (집계 재계산)
  }

  // ===========================================================================
  // 고정 행 API
  // ===========================================================================

  /**
   * 상단에 행 고정
   */
  pinRowTop(row: Row): void {
    this.pinnedTopRows.push(row);
    this.renderPinnedRows();
  }

  /**
   * 하단에 행 고정
   */
  pinRowBottom(row: Row): void {
    this.pinnedBottomRows.push(row);
    this.renderPinnedRows();
  }

  /**
   * 행 고정 해제 (상단/하단 모두 탐색)
   */
  unpinRow(rowId: string): boolean {
    // 상단에서 찾기
    let index = this.pinnedTopRows.findIndex(r => r.id === rowId);
    if (index !== -1) {
      this.pinnedTopRows.splice(index, 1);
      this.renderPinnedRows();
      return true;
    }
    // 하단에서 찾기
    index = this.pinnedBottomRows.findIndex(r => r.id === rowId);
    if (index !== -1) {
      this.pinnedBottomRows.splice(index, 1);
      this.renderPinnedRows();
      return true;
    }
    return false;
  }

  /**
   * 모든 고정 행 가져오기
   */
  getPinnedRows(): { top: Row[]; bottom: Row[] } {
    return {
      top: [...this.pinnedTopRows],
      bottom: [...this.pinnedBottomRows],
    };
  }

  /**
   * 모든 고정 행 제거
   */
  clearPinnedRows(): void {
    this.pinnedTopRows = [];
    this.pinnedBottomRows = [];
    this.renderPinnedRows();
  }

  /**
   * 고정 행 새로고침
   */
  refreshPinnedRows(): void {
    this.renderPinnedRows();
  }

  /**
   * 컬럼 상태 업데이트
   */
  updateColumns(columns: ColumnState[]): void {
    this.columns = columns;
    this.rowPool.updateColumnCount(columns.length);
    this.updateHorizontalSpacerWidth();
    this.updateHorizontalVirtualScroller(); // 가로 가상화 컬럼 업데이트
    this.renderVisibleRows();
    this.renderPinnedRows(); // 고정 행도 다시 렌더링
  }

  /**
   * 가로 스페이서 너비 업데이트 (컬럼 총 너비)
   */
  updateHorizontalSpacerWidth(): void {
    const totalWidth = this.columns
      .filter(col => col.visible)
      .reduce((sum, col) => sum + col.width, 0);
    this.spacerX.style.width = `${totalWidth}px`;

    // rowContainer와 고정 영역에도 전체 너비 설정 (가로 스크롤 범위 확보)
    this.rowContainer.style.minWidth = `${totalWidth}px`;
    this.pinnedTopContainer.style.minWidth = `${totalWidth}px`;
    this.pinnedBottomContainer.style.minWidth = `${totalWidth}px`;
  }

  /**
   * HorizontalVirtualScroller에 Center 컬럼 업데이트
   */
  private updateHorizontalVirtualScroller(): void {
    const columnGroups = this.getColumnGroups();
    this.horizontalVirtualScroller.setCenterColumns(columnGroups.center);
  }

  /**
   * 가로 가상화 활성화/비활성화
   */
  setHorizontalVirtualizationEnabled(enabled: boolean): void {
    this.horizontalVirtualScroller.setEnabled(enabled);
  }

  /**
   * 가로 가상화 활성화 여부
   */
  isHorizontalVirtualizationEnabled(): boolean {
    return this.horizontalVirtualScroller.isEnabled();
  }

  /**
   * HorizontalVirtualScroller 인스턴스 반환
   */
  getHorizontalVirtualScroller(): HorizontalVirtualScroller {
    return this.horizontalVirtualScroller;
  }

  /**
   * 현재 가로 가상화 범위 반환
   */
  getHorizontalVisibleRange(): HorizontalVirtualRange | null {
    return this.horizontalVirtualScroller.getVisibleRange();
  }

  /**
   * 특정 컬럼 너비 업데이트 (리사이즈 시 호출)
   */
  updateColumnWidth(columnKey: string, width: number): void {
    const col = this.columns.find(c => c.key === columnKey);
    if (col) {
      col.width = width;
      this.updateHorizontalSpacerWidth();
      // 가로 가상화 스크롤러에도 알림
      this.horizontalVirtualScroller.updateColumnWidth(columnKey, width);
    }
  }

  /**
   * 그룹화 설정
   *
   * 그룹화 depth에 따라 헤더 indent CSS 변수도 자동으로 업데이트됩니다.
   */
  setGroupingConfig(config: GroupingConfig | null): void {
    if (config) {
      this.groupManager.setConfig(config);
    } else {
      this.groupManager.setGroupColumns([]);
    }

    // VirtualRowBuilder 캐시 무효화
    this.virtualRowBuilder.invalidate();

    // 헤더 indent CSS 변수 자동 업데이트
    this.updateGroupIndentCSS(config?.columns?.length ?? 0);

    this.refresh();
  }

  /**
   * 그룹 indent CSS 변수 업데이트
   *
   * 상위 .ps-grid-container에 --ps-group-indent 변수를 설정합니다.
   */
  private updateGroupIndentCSS(depth: number): void {
    const gridContainer = this.container.closest('.ps-grid-container') as HTMLElement | null;
    if (gridContainer) {
      const indentPx = depth * 20; // 20px per level
      gridContainer.style.setProperty('--ps-group-indent', `${indentPx}px`);
    }
  }

  /**
   * 그룹 접기/펼치기
   */
  toggleGroup(groupId: string): void {
    this.groupManager.toggleGroup(groupId);
    this.refresh();
  }

  /**
   * 모든 그룹 펼치기
   */
  expandAllGroups(): void {
    this.groupManager.expandAll();
    this.refresh();
  }

  /**
   * 모든 그룹 접기
   */
  collapseAllGroups(): void {
    const data = this.gridCore.getVisibleData();
    this.groupManager.collapseAll(data);
    this.refresh();
  }

  /**
   * GroupManager 인스턴스 반환
   */
  getGroupManager(): GroupManager {
    return this.groupManager;
  }

  /**
   * 현재 virtualRows 반환 (SelectionManager 동기화용)
   *
   * 그룹화가 적용되면 그룹 헤더를 포함한 가상 행 배열을 반환합니다.
   */
  getVirtualRows(): VirtualRow[] {
    return this.virtualRows;
  }

  /**
   * Multi-Row 템플릿 설정
   */
  setRowTemplate(template: RowTemplate | null): void {
    this._rowTemplate = template;

    // RowPool에도 템플릿 설정 (구조 변경 시 풀 초기화됨)
    this.rowPool.setMultiRowTemplate(template);

    if (template) {
      this.multiRowRenderer = new MultiRowRenderer(
        template,
        this.columnDefs,
        this.rowHeight
      );
      // VirtualScroller에 렌더링용 높이 설정
      this.virtualScroller.setRenderRowHeight(this.multiRowRenderer.getTotalRowHeight());
    } else {
      this.multiRowRenderer = null;
      // 단일 행 높이로 복원
      this.virtualScroller.setRenderRowHeight(this.rowHeight);
    }

    // 활성 행 초기화 후 다시 렌더링
    this.rowPool.clear();
    this.refresh();
  }

  /**
   * Multi-Row 렌더러 반환
   */
  getMultiRowRenderer(): MultiRowRenderer | null {
    return this.multiRowRenderer;
  }

  /**
   * formatRow 콜백 설정
   *
   * 행이 렌더링될 때마다 호출되는 콜백을 설정합니다.
   * Wijmo의 formatItem보다 효율적입니다 (셀 단위가 아닌 행 단위).
   */
  setFormatRow(callback: FormatRowCallback | undefined): void {
    this.formatRow = callback;
    this.refresh(); // 콜백 변경 시 다시 렌더링
  }

  /**
   * formatRow 콜백 반환
   */
  getFormatRow(): FormatRowCallback | undefined {
    return this.formatRow;
  }

  /**
   * Multi-Row 모드인지 확인
   */
  isMultiRowMode(): boolean {
    return this.multiRowRenderer !== null;
  }

  /**
   * 행 상태 조회 콜백 설정 (ChangeTracker 연동)
   *
   * @param callback - 행 ID로 상태를 조회하는 콜백
   */
  setGetRowState(callback: BodyRendererOptions['getRowState']): void {
    this.getRowState = callback;
  }

  /**
   * 변경된 필드 조회 콜백 설정
   */
  setGetChangedFields(callback: BodyRendererOptions['getChangedFields']): void {
    this.getChangedFields = callback;
  }

  /**
   * Dirty State 콜백 설정 (ChangeTracker 연동)
   */
  setDirtyStateCallbacks(callbacks: {
    getAddedRows?: BodyRendererOptions['getAddedRows'];
    getModifiedRows?: BodyRendererOptions['getModifiedRows'];
    getDeletedRowIds?: BodyRendererOptions['getDeletedRowIds'];
  }): void {
    this.getAddedRows = callbacks.getAddedRows;
    this.getModifiedRows = callbacks.getModifiedRows;
    this.getDeletedRowIds = callbacks.getDeletedRowIds;
  }

  /**
   * 렌더링용 행 높이 설정
   *
   * 가변 높이 row를 지원할 때 사용합니다.
   * VirtualScroller의 visibleRowCount 계산에 사용됩니다.
   *
   * 참고: 인덱스 기반 스크롤을 사용하므로 spacer 높이는 변경되지 않습니다.
   */
  setRenderRowHeight(height: number): void {
    this.virtualScroller.setRenderRowHeight(height);
  }

  // ===========================================================================
  // 셀 병합 API (Merge Manager)
  // ===========================================================================

  /**
   * MergeManager 설정
   *
   * @param manager - MergeManager 인스턴스 (null이면 병합 해제)
   */
  setMergeManager(manager: MergeManager | null): void {
    this.mergeManager = manager;

    // MergeManager에 컬럼 정의 전달
    if (manager) {
      const columns = this.gridCore.getColumns();
      manager.setColumns(columns);
    }

    // 다시 렌더링
    this.refresh();
  }

  /**
   * MergeManager 반환
   */
  getMergeManager(): MergeManager | null {
    return this.mergeManager;
  }

  /**
   * 셀 병합 정보 조회 콜백 생성
   *
   * Row 렌더링 시 전달되는 getMergeInfo 콜백을 생성합니다.
   * MergeManager의 사전 계산된 캐시를 활용하여 O(1)로 조회합니다.
   *
   * **동적 앵커 로직**:
   * 실제 앵커(range.startRow)가 viewport 밖에 있으면,
   * 현재 보이는 범위 내 첫 번째 행을 "가상 앵커"로 만들어 표시합니다.
   * 이로써 병합 앵커가 스크롤 아웃되어도 병합 영역이 올바르게 표시됩니다.
   *
   * **성능 최적화**:
   * - MergeManager의 사전 계산 (O(n) 한 번) + 캐시 (O(1) 조회)
   * - 동적 앵커 변환은 간단한 조건문이므로 캐시 없이도 빠름
   */
  private createMergeInfoGetter(visibleStartIndex: number): MergeInfoGetter | undefined {
    if (!this.mergeManager) {
      return undefined;
    }

    // 필터/정렬이 적용된 데이터 사용
    const data = this.gridCore.getVisibleData();
    const manager = this.mergeManager;

    return (rowIndex: number, columnKey: string): CellMergeInfo => {
      // MergeManager에서 원본 병합 정보 조회 (O(1) - 사전 계산됨)
      const originalInfo = manager.getCellMergeInfo(rowIndex, columnKey, data);

      // 동적 앵커 로직 적용 (간단한 조건문)
      return this.applyDynamicAnchor(originalInfo, rowIndex, visibleStartIndex);
    };
  }

  /**
   * 동적 앵커 로직 적용
   *
   * 실제 앵커가 viewport 밖에 있으면, 보이는 범위 내 첫 번째 행을 가상 앵커로 변환합니다.
   */
  private applyDynamicAnchor(
    info: CellMergeInfo,
    rowIndex: number,
    visibleStartIndex: number
  ): CellMergeInfo {
    const { range } = info;

    // 병합이 없으면 그대로 반환
    if (!range) {
      return info;
    }

    // 실제 앵커가 보이는 범위 내에 있으면 원본 반환
    if (range.startRow >= visibleStartIndex) {
      return info;
    }

    // 현재 행이 병합 범위 내에 있는지 확인
    if (rowIndex < range.startRow || rowIndex > range.endRow) {
      return info;
    }

    // 실제 앵커가 viewport 밖 (위쪽) - 동적 앵커 필요
    // 현재 행이 "보이는 범위 내 첫 번째 병합 행"인지 확인
    const firstVisibleMergedRow = Math.max(range.startRow, visibleStartIndex);

    if (rowIndex === firstVisibleMergedRow) {
      // 가상 앵커로 변환
      // rowSpan은 남은 병합 범위만큼 (endRow - 현재행 + 1)
      const remainingRowSpan = range.endRow - rowIndex + 1;

      return {
        range,
        isAnchor: true,  // 가상 앵커
        rowSpan: remainingRowSpan,
        colSpan: info.colSpan,
      };
    } else {
      // 가상 앵커 아래의 행들 → hidden
      return {
        range,
        isAnchor: false,
        rowSpan: 1,
        colSpan: 1,
      };
    }
  }

  /**
   * 선택 상태 업데이트 (명시적 행 선택 - ID 기준)
   * 주의: 이 메서드 단독으로는 UI를 업데이트하지 않습니다.
   * updateCellSelection과 함께 호출되어야 합니다.
   */
  updateSelection(selectedRows: Set<string | number>): void {
    this.selectedRows = selectedRows;
    // 행 스타일은 updateCellSelection에서 통합 처리
  }

  /**
   * 셀 선택 상태 업데이트
   * 'all' 모드에서는 선택된 셀이 있는 행도 함께 하이라이트됩니다.
   * 'range' 모드에서는 셀만 하이라이트되고 행은 건드리지 않습니다.
   *
   * 셀 키 형식: "dataIndex:columnKey" (그룹화 시에도 실제 데이터 인덱스 사용)
   */
  updateCellSelection(selectedCells: Set<string>): void {
    this.selectedCells = selectedCells;

    // 'range' 모드가 아닐 때만 행 하이라이트 (all 모드에서만 행도 선택)
    if (this.selectionMode !== 'range') {
      // 선택된 셀에서 dataIndex 추출
      this.selectedRowIndices.clear();
      for (const cellKey of selectedCells) {
        const dataIndex = parseInt(cellKey.split(':')[0] ?? '', 10);
        if (!isNaN(dataIndex)) {
          this.selectedRowIndices.add(dataIndex);
        }
      }
      this.updateCombinedRowSelectionStyles();
    } else {
      // range 모드: 행 선택 초기화 (셀만 선택)
      this.selectedRowIndices.clear();
      this.updateCombinedRowSelectionStyles();
    }

    this.updateCellSelectionStyles();
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    this.virtualScroller.scrollToRow(rowIndex);
  }

  /**
   * Viewport 요소 반환 (스크롤 동기화용)
   */
  getViewport(): HTMLElement {
    return this.viewport;
  }

  /**
   * Viewport 크기 변경 처리
   */
  handleResize(): void {
    this.virtualScroller.updateViewportSize();
  }

  /**
   * VirtualScroller 인스턴스 반환 (자동 스크롤용)
   */
  getVirtualScroller(): VirtualScroller {
    return this.virtualScroller;
  }

  /**
   * 컬럼 상태 반환
   */
  getColumnStates(): ColumnState[] {
    return this.columns;
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    // 드래그 이벤트 정리
    this.cleanupDragEvents();
    this.stopAutoScroll();

    this.virtualScroller.destroy();
    this.horizontalVirtualScroller.destroy();
    this.rowPool.destroy();
    this.container.innerHTML = '';
  }

  // ===========================================================================
  // 렌더링 (Private)
  // ===========================================================================

  /**
   * VirtualRows 업데이트
   *
   * 필터/정렬이 적용된 데이터를 기반으로 VirtualRows를 생성합니다.
   * VirtualRowBuilder를 사용하여 통합된 방식으로 처리합니다.
   * ChangeTracker의 pending 변경사항을 병합합니다.
   */
  private updateVirtualRows(): void {
    // Worker 모드 처리: 데이터가 비동기로 로드되므로, 행 수만으로 가상 행 생성
    if (this.gridCore.isUsingWorker()) {
      const rowCount = this.gridCore.getVisibleRowCount();

      // 가상 행 생성 (데이터는 페칭 전까지 비어있음)
      this.virtualRows = Array.from({ length: rowCount }, (_, i) => ({
        type: 'data',
        rowId: `virtual-${i}`, // 임시 ID
        dataIndex: i, // IndexManager 기준 인덱스
        data: {} as RowData, // 로딩 전 빈 데이터
        groupPath: [],
        rowState: 'pristine',
      }));

      // Multi-Row 모드인 경우에도 totalRows 설정
      this.virtualScroller.setTotalRows(rowCount);
      return;
    }

    // Flat/Grouped 모드 (Main Thread): 기존 로직 유지
    // 필터/정렬이 적용된 데이터 사용
    const baseData = this.gridCore.getVisibleData();

    // ChangeTracker의 pending 변경사항 병합
    const data = this.mergeChangeTrackerData(baseData);

    // VirtualRowBuilder를 통해 VirtualRow[] 생성
    if (this.groupManager.hasGrouping()) {
      // 그룹화 모드
      this.virtualRows = this.virtualRowBuilder.build({
        type: 'grouped',
        data,
        groupTree: this.groupManager.buildTree(data),
        collapsedSet: this.groupManager.getCollapsedSet(),
        aggregates: this.groupManager.getAggregates(),
        dataVersion: 1, // TODO: DataStore.version 연동
      });
    } else {
      // Flat 모드
      this.virtualRows = this.virtualRowBuilder.build({
        type: 'flat',
        data,
        dataVersion: 1, // TODO: DataStore.version 연동
      });
    }

    // Multi-Row 모드에서는 총 행 수가 달라짐
    // (데이터 수가 아닌, 가상 행 수 × Multi-Row 템플릿 rowCount)
    // VirtualScroller는 여전히 "데이터 행" 수로 관리하고,
    // 렌더링 시에만 여러 visual row를 그림
    this.virtualScroller.setTotalRows(this.virtualRows.length);
  }

  /**
   * ChangeTracker의 pending 변경사항을 데이터에 병합
   *
   * - 추가된 행 삽입
   * - 수정된 셀 값 적용
   * - 삭제된 행 제외 (deleted 상태는 표시하되 스타일로 구분)
   */
  private mergeChangeTrackerData(baseData: RowData[]): RowData[] {
    // 콜백이 없으면 원본 데이터 그대로 반환
    if (!this.getAddedRows && !this.getModifiedRows && !this.getDeletedRowIds) {
      return baseData;
    }

    const addedRows = this.getAddedRows?.() ?? new Map();
    const modifiedRows = this.getModifiedRows?.() ?? new Map();
    const deletedRowIds = this.getDeletedRowIds?.() ?? new Set();

    // 변경사항이 없으면 원본 데이터 반환
    if (addedRows.size === 0 && modifiedRows.size === 0 && deletedRowIds.size === 0) {
      return baseData;
    }

    // 결과 배열 생성
    const result: RowData[] = [];

    // 1. 기존 데이터 처리 (수정된 값 적용, 삭제된 행은 유지하되 표시)
    for (const row of baseData) {
      const rowId = row['id'] as string | number | undefined;

      if (rowId !== undefined) {
        // 수정된 행이면 currentData 사용
        const modified = modifiedRows.get(rowId);
        if (modified) {
          result.push(modified.currentData);
          continue;
        }
      }

      // 원본 데이터 사용 (삭제된 행도 포함 - CSS로 표시)
      result.push(row);
    }

    // 2. 추가된 행 삽입 (insertIndex 기준)
    // insertIndex 순서대로 정렬하여 삽입
    const addedRowsArray = Array.from(addedRows.values())
      .sort((a, b) => a.insertIndex - b.insertIndex);

    for (const addedRow of addedRowsArray) {
      // insertIndex가 현재 길이보다 크면 끝에 추가
      const insertAt = Math.min(addedRow.insertIndex, result.length);
      result.splice(insertAt, 0, addedRow.data);
    }

    return result;
  }

  /**
   * Multi-Row 모드에서 사용할 실제 행 높이
   */
  private getEffectiveRowHeight(): number {
    if (this.multiRowRenderer) {
      return this.multiRowRenderer.getTotalRowHeight();
    }
    return this.rowHeight;
  }

  /**
   * 보이는 행 렌더링
   */
  private renderVisibleRows(): void {
    const state = this.virtualScroller.getState();

    // Worker 모드: 데이터 비동기 페칭 요청
    if (this.gridCore.isUsingWorker()) {
      // 현재 범위의 데이터가 캐시에 있는지 확인하고, 없으면 요청
      this.gridCore.getVisibleRowsAsync(state.startIndex, state.endIndex)
        .then(() => {
          // 데이터가 로드되면 강제 렌더링 (여기서 무한 루프 방지가 중요)
          // 하지만 getVisibleRowsAsync는 캐시에 있으면 즉시 반환하므로,
          // 렌더링 루프 내에서 호출하지 않고, 별도의 완료 콜백으로 처리해야 함.
          // 여기서는 '데이터 로드 후 렌더링'을 위해 refresh() 호출 X (너무 잦은 호출 방지)
          // 대신 rowCache.get으로 가져와서 렌더링하므로, 다음 프레임이나 스크롤 이벤트에서 자연스럽게 렌더링됨.
          // 단, 최초 로드 시에는 명시적 업데이트가 필요할 수 있음.

          // 누락된 데이터가 채워졌는지 확인하고, 필요한 경우에만 제한적으로 렌더링 업데이트
          // (구현 복잡도상 일단 생략하고, 스크롤 이벤트에 맡김.
          //  단, 멈춰있을 때 로드 완료되면 안 보일 수 있으니 1회 재시도)
          // requestAnimationFrame(() => this.renderPinnedRows()); // 화면 갱신 유도
        })
        .catch(console.error);
    }

    const columnGroups = this.getColumnGroups();
    const totalRowCount = this.virtualRows.length;

    // Multi-Row 모드
    if (this.multiRowRenderer) {
      this.renderMultiRowMode(state, totalRowCount);
      return;
    }

    // 병합 정보 조회 콜백 생성 (동적 앵커를 위해 visibleStartIndex 전달)
    // MergeManager가 사전 계산된 캐시를 가지므로 추가 캐시 불필요
    const getMergeInfo = this.createMergeInfoGetter(state.startIndex);

    // 가로 가상화 범위 가져오기
    const horizontalVirtualRange = this.horizontalVirtualScroller.getVisibleRange() ?? undefined;

    // 렌더링 컨텍스트 생성
    const baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'> = {
      columns: this.columns,
      columnGroups,
      columnDefs: this.columnDefs,
      rowHeight: this.rowHeight,
      gridCore: this.gridCore,
      getMergeInfo,
      horizontalVirtualRange,
    };

    // 일반 모드
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);
    let dirty = false; // 데이터가 로딩되어 다시 그려야 하는지 여부

    for (const [rowIndex, rowElement] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      let virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow) continue;

      // Worker 모드: 실제 데이터 주입
      if (this.gridCore.isUsingWorker() && virtualRow.type === 'data') {
        const realRow = this.gridCore.getRowByVisibleIndex(rowIndex);
        if (realRow) {
          // 데이터가 있으면 가상 행 객체에 주입
          const rowId = (realRow['id'] as string | number) ?? virtualRow.rowId;
          virtualRow = {
            ...virtualRow,
            data: realRow,
            rowId: String(rowId)
          };
          // virtualRows 배열에도 반영 (다음 렌더링에서 재사용)
          this.virtualRows[rowIndex] = virtualRow;
        } else {
          // 데이터가 없으면 로딩 중 표시 필요 (스타일 등)
          // 일단 빈 데이터로 렌더링되거나 스킵
          dirty = true; // 데이터가 비어있으므로 로딩 완료 후 다시 그려야 함
        }
      }

      // VirtualRow 타입에 따라 Row 인스턴스 생성 및 렌더링
      if (virtualRow.type === 'group-header') {
        this.renderGroupHeaderRow(rowElement, rowIndex, virtualRow as GroupHeaderRow, baseContext);
      } else if (virtualRow.type === 'data') {
        this.renderDataRowWithRowClass(rowElement, rowIndex, virtualRow as DataRow, baseContext);
      }
      // TODO: group-footer, subtotal, grand-total 행 렌더링 (향후 구현)
    }

    // 데이터가 누락되어 있다면 (로딩 중), 로드 완료 후 다시 그리기
    if (dirty && this.gridCore.isUsingWorker()) {
      this.gridCore.getVisibleRowsAsync(state.startIndex, state.endIndex)
        .then(() => {
          // 데이터 로드 완료 시 재렌더링
          // dirty 플래그 덕분에 데이터가 모두 로드되면 루프가 종료됨
          requestAnimationFrame(() => this.renderVisibleRows());
        })
        .catch(console.error);
    }
  }

  /**
   * Multi-Row 모드 렌더링
   *
   * RowPool을 사용하여 컨테이너를 재활용합니다.
   * 스크롤 시 DOM 생성을 최소화하여 성능을 개선합니다.
   * Row 클래스 인스턴스를 생성하여 MultiRowRenderer에 전달합니다.
   */
  private renderMultiRowMode(
    state: { startIndex: number; endIndex: number },
    totalRowCount: number
  ): void {
    if (!this.multiRowRenderer) return;

    // RowPool을 사용하여 보이는 범위의 행 컨테이너 획득/반환
    const activeRows = this.rowPool.updateVisibleRange(state.startIndex, state.endIndex);

    for (const [rowIndex, container] of activeRows) {
      if (rowIndex >= totalRowCount) {
        this.rowPool.release(rowIndex);
        continue;
      }

      const virtualRow = this.virtualRows[rowIndex];
      if (!virtualRow || virtualRow.type !== 'data') continue;

      // 청크 내 상대 위치 (청크 기반 네이티브 스크롤용)
      const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);

      // Row 인스턴스 생성 (Row는 데이터만 보유, MultiRowRenderer가 스타일링)
      // __pivotType에 따라 variant 결정
      const pivotType = (virtualRow.data as Record<string, unknown>)['__pivotType'] as string | undefined;
      const variant = pivotType === 'subtotal' ? 'subtotal'
        : pivotType === 'grandtotal' ? 'grandtotal'
          : 'data';

      const row = new Row({
        structural: pivotType === 'subtotal' || pivotType === 'grandtotal',
        variant,
        data: virtualRow.data as Record<string, unknown>,
      });

      // MultiRowRenderer를 통해 렌더링
      this.multiRowRenderer.renderRow(
        row,
        container,
        virtualRow.dataIndex,
        offsetY
      );
    }
  }

  /**
   * 고정 행 렌더링
   *
   * 상단/하단 고정 영역에 Row 인스턴스를 렌더링합니다.
   * 가상화가 필요 없으므로 모든 행을 직접 렌더링합니다.
   */
  private renderPinnedRows(): void {
    const columnGroups = this.getColumnGroups();
    const horizontalVirtualRange = this.horizontalVirtualScroller.getVisibleRange() ?? undefined;
    const baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'> = {
      columns: this.columns,
      columnGroups,
      columnDefs: this.columnDefs,
      rowHeight: this.rowHeight,
      gridCore: this.gridCore,
      horizontalVirtualRange,
    };

    // 상단 고정 행 렌더링
    this.renderPinnedContainer(
      this.pinnedTopContainer,
      this.pinnedTopRows,
      baseContext,
      'top'
    );

    // 하단 고정 행 렌더링
    this.renderPinnedContainer(
      this.pinnedBottomContainer,
      this.pinnedBottomRows,
      baseContext,
      'bottom'
    );
  }

  /**
   * 고정 영역 컨테이너 렌더링
   */
  private renderPinnedContainer(
    container: HTMLElement,
    rows: Row[],
    baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'>,
    position: 'top' | 'bottom'
  ): void {
    // 기존 행 요소 가져오기
    const existingElements = Array.from(container.children) as HTMLElement[];

    // 행 수에 맞게 DOM 요소 조정
    while (existingElements.length > rows.length) {
      container.lastChild?.remove();
      existingElements.pop();
    }
    while (existingElements.length < rows.length) {
      const rowElement = document.createElement('div');
      rowElement.className = 'ps-row ps-pinned-row';
      container.appendChild(rowElement);
      existingElements.push(rowElement);
    }

    // 각 행 렌더링
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowElement = existingElements[i];
      if (!row || !rowElement) continue;

      // 데이터 속성 설정
      rowElement.dataset['rowId'] = row.id;
      rowElement.dataset['pinned'] = position;
      rowElement.dataset['pinnedIndex'] = String(i);

      // 위치 설정 (고정 영역은 transform 불필요, 상대 위치)
      rowElement.style.position = 'relative';
      rowElement.style.height = `${row.getHeight(this.rowHeight)}px`;

      // 렌더링 컨텍스트
      const context: RowRenderContext = {
        ...baseContext,
        rowIndex: i, // 고정 영역 내 인덱스
      };

      // Row 렌더링
      row.render(rowElement, context);
    }

    // 컨테이너 높이 업데이트
    const totalHeight = rows.reduce((sum, row) => sum + row.getHeight(this.rowHeight), 0);
    container.style.height = totalHeight > 0 ? `${totalHeight}px` : '0';
    container.style.display = rows.length > 0 ? 'block' : 'none';
  }

  /**
   * 그룹 헤더 행 렌더링 (Row 클래스 사용)
   */
  private renderGroupHeaderRow(
    rowElement: HTMLElement,
    rowIndex: number,
    groupRow: GroupHeaderRow,
    baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'>
  ): void {
    // 청크 내 상대 위치 설정 (청크 기반 네이티브 스크롤용)
    const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 데이터 속성 설정 (BodyRenderer 책임)
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['groupId'] = groupRow.groupId;
    rowElement.dataset['rowType'] = 'group-header';
    // 이전에 데이터 행으로 사용된 DOM 요소의 dataIndex 제거 (재사용 시 잘못된 선택 방지)
    delete rowElement.dataset['dataIndex'];
    rowElement.classList.remove('ps-selected');

    // Row 인스턴스 생성
    const row = new Row({
      structural: true,
      variant: 'group-header',
      group: {
        id: groupRow.groupId,
        level: groupRow.level,
        path: groupRow.path.map(p => String(p.value)),
        value: groupRow.value,
        column: groupRow.column,
        collapsed: groupRow.collapsed,
        itemCount: groupRow.itemCount,
        aggregates: groupRow.aggregates,
      },
    });

    // 렌더링 컨텍스트 완성
    const context: RowRenderContext = {
      ...baseContext,
      rowIndex,
    };

    // Row 클래스로 렌더링 위임
    row.render(rowElement, context);

    // formatRow 콜백 호출
    this.invokeFormatRowForGroupHeader(rowElement, rowIndex, groupRow);
  }


  /**
   * 데이터 행 렌더링 (Row 클래스 사용)
   */
  private renderDataRowWithRowClass(
    rowElement: HTMLElement,
    rowIndex: number,
    dataRow: DataRow,
    baseContext: Omit<RowRenderContext, 'rowIndex' | 'dataIndex'>
  ): void {
    const rowData = dataRow.data;

    // 청크 내 상대 위치 설정 (청크 기반 네이티브 스크롤용)
    const offsetY = this.virtualScroller.getRowOffsetInChunk(rowIndex);
    rowElement.style.transform = `translateY(${offsetY}px)`;

    // 데이터 속성 (BodyRenderer 책임)
    rowElement.dataset['rowIndex'] = String(rowIndex);
    rowElement.dataset['dataIndex'] = String(dataRow.dataIndex);
    rowElement.dataset['rowType'] = 'data';
    const rawRowId = rowData['id'];
    // rowId는 string 또는 number만 유효 (boolean, Date, null 제외)
    const rowId = typeof rawRowId === 'string' || typeof rawRowId === 'number' ? rawRowId : undefined;
    if (rowId !== undefined) {
      rowElement.dataset['rowId'] = String(rowId);
    }
    delete rowElement.dataset['groupId'];

    // 선택 상태 (BodyRenderer 책임)
    // dataIndex 기준으로 체크 (rowIndex는 뷰 인덱스이므로 그룹화 시 잘못된 행이 선택됨)
    const isSelectedByCell = this.selectedRowIndices.has(dataRow.dataIndex);
    const isSelectedByRow = rowId !== undefined && this.selectedRows.has(rowId);
    rowElement.classList.toggle('ps-selected', isSelectedByCell || isSelectedByRow);

    // 그룹 레벨에 따른 들여쓰기 (CSS 변수로 설정)
    const indentLevel = dataRow.groupPath.length;
    rowElement.style.setProperty('--ps-group-indent', `${indentLevel * 20}px`);

    // Row 인스턴스 생성
    // __pivotType에 따라 variant 결정 (피벗 부분합/총합계)
    const pivotType = (rowData as Record<string, unknown>)['__pivotType'] as
      | string
      | undefined;

    // FIX: 피벗 행도 값 렌더링을 위해 'data' variant 사용
    // PivotProcessor가 이미 값을 계산해서 rowData에 넣어두었으므로,
    // renderAggregate 대신 renderData를 사용하여 그 값을 그대로 표시해야 함
    const variant = 'data';

    // 스타일을 위한 클래스 추가
    let className = '';
    if (pivotType === 'subtotal') {
      className = 'ps-row-subtotal';
    } else if (pivotType === 'grandtotal') {
      className = 'ps-row-grandtotal';
    }

    const row = new Row({
      structural: pivotType === 'subtotal' || pivotType === 'grandtotal',
      variant,
      data: rowData as Record<string, unknown>,
      className, // 생성자로 전달
    });

    // 렌더링 컨텍스트 완성
    const context: RowRenderContext = {
      ...baseContext,
      rowIndex,
      dataIndex: dataRow.dataIndex,
    };

    // Row 클래스로 렌더링 위임
    row.render(rowElement, context);

    // 셀에 dataIndex 부여 및 선택 상태 적용 (Row 렌더링 후)
    this.applyCellDataIndexAndSelection(rowElement, dataRow.dataIndex);

    // Dirty State CSS 클래스 적용 (ChangeTracker에서 실시간 조회)
    let effectiveRowState = dataRow.rowState;
    if (this.getRowState && rowId !== undefined) {
      effectiveRowState = this.getRowState(rowId);
    }
    this.applyRowStateClass(rowElement, effectiveRowState);

    // 수정된 셀에 CSS 클래스 적용 (ChangeTracker에서 실시간 조회)
    if (rowId !== undefined) {
      this.applyCellModifiedClass(rowElement, rowId);
    }

    // formatRow 콜백 호출
    this.invokeFormatRowForData(rowElement, rowIndex, dataRow);
  }

  /**
   * 행 상태에 따른 CSS 클래스 적용
   */
  private applyRowStateClass(rowElement: HTMLElement, rowState?: RowState): void {
    // 기존 상태 클래스 제거
    rowElement.classList.remove('ps-row-added', 'ps-row-modified', 'ps-row-deleted');

    // 새 상태 클래스 적용
    if (rowState === 'added') {
      rowElement.classList.add('ps-row-added');
    } else if (rowState === 'modified') {
      rowElement.classList.add('ps-row-modified');
    } else if (rowState === 'deleted') {
      rowElement.classList.add('ps-row-deleted');
    }
  }

  /**
   * 수정된 셀에 CSS 클래스 적용
   */
  private applyCellModifiedClass(rowElement: HTMLElement, rowId: string | number): void {
    // 변경된 필드 조회
    const changedFields = this.getChangedFields?.(rowId);

    const cells = rowElement.querySelectorAll('.ps-cell');
    cells.forEach((cell) => {
      const el = cell as HTMLElement;
      const columnKey = el.dataset['columnKey'];

      if (columnKey) {
        const isModified = changedFields?.has(columnKey) ?? false;
        el.classList.toggle('ps-cell-modified', isModified);
        // DOM 재사용 시 남아있을 수 있는 편집 상태 클래스 제거
        el.classList.remove('ps-editing');
      }
    });
  }

  /**
   * 셀에 dataIndex 부여 및 선택 상태 적용 (Row 렌더링 후 호출)
   *
   * 그룹화 시 dataIndex가 실제 데이터의 인덱스이므로,
   * 이를 기준으로 선택 상태를 확인합니다.
   */
  private applyCellDataIndexAndSelection(rowElement: HTMLElement, dataIndex: number): void {
    const cells = rowElement.querySelectorAll('.ps-cell');
    cells.forEach((cell) => {
      const el = cell as HTMLElement;
      // 셀에 dataIndex 부여
      el.dataset['dataIndex'] = String(dataIndex);

      const columnKey = el.dataset['columnKey'];
      if (columnKey) {
        // dataIndex 기반으로 선택 상태 확인
        const cellKey = `${dataIndex}:${columnKey}`;
        const isSelected = this.selectedCells.has(cellKey);
        el.classList.toggle('ps-cell-selected', isSelected);
      }
    });
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * VirtualScroller의 rangeChanged 이벤트 처리
   */
  private onRangeChanged(_range: { startIndex: number; endIndex: number }): void {
    this.renderVisibleRows();
  }

  /**
   * HorizontalVirtualScroller의 rangeChanged 이벤트 처리
   */
  private onHorizontalRangeChanged(_range: HorizontalVirtualRange): void {
    // 가로 가상화 범위 변경 시 행 다시 렌더링
    this.renderVisibleRows();
    this.renderPinnedRows(); // 고정 행도 다시 렌더링
  }

  /**
   * 클릭 이벤트 처리
   */
  private handleClick(event: MouseEvent): void {
    // 드래그 직후 클릭은 무시 (드래그에서 이미 처리됨)
    if (this.justFinishedDrag) {
      this.justFinishedDrag = false;
      return;
    }

    const target = event.target as HTMLElement;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!row) return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    // 그룹 헤더 클릭 처리
    const rowType = row.dataset['rowType'];
    if (rowType === 'group-header') {
      const groupId = row.dataset['groupId'];
      if (groupId) {
        this.toggleGroup(groupId);
        if (this.onGroupToggle) {
          this.onGroupToggle(groupId, this.groupManager.isCollapsed(groupId));
        }
      }
      return;
    }

    // 데이터 행 처리
    const virtualRow = this.virtualRows[rowIndex];
    if (!virtualRow || virtualRow.type !== 'data') return;

    const rowData = virtualRow.data;
    const cell = target.closest('.ps-cell') as HTMLElement | null;

    // 셀 클릭
    if (cell && this.onCellClick) {
      const columnKey = cell.dataset['columnKey'];
      if (columnKey) {
        const value = rowData[columnKey];
        this.onCellClick({ rowIndex, columnKey, dataIndex: virtualRow.dataIndex }, value, event);
      }
    }

    // 행 클릭 (viewIndex와 dataIndex 모두 전달)
    if (this.onRowClick) {
      this.onRowClick(rowIndex, rowData, event, virtualRow.dataIndex);
    }
  }

  /**
   * 더블클릭 이벤트 처리
   */
  private handleDblClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cell = target.closest('.ps-cell') as HTMLElement | null;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!row || !cell) return;

    // 그룹 헤더는 더블클릭 무시
    if (row.dataset['rowType'] === 'group-header') return;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    if (rowIndex < 0) return;

    const columnKey = cell.dataset['columnKey'];
    if (!columnKey) return;

    const virtualRow = this.virtualRows[rowIndex];
    if (!virtualRow || virtualRow.type !== 'data') return;

    if (this.onCellDblClick) {
      const value = virtualRow.data[columnKey];
      this.onCellDblClick({ rowIndex, columnKey }, value, event);
    }
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 그룹 분류 (Left, Center, Right)
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

    // 순서대로 정렬
    const sortByOrder = (a: ColumnState, b: ColumnState) => a.order - b.order;
    left.sort(sortByOrder);
    center.sort(sortByOrder);
    right.sort(sortByOrder);

    return { left, center, right };
  }

  // ==========================================================================
  // formatRow 호출
  // ==========================================================================

  /**
   * 데이터 행에 대해 formatRow 콜백 호출
   */
  private invokeFormatRowForData(
    rowElement: HTMLElement,
    rowIndex: number,
    dataRow: DataRow
  ): void {
    if (!this.formatRow) return;

    // 셀 정보 수집
    const cells: Record<string, CellInfo> = {};
    const cellElements = rowElement.querySelectorAll('.ps-cell');

    cellElements.forEach((cellEl) => {
      const el = cellEl as HTMLElement;
      const columnKey = el.dataset['columnKey'];
      if (columnKey) {
        const value = dataRow.data[columnKey];
        const originalValue = dataRow.originalData?.[columnKey];
        const isModified = dataRow.changedFields?.has(columnKey) ?? false;

        cells[columnKey] = {
          element: el,
          value,
          originalValue,
          isModified,
        };
      }
    });

    // 그룹 경로를 string[]로 변환
    const groupPath = dataRow.groupPath.map((g) => String(g.value));

    // 컨텍스트 생성
    const ctx: DataRowContext = {
      viewIndex: rowIndex,
      dataIndex: dataRow.dataIndex,
      rowId: dataRow.rowId,
      data: dataRow.data,
      groupPath,
      rowState: dataRow.rowState ?? 'pristine',
      originalData: dataRow.originalData,
      changedFields: dataRow.changedFields,
      rowElement,
      cells,
    };

    // 콜백 호출
    this.formatRow({ type: 'data', ctx });
  }

  /**
   * 그룹 헤더에 대해 formatRow 콜백 호출
   */
  private invokeFormatRowForGroupHeader(
    rowElement: HTMLElement,
    rowIndex: number,
    groupRow: GroupHeaderRow
  ): void {
    if (!this.formatRow) return;

    const ctx: GroupHeaderContext = {
      viewIndex: rowIndex,
      groupId: groupRow.groupId,
      column: groupRow.column,
      value: groupRow.value,
      level: groupRow.level,
      itemCount: groupRow.itemCount,
      collapsed: groupRow.collapsed,
      aggregates: groupRow.aggregates,
      element: rowElement,
    };

    this.formatRow({ type: 'group-header', ctx });
  }

  /**
   * 통합 행 선택 스타일 업데이트
   * - selectedRows: 명시적 행 선택 (행 ID 기준)
   * - selectedRowIndices: 셀 선택에서 파생된 행 (dataIndex 기준)
   */
  private updateCombinedRowSelectionStyles(): void {
    for (const [_viewIndex, rowElement] of this.rowPool.getActiveRows()) {
      // dataIndex 추출 (셀 또는 행에서)
      const dataIndexStr = rowElement.dataset['dataIndex'];
      const dataIndex = dataIndexStr !== undefined ? parseInt(dataIndexStr, 10) : undefined;

      // 1. 셀 선택에서 파생된 행 체크 (dataIndex 기준)
      let isSelected = dataIndex !== undefined && this.selectedRowIndices.has(dataIndex);

      // 2. 명시적 행 선택 (ID 기준) 체크
      if (!isSelected && this.selectedRows.size > 0) {
        const rowId = rowElement.dataset['rowId'];
        if (rowId !== undefined) {
          const numericId = parseInt(rowId, 10);
          isSelected = this.selectedRows.has(rowId) || (!isNaN(numericId) && this.selectedRows.has(numericId));
        }
      }

      rowElement.classList.toggle('ps-selected', isSelected);
    }
  }

  /**
   * DOM 요소 생성 헬퍼
   */
  private createElement(tag: string, className: string): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  }

  // ===========================================================================
  // 드래그 선택 (Drag Selection)
  // ===========================================================================

  /**
   * 마우스 다운 이벤트 처리 (드래그 준비)
   */
  private handleMouseDown(event: MouseEvent): void {
    // 왼쪽 버튼만 처리
    if (event.button !== 0) return;

    // 에디터 내부 요소에서는 드래그 선택 안함 (텍스트 선택, spinner 조작 허용)
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.closest('.ps-editing')
    ) {
      return;
    }

    // 편집 중인 에디터가 있으면 blur 트리거하여 편집 종료
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT' || activeElement.tagName === 'TEXTAREA')) {
      activeElement.blur();
    }

    // 셀에서 시작했는지 확인
    const cellPosition = this.getCellPositionFromEvent(event);
    if (!cellPosition) return;

    // 그룹 헤더에서는 드래그 선택 안함
    const rowTarget = event.target as HTMLElement;
    const row = rowTarget.closest('.ps-row') as HTMLElement | null;
    if (row?.dataset['rowType'] === 'group-header') return;

    // 드래그 준비 (아직 실제 드래그 시작 아님)
    this.isDragging = true;
    this.isActualDrag = false;  // 셀이 바뀌기 전까지는 클릭으로 간주
    this.dragStartPosition = cellPosition;
    this.lastDragColumnKey = cellPosition.columnKey;
    this.dragStartEvent = event;  // 이벤트 저장 (나중에 드래그 시작 시 사용)

    // 전역 이벤트 리스너 등록 (viewport 밖에서도 드래그 추적)
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);

    // 텍스트 선택 방지
    event.preventDefault();
  }

  /**
   * 마우스 이동 이벤트 처리 (드래그 중)
   *
   * 그룹 헤더 위에서는 선택을 업데이트하지 않고 마지막 유효한 위치를 유지합니다.
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStartPosition) return;

    // 현재 마우스 위치에서 셀 위치 계산
    const cellPosition = this.getCellPositionFromMousePosition(event);
    if (!cellPosition) return;

    // 그룹 헤더 위인지 확인 (dataIndex가 없으면 그룹 헤더)
    const isOverGroupHeader = cellPosition.dataIndex === undefined;

    // 셀이 바뀌었는지 확인 (dataIndex 기준, 그룹 헤더 제외)
    const startDataIndex = this.dragStartPosition.dataIndex;
    const cellChanged = !isOverGroupHeader && (
      cellPosition.dataIndex !== startDataIndex ||
      cellPosition.columnKey !== this.dragStartPosition.columnKey
    );

    if (!this.isActualDrag && cellChanged) {
      // 처음으로 다른 데이터 셀로 이동 → 실제 드래그 시작
      this.isActualDrag = true;

      // 드래그 시작 콜백 호출 (저장해둔 이벤트로)
      if (this.onDragSelectionStart && this.dragStartEvent) {
        this.onDragSelectionStart(this.dragStartPosition, this.dragStartEvent);
      }
    }

    // 실제 드래그 중일 때만 업데이트
    if (this.isActualDrag) {
      // 마지막 컬럼 키 저장 (자동 스크롤 시 사용)
      this.lastDragColumnKey = cellPosition.columnKey;

      // 그룹 헤더 위에서는 콜백 호출 건너뜀 (마지막 유효한 선택 유지)
      if (!isOverGroupHeader && this.onDragSelectionUpdate) {
        this.onDragSelectionUpdate(cellPosition);
      }

      // 자동 스크롤 체크 (그룹 헤더 위에서도 동작)
      this.checkAutoScroll(event);
    }
  }

  /**
   * 마우스 업 이벤트 처리 (드래그 종료)
   */
  private handleMouseUp(_event: MouseEvent): void {
    if (!this.isDragging) return;

    const wasDragging = this.isActualDrag;

    this.isDragging = false;
    this.isActualDrag = false;
    this.dragStartPosition = null;
    this.lastDragColumnKey = null;
    this.dragStartEvent = null;

    // 자동 스크롤 중지
    this.stopAutoScroll();

    // 실제 드래그했을 때만 드래그 종료 콜백 호출
    // (클릭만 한 경우는 click 이벤트에서 처리)
    if (wasDragging) {
      this.justFinishedDrag = true;  // 클릭 이벤트 무시용 플래그
      if (this.onDragSelectionEnd) {
        this.onDragSelectionEnd();
      }
    }

    // 전역 이벤트 리스너 제거
    this.cleanupDragEvents();
  }

  /**
   * 드래그 이벤트 정리
   */
  private cleanupDragEvents(): void {
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  /**
   * 이벤트에서 셀 위치 추출
   *
   * dataIndex를 포함하여 반환합니다. 그룹 헤더인 경우 dataIndex가 undefined입니다.
   */
  private getCellPositionFromEvent(event: MouseEvent): CellPosition | null {
    const target = event.target as HTMLElement;
    const cell = target.closest('.ps-cell') as HTMLElement | null;
    const row = target.closest('.ps-row') as HTMLElement | null;

    if (!cell || !row) return null;

    const rowIndex = parseInt(row.dataset['rowIndex'] ?? '-1', 10);
    const columnKey = cell.dataset['columnKey'];

    if (rowIndex < 0 || !columnKey) return null;

    // dataIndex 추출 (셀 또는 행에서)
    const dataIndexStr = cell.dataset['dataIndex'] ?? row.dataset['dataIndex'];
    const dataIndex = dataIndexStr !== undefined ? parseInt(dataIndexStr, 10) : undefined;

    return { rowIndex, columnKey, dataIndex };
  }

  /**
   * 마우스 좌표에서 셀 위치 계산 (viewport 밖에서도 동작)
   *
   * dataIndex를 포함하여 반환합니다. 그룹 헤더인 경우 dataIndex가 undefined입니다.
   */
  private getCellPositionFromMousePosition(event: MouseEvent): CellPosition | null {
    const viewportRect = this.viewport.getBoundingClientRect();
    const effectiveRowHeight = this.getEffectiveRowHeight();

    // 마우스 Y 좌표 → 행 인덱스
    // viewport 내부의 Y 좌표 (음수면 위, viewportHeight 초과면 아래)
    const viewportY = event.clientY - viewportRect.top;

    // 현재 보이는 첫 번째 행 인덱스 기준으로 계산
    const visibleStartIndex = this.virtualScroller.getVisibleStartIndex();
    let rowIndex = visibleStartIndex + Math.floor(viewportY / effectiveRowHeight);

    // 범위 제한
    rowIndex = Math.max(0, Math.min(rowIndex, this.virtualRows.length - 1));

    // 마우스 X 좌표 → 컬럼 키
    const relativeX = event.clientX - viewportRect.left + this.viewport.scrollLeft;
    const columnKey = this.getColumnKeyFromX(relativeX);

    if (!columnKey) return null;

    // virtualRow에서 dataIndex 추출 (그룹 헤더인 경우 undefined)
    const virtualRow = this.virtualRows[rowIndex];
    const dataIndex = virtualRow?.type === 'data' ? virtualRow.dataIndex : undefined;

    return { rowIndex, columnKey, dataIndex };
  }

  /**
   * X 좌표에서 컬럼 키 찾기
   */
  private getColumnKeyFromX(x: number): string | null {
    const columnGroups = this.getColumnGroups();
    const allColumns = [...columnGroups.left, ...columnGroups.center, ...columnGroups.right];

    let accumulatedWidth = 0;
    for (const col of allColumns) {
      accumulatedWidth += col.width;
      if (x < accumulatedWidth) {
        return col.key;
      }
    }

    // X가 모든 컬럼을 넘어가면 마지막 컬럼 반환
    return allColumns[allColumns.length - 1]?.key ?? null;
  }

  /**
   * 셀 선택 스타일 업데이트
   *
   * dataIndex를 기준으로 선택 상태를 확인합니다.
   */
  private updateCellSelectionStyles(): void {
    for (const [_viewIndex, rowElement] of this.rowPool.getActiveRows()) {
      const cells = rowElement.querySelectorAll('.ps-cell');
      cells.forEach((cell) => {
        const el = cell as HTMLElement;
        const columnKey = el.dataset['columnKey'];
        const dataIndex = el.dataset['dataIndex'];
        if (columnKey && dataIndex !== undefined) {
          const cellKey = `${dataIndex}:${columnKey}`;
          const isSelected = this.selectedCells.has(cellKey);
          el.classList.toggle('ps-cell-selected', isSelected);
        }
      });
    }
  }

  // ===========================================================================
  // 자동 스크롤 (드래그 중 viewport 경계 도달 시)
  // ===========================================================================

  /**
   * 자동 스크롤 필요 여부 체크
   */
  private checkAutoScroll(event: MouseEvent): void {
    const viewportRect = this.viewport.getBoundingClientRect();
    const edgeThreshold = 50; // 경계에서 50px 이내면 자동 스크롤

    const distanceFromTop = event.clientY - viewportRect.top;
    const distanceFromBottom = viewportRect.bottom - event.clientY;

    if (distanceFromTop < edgeThreshold && distanceFromTop > 0) {
      // 위쪽으로 스크롤
      this.autoScrollSpeed = -Math.ceil((edgeThreshold - distanceFromTop) / 10);
      this.startAutoScroll();
    } else if (distanceFromBottom < edgeThreshold && distanceFromBottom > 0) {
      // 아래쪽으로 스크롤
      this.autoScrollSpeed = Math.ceil((edgeThreshold - distanceFromBottom) / 10);
      this.startAutoScroll();
    } else {
      // 스크롤 중지
      this.stopAutoScroll();
    }
  }

  /**
   * 자동 스크롤 시작
   *
   * 그룹 헤더는 건너뛰고 가장 가까운 데이터 행을 선택합니다.
   */
  private startAutoScroll(): void {
    if (this.autoScrollAnimationId !== null) return;

    const scroll = () => {
      if (!this.isDragging || this.autoScrollSpeed === 0) {
        this.stopAutoScroll();
        return;
      }

      // 현재 보이는 시작 인덱스 가져오기
      const currentStartIndex = this.virtualScroller.getVisibleStartIndex();
      const newStartIndex = currentStartIndex + this.autoScrollSpeed;

      // 스크롤
      this.virtualScroller.scrollToRow(newStartIndex);

      // 드래그 선택 업데이트 (현재 마우스 위치 기준)
      if (this.onDragSelectionUpdate && this.dragStartPosition && this.lastDragColumnKey) {
        const visibleStart = this.virtualScroller.getVisibleStartIndex();
        const visibleCount = this.virtualScroller.getVisibleRowCount();
        let targetViewIndex = this.autoScrollSpeed > 0
          ? Math.min(visibleStart + visibleCount - 1, this.virtualRows.length - 1)
          : Math.max(visibleStart, 0);

        // 그룹 헤더를 건너뛰고 가장 가까운 데이터 행 찾기
        let targetDataIndex: number | undefined;
        const direction = this.autoScrollSpeed > 0 ? -1 : 1;

        for (let i = targetViewIndex; i >= 0 && i < this.virtualRows.length; i += direction) {
          const vRow = this.virtualRows[i];
          if (vRow?.type === 'data') {
            targetViewIndex = i;
            targetDataIndex = vRow.dataIndex;
            break;
          }
        }

        // 데이터 행을 찾았을 때만 업데이트
        if (targetDataIndex !== undefined) {
          this.onDragSelectionUpdate({
            rowIndex: targetViewIndex,
            columnKey: this.lastDragColumnKey,
            dataIndex: targetDataIndex,
          });
        }
      }

      this.autoScrollAnimationId = requestAnimationFrame(scroll);
    };

    this.autoScrollAnimationId = requestAnimationFrame(scroll);
  }

  /**
   * 자동 스크롤 중지
   */
  private stopAutoScroll(): void {
    if (this.autoScrollAnimationId !== null) {
      cancelAnimationFrame(this.autoScrollAnimationId);
      this.autoScrollAnimationId = null;
    }
    this.autoScrollSpeed = 0;
  }
}
