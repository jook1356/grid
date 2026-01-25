/**
 * HorizontalVirtualScroller - 가로 가상화 스크롤러
 *
 * 컬럼 수가 많을 때 (50개 이상) 보이는 컬럼만 DOM에 렌더링합니다.
 * Center 영역의 컬럼만 가상화되며, Left/Right 고정 컬럼은 항상 렌더링됩니다.
 *
 * 핵심 아이디어:
 * 1. 컬럼 offset 캐싱 - 각 컬럼의 시작 X 좌표를 미리 계산
 * 2. 이진 탐색 - viewport 범위에 해당하는 컬럼을 O(log n)으로 찾기
 * 3. overscan - 스크롤 시 깜빡임 방지를 위해 좌우 추가 렌더링
 */

import { SimpleEventEmitter } from '../core/SimpleEventEmitter';
import type { ColumnState, HorizontalVirtualRange } from './types';

/**
 * HorizontalVirtualScroller 이벤트 타입
 */
interface HorizontalVirtualScrollerEvents {
  /** 보이는 컬럼 범위가 변경됨 */
  rangeChanged: HorizontalVirtualRange;
}

/**
 * HorizontalVirtualScroller 설정
 */
export interface HorizontalVirtualScrollerOptions {
  /**
   * 좌우 추가 렌더링할 컬럼 수
   * @default 2
   */
  overscan?: number;

  /**
   * 가로 가상화 활성화 여부
   * @default false (컬럼 수가 많을 때만 자동 활성화)
   */
  enabled?: boolean;

  /**
   * 자동 활성화 임계값 (Center 컬럼 수)
   * 이 수 이상이면 자동으로 가상화 활성화
   * @default 50
   */
  autoEnableThreshold?: number;
}

/**
 * 가로 가상화 스크롤러
 */
export class HorizontalVirtualScroller extends SimpleEventEmitter<HorizontalVirtualScrollerEvents> {
  // 설정
  private readonly overscan: number;
  private readonly autoEnableThreshold: number;
  private enabled: boolean;

  // 상태
  private centerColumns: ColumnState[] = [];
  private columnOffsets: number[] = []; // 각 컬럼의 시작 X 좌표
  private totalWidth = 0;
  private viewportWidth = 0;
  private scrollLeft = 0;
  private currentRange: HorizontalVirtualRange | null = null;

  // DOM 요소
  private scrollProxyX: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private spacerX: HTMLElement | null = null;

  // 이벤트 바인딩
  private boundOnScroll: () => void;

  constructor(options: HorizontalVirtualScrollerOptions = {}) {
    super();

    this.overscan = options.overscan ?? 2;
    this.enabled = options.enabled ?? false;
    this.autoEnableThreshold = options.autoEnableThreshold ?? 50;

    // 이벤트 핸들러 바인딩
    this.boundOnScroll = this.onScroll.bind(this);
  }

  // ===========================================================================
  // 초기화 / 정리
  // ===========================================================================

  /**
   * DOM 요소에 스크롤러 연결
   *
   * 스크롤 동기화는 BodyRenderer가 담당합니다.
   * HorizontalVirtualScroller는 viewport의 스크롤 위치만 추적합니다.
   *
   * 참고: spacer 너비는 BodyRenderer에서 관리합니다.
   */
  attach(scrollProxyX: HTMLElement, viewport: HTMLElement, spacerX: HTMLElement): void {
    this.scrollProxyX = scrollProxyX;
    this.viewport = viewport;
    this.spacerX = spacerX;

    // viewport 스크롤 이벤트만 구독 (위치 추적용)
    viewport.addEventListener('scroll', this.boundOnScroll, { passive: true });

    // 초기 viewport 너비 측정
    requestAnimationFrame(() => {
      if (this.viewport) {
        this.viewportWidth = this.viewport.clientWidth;
        this.calculateVisibleRange();
      }
    });
  }

  /**
   * 스크롤러 연결 해제
   */
  detach(): void {
    if (this.viewport) {
      this.viewport.removeEventListener('scroll', this.boundOnScroll);
    }

    this.scrollProxyX = null;
    this.viewport = null;
    this.spacerX = null;
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.detach();
    this.removeAllListeners();
  }

  // ===========================================================================
  // 상태 업데이트
  // ===========================================================================

  /**
   * Center 컬럼 설정
   *
   * 컬럼 상태가 변경될 때 호출합니다.
   * offset을 재계산하고 자동 활성화 여부를 결정합니다.
   *
   * 참고: spacer 너비는 BodyRenderer에서 전체 컬럼(left + center + right)을
   * 기준으로 설정합니다. 여기서는 center 컬럼만 관리합니다.
   */
  setCenterColumns(columns: ColumnState[]): void {
    this.centerColumns = columns;
    this.recalculateOffsets();

    // 자동 활성화 체크
    if (!this.enabled && columns.length >= this.autoEnableThreshold) {
      this.enabled = true;
    }

    this.calculateVisibleRange();
  }

  /**
   * 가상화 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;

    this.enabled = enabled;
    this.calculateVisibleRange();
  }

  /**
   * 가상화 활성화 여부
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Viewport 크기 변경 시 호출
   */
  updateViewportSize(): void {
    if (this.viewport) {
      this.viewportWidth = this.viewport.clientWidth;
      this.calculateVisibleRange();
    }
  }

  /**
   * 컬럼 너비 변경 시 offset 재계산
   *
   * 참고: spacer 너비는 BodyRenderer에서 관리합니다.
   */
  updateColumnWidth(columnKey: string, width: number): void {
    const index = this.centerColumns.findIndex(c => c.key === columnKey);
    if (index !== -1) {
      const col = this.centerColumns[index];
      if (col) {
        col.width = width;
        this.recalculateOffsets();
        this.calculateVisibleRange();
      }
    }
  }

