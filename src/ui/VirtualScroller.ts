/**
 * VirtualScroller - 인덱스 기반 Proxy Scrollbar 가상 스크롤러
 *
 * 100만 행과 가변 행 높이를 효율적으로 지원합니다.
 *
 * 핵심 아이디어:
 * 1. 네이티브 스크롤바를 별도 DOM(Proxy)에서 생성
 * 2. 스크롤 비율 → 행 인덱스 O(1) 계산 (인덱스 기반)
 * 3. Spacer 높이는 항상 고정 (totalRows × 36px)
 * 4. 렌더링은 실제 행 높이 사용 (Multi-Row 등)
 *
 * 장점:
 * - 스크롤 비율 = row 인덱스 비율 (직관적)
 * - row 높이가 달라도 스크롤 로직 변경 불필요
 * - 맨 위/맨 아래 끝점이 항상 정확
 */

import { EventEmitter } from '../core/EventEmitter';
import type { VirtualScrollerOptions, VirtualScrollState } from './types';

/**
 * VirtualScroller 이벤트 타입
 */
interface VirtualScrollerEvents {
  /** 보이는 행 범위가 변경됨 */
  rangeChanged: { startIndex: number; endIndex: number };
  /** 스크롤 위치가 변경됨 */
  scroll: { scrollTop: number; scrollRatio: number };
}

/**
 * Proxy 스크롤바용 고정 행 높이 (인덱스 기반 스크롤용)
 * 이 값은 스크롤바 범위 계산에만 사용되며, 실제 렌더링과는 무관합니다.
 */
const SPACER_ROW_HEIGHT = 36;

/**
 * 인덱스 기반 Proxy Scrollbar 가상 스크롤러
 */
export class VirtualScroller extends EventEmitter<VirtualScrollerEvents> {
  // 설정
  private readonly overscan: number;

  // 상태
  private totalRows = 0;
  private currentStartIndex = 0;
  private viewportHeight = 0;

  /**
   * 렌더링용 행 높이
   * - 단일 row: 36px
   * - Multi-Row: rowCount × 36px
   * - 가변 높이: 평균 또는 최대 높이
   */
  private renderRowHeight: number;

  // DOM 요소
  private scrollProxy: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private spacer: HTMLElement | null = null;

  // 이벤트 바인딩
  private boundOnProxyScroll: () => void;
  private boundOnViewportWheel: (e: WheelEvent) => void;