  /**
   * 특정 컬럼으로 스크롤
   */
  scrollToColumn(columnKey: string): void {
    const index = this.centerColumns.findIndex(c => c.key === columnKey);
    if (index === -1) return;

    const offset = this.columnOffsets[index] ?? 0;

    // viewport에 스크롤 위치 설정 (BodyRenderer가 프록시와 동기화)
    if (this.viewport) {
      this.viewport.scrollLeft = offset;
    }

    this.scrollLeft = offset;
    this.calculateVisibleRange();
  }

  // ===========================================================================
  // 상태 조회
  // ===========================================================================

  /**
   * 현재 visible range 반환
   *
   * 가상화가 비활성화되어 있으면 null 반환 (모든 컬럼 렌더링)
   */
  getVisibleRange(): HorizontalVirtualRange | null {
    if (!this.enabled) return null;
    return this.currentRange;
  }

  /**
   * 현재 visible 컬럼 배열 반환
   *
   * 가상화가 비활성화되어 있으면 전체 컬럼 반환
   */
  getVisibleColumns(): ColumnState[] {
    if (!this.enabled) return this.centerColumns;

    const range = this.currentRange;
    if (!range) return this.centerColumns;

    return this.centerColumns.slice(range.startIndex, range.endIndex);
  }

  /**
   * 컬럼 offset 반환 (가상화된 컬럼의 시작 위치)
   */
  getColumnOffset(index: number): number {
    return this.columnOffsets[index] ?? 0;
  }

  /**
   * 첫 번째 visible 컬럼의 offset 반환 (translate 계산용)
   */
  getVisibleStartOffset(): number {
    if (!this.enabled || !this.currentRange) return 0;
    return this.columnOffsets[this.currentRange.startIndex] ?? 0;
  }

  /**
   * 전체 Center 컬럼 너비
   */
  getTotalWidth(): number {
    return this.totalWidth;
  }

  // ===========================================================================
  // Offset 계산 (Private)
  // ===========================================================================

  /**
   * 모든 컬럼의 offset 재계산
   *
   * O(n) 시간 복잡도 - 컬럼 수에 비례
   */
  private recalculateOffsets(): void {
    this.columnOffsets = [];
    let offset = 0;

    for (const column of this.centerColumns) {
      this.columnOffsets.push(offset);
      offset += column.width;
    }

    this.totalWidth = offset;

    // ColumnState에도 offset 저장 (외부에서 참조 가능)
    for (let i = 0; i < this.centerColumns.length; i++) {
      const col = this.centerColumns[i];
      if (col) {
        col.offset = this.columnOffsets[i];
      }
    }
  }

  /**
   * 주어진 X 범위에 해당하는 컬럼 인덱스 반환
   *
   * 이진 탐색으로 O(log n) 구현
   */
  private getColumnsInRange(startX: number, endX: number): { start: number; end: number } {
    // 시작 컬럼 찾기 (startX 이하의 offset 중 가장 큰 것)
    let startIndex = this.binarySearchStart(startX);

    // 끝 컬럼 찾기 (endX 이상의 offset 중 가장 작은 것)
    let endIndex = this.binarySearchEnd(endX);

    // overscan 적용
    startIndex = Math.max(0, startIndex - this.overscan);
    endIndex = Math.min(this.centerColumns.length, endIndex + this.overscan);

    return { start: startIndex, end: endIndex };
  }

  /**
   * 이진 탐색 - startX 이하의 offset 중 가장 큰 인덱스
   */
  private binarySearchStart(x: number): number {
    let low = 0;
    let high = this.columnOffsets.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const offset = this.columnOffsets[mid] ?? 0;
      if (offset <= x) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return low;
  }

  /**
   * 이진 탐색 - endX 이상의 offset 중 가장 작은 인덱스
   */
  private binarySearchEnd(x: number): number {
    let low = 0;
    let high = this.columnOffsets.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const offset = this.columnOffsets[mid] ?? 0;
      const width = this.centerColumns[mid]?.width ?? 0;
      if (offset + width <= x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * Viewport 스크롤 이벤트
   *
   * 스크롤 위치를 추적하고 visible range를 계산합니다.
   * 스크롤 동기화는 BodyRenderer가 담당합니다.
   */
  private onScroll(): void {
    if (!this.viewport) return;

    this.scrollLeft = this.viewport.scrollLeft;
    this.calculateVisibleRange();
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================


  /**
   * Visible range 계산 및 이벤트 발생
   */
  private calculateVisibleRange(): void {
    // 가상화 비활성화 또는 컬럼 없음
    if (!this.enabled || this.centerColumns.length === 0) {
      this.currentRange = null;
      return;
    }

    // viewportWidth가 0이면 아직 측정되지 않음 - 계산 건너뛰기
    if (this.viewportWidth === 0) {
      return;
    }

    const startX = this.scrollLeft;
    const endX = this.scrollLeft + this.viewportWidth;

    const { start, end } = this.getColumnsInRange(startX, endX);

    // 유효하지 않은 범위면 건너뛰기
    if (start >= end || end <= 0) {
      return;
    }

    const offsetLeft = this.columnOffsets[start] ?? 0;

    const newRange: HorizontalVirtualRange = {
      startIndex: start,
      endIndex: end,
      offsetLeft,
      totalWidth: this.totalWidth,
    };

    // 범위가 변경되었는지 확인
    if (
      !this.currentRange ||
      this.currentRange.startIndex !== newRange.startIndex ||
      this.currentRange.endIndex !== newRange.endIndex
    ) {
      this.currentRange = newRange;
      this.emit('rangeChanged', newRange);
    }
  }
}