  // ResizeObserver (viewport 크기 자동 감지)
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: VirtualScrollerOptions = {}) {
    super();

    this.renderRowHeight = options.estimatedRowHeight ?? SPACER_ROW_HEIGHT;
    this.overscan = options.overscan ?? 5;

    // 이벤트 핸들러 바인딩
    this.boundOnProxyScroll = this.onProxyScroll.bind(this);
    this.boundOnViewportWheel = this.onViewportWheel.bind(this);
  }

  // ===========================================================================
  // 초기화 / 정리
  // ===========================================================================

  /**
   * DOM 요소에 스크롤러 연결
   */
  attach(scrollProxy: HTMLElement, viewport: HTMLElement, spacer: HTMLElement): void {
    this.scrollProxy = scrollProxy;
    this.viewport = viewport;
    this.spacer = spacer;

    // 이벤트 리스너 등록
    scrollProxy.addEventListener('scroll', this.boundOnProxyScroll, { passive: true });
    viewport.addEventListener('wheel', this.boundOnViewportWheel, { passive: false });

    // ResizeObserver로 viewport 크기 자동 감지
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === viewport) {
            const newHeight = entry.contentRect.height;
            if (newHeight !== this.viewportHeight && newHeight > 0) {
              this.viewportHeight = newHeight;
              this.emitRangeChanged();
            }
          }
        }
      });
      this.resizeObserver.observe(viewport);
    }

    // 초기 Viewport 높이 측정
    requestAnimationFrame(() => {
      if (this.viewport) {
        const height = this.viewport.clientHeight;
        if (height > 0 && height !== this.viewportHeight) {
          this.viewportHeight = height;
          this.updateSpacerHeight();
          this.emitRangeChanged();
        }
      }
    });

    // 초기 Spacer 높이 설정
    this.updateSpacerHeight();
  }

  /**
   * 스크롤러 연결 해제
   */
  detach(): void {
    if (this.scrollProxy) {
      this.scrollProxy.removeEventListener('scroll', this.boundOnProxyScroll);
    }
    if (this.viewport) {
      this.viewport.removeEventListener('wheel', this.boundOnViewportWheel);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.scrollProxy = null;
    this.viewport = null;
    this.spacer = null;
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
   * 총 행 수 설정
   */
  setTotalRows(count: number): void {
    this.totalRows = count;
    this.updateSpacerHeight();
    this.emitRangeChanged();
  }

  /**
   * 렌더링용 행 높이 설정
   *
   * Multi-Row의 경우 각 데이터 행이 여러 visual row를 차지하므로
   * 실제 행 높이 = rowCount × baseRowHeight
   *
   * 참고: 이 값은 렌더링과 visibleRowCount 계산에만 사용됩니다.
   * Spacer 높이(스크롤바 범위)는 항상 고정 높이(36px) 기준입니다.
   */
  setRenderRowHeight(height: number): void {
    this.renderRowHeight = height;
    // Spacer 높이는 변경하지 않음 (인덱스 기반 스크롤)
    this.emitRangeChanged();
  }

  /**
   * @deprecated setRenderRowHeight 사용
   */
  setRowHeight(height: number): void {
    this.setRenderRowHeight(height);
  }

  /**
   * Viewport 크기 변경 시 호출
   */
  updateViewportSize(): void {
    if (this.viewport) {
      this.viewportHeight = this.viewport.clientHeight;
      this.emitRangeChanged();
    }
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    if (!this.scrollProxy) return;

    const clampedIndex = Math.max(0, Math.min(rowIndex, this.totalRows - 1));
    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);
    const targetRatio = maxStartIndex > 0 ? clampedIndex / maxStartIndex : 0;

    const { scrollHeight, clientHeight } = this.scrollProxy;
    const maxScroll = scrollHeight - clientHeight;
    this.scrollProxy.scrollTop = targetRatio * maxScroll;
  }

  /**
   * 스크롤을 맨 위로 이동
   */
  scrollToTop(): void {
    if (this.scrollProxy) {
      this.scrollProxy.scrollTop = 0;
    }
  }

  // ===========================================================================
  // 상태 조회
  // ===========================================================================

  /**
   * 현재 가상 스크롤 상태
   */
  getState(): VirtualScrollState {
    const visibleCount = this.getVisibleRowCount();
    const startIndex = Math.max(0, this.currentStartIndex - this.overscan);
    const endIndex = Math.min(
      this.currentStartIndex + visibleCount + this.overscan,
      this.totalRows
    );

    return {
      startIndex,
      endIndex,
      scrollTop: this.scrollProxy?.scrollTop ?? 0,
      totalHeight: this.totalRows * this.renderRowHeight,
    };
  }

  /**
   * Viewport에 보이는 행 수 (렌더링용 높이 기준)
   */
  getVisibleRowCount(): number {
    if (this.viewportHeight <= 0) {
      return Math.max(1, this.overscan * 2);
    }
    return Math.ceil(this.viewportHeight / this.renderRowHeight);
  }

  /**
   * 렌더링용 행 높이
   */
  getRenderRowHeight(): number {
    return this.renderRowHeight;
  }

  /**
   * @deprecated getRenderRowHeight 사용
   */
  getEstimatedRowHeight(): number {
    return this.renderRowHeight;
  }

  /**
   * 화면에 보이는 첫 번째 행 인덱스 (overscan 미포함)
   */
  getVisibleStartIndex(): number {
    return this.currentStartIndex;
  }

  /**
   * 행 위치 보정 오프셋 (맨 아래 스크롤 시 마지막 행이 잘리지 않도록)
   */
  getRowOffset(): number {
    const visibleCount = this.getVisibleRowCount();

    // row 수가 viewport를 채우지 못하면 offset 불필요
    if (this.totalRows <= visibleCount) {
      return 0;
    }

    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);

    // 맨 아래 스크롤인지 확인
    if (this.currentStartIndex >= maxStartIndex && this.totalRows > 0) {
      const contentHeight = visibleCount * this.renderRowHeight;
      const offset = this.viewportHeight - contentHeight;
      return Math.min(0, offset);
    }

    return 0;
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * Proxy 스크롤 → 행 인덱스 계산 (비율 기반)
   *
   * 핵심: 스크롤 비율 = row 인덱스 비율
   * - 스크롤 0% → row 0
   * - 스크롤 50% → row 50%
   * - 스크롤 100% → 마지막 row
   */
  private onProxyScroll(): void {
    if (!this.scrollProxy) return;

    const { scrollTop, scrollHeight, clientHeight } = this.scrollProxy;
    const maxScroll = scrollHeight - clientHeight;
    const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;

    // 비율 → 행 인덱스 (O(1) 계산)
    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);
    const targetStartIndex = Math.round(scrollRatio * maxStartIndex);

    // 시작 인덱스가 변경되었을 때만 이벤트 발생
    if (targetStartIndex !== this.currentStartIndex) {
      this.currentStartIndex = targetStartIndex;
      this.emitRangeChanged();
    }

    // 스크롤 이벤트는 항상 발생
    this.emit('scroll', { scrollTop, scrollRatio });
  }

  /**
   * Viewport 휠 → Proxy로 전달
   */
  private onViewportWheel(e: WheelEvent): void {
    if (!this.scrollProxy) return;

    this.scrollProxy.scrollTop += e.deltaY;
    e.preventDefault();
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * Spacer 높이 업데이트 (스크롤바 범위 결정)
   *
   * 인덱스 기반 스크롤: 항상 고정 높이(36px) 기준
   * 이렇게 하면 row 높이가 달라도 스크롤바 동작이 일관됩니다.
   */
  private updateSpacerHeight(): void {
    if (!this.spacer) return;

    // 항상 고정 높이 기준 (인덱스 기반)
    const totalHeight = this.totalRows * SPACER_ROW_HEIGHT;
    this.spacer.style.height = `${totalHeight}px`;
  }

  /**
   * rangeChanged 이벤트 발생
   */
  private emitRangeChanged(): void {
    const visibleCount = this.getVisibleRowCount();
    const startIndex = Math.max(0, this.currentStartIndex - this.overscan);
    const endIndex = Math.min(
      this.currentStartIndex + visibleCount + this.overscan,
      this.totalRows
    );

    this.emit('rangeChanged', { startIndex, endIndex });
  }
}
