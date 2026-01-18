/**
 * VirtualScroller - Proxy Scrollbar 방식 가상 스크롤러
 *
 * 100만 행과 가변 행 높이를 효율적으로 지원합니다.
 *
 * 핵심 아이디어:
 * 1. 네이티브 스크롤바를 별도 DOM(Proxy)에서 생성
 * 2. 스크롤 비율 → 행 인덱스 O(1) 계산
 * 3. 평균 행 높이 기반으로 가변 높이 지원
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
 * Proxy Scrollbar 방식 가상 스크롤러
 */
export class VirtualScroller extends EventEmitter<VirtualScrollerEvents> {
  // 설정
  private readonly overscan: number;
  private readonly sampleSize: number;

  // 상태
  private totalRows = 0;
  private estimatedRowHeight: number;
  private currentStartIndex = 0;
  private viewportHeight = 0;

  // 샘플링 (평균 행 높이 계산용)
  private heightSamples: number[] = [];
  private isHeightLocked = false;

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

    this.estimatedRowHeight = options.estimatedRowHeight ?? 40;
    this.sampleSize = options.sampleSize ?? 50;
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

    // 초기 Viewport 높이 측정 (ResizeObserver 콜백 전에도 값이 필요할 수 있음)
    // requestAnimationFrame으로 레이아웃 완료 후 측정
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
    this.heightSamples = [];
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
   * Viewport 크기 변경 시 호출
   */
  updateViewportSize(): void {
    if (this.viewport) {
      this.viewportHeight = this.viewport.clientHeight;
      this.emitRangeChanged();
    }
  }

  /**
   * 행 높이 측정 (초기 샘플링)
   *
   * 렌더링된 행의 실제 높이를 측정하여 평균을 계산합니다.
   * 샘플 수만큼 수집되면 평균값을 고정합니다.
   */
  measureRow(_index: number, height: number): void {
    if (this.isHeightLocked) return;

    this.heightSamples.push(height);

    // 샘플 수 도달 시 평균 고정
    if (this.heightSamples.length >= this.sampleSize) {
      const sum = this.heightSamples.reduce((a, b) => a + b, 0);
      this.estimatedRowHeight = sum / this.heightSamples.length;
      this.isHeightLocked = true;
      this.updateSpacerHeight();
    }
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    if (!this.scrollProxy) return;

    const clampedIndex = Math.max(0, Math.min(rowIndex, this.totalRows - 1));
    const maxVisibleStart = Math.max(0, this.totalRows - this.getVisibleRowCount());
    const targetRatio = maxVisibleStart > 0 ? clampedIndex / maxVisibleStart : 0;

    const { scrollHeight, clientHeight } = this.scrollProxy;
    const maxScroll = scrollHeight - clientHeight;
    this.scrollProxy.scrollTop = targetRatio * maxScroll;
  }

  // ===========================================================================
  // 상태 조회
  // ===========================================================================

  /**
   * 현재 가상 스크롤 상태
   */
  getState(): VirtualScrollState {
    const visibleCount = this.getVisibleRowCount();
    // overscan 포함하여 일관성 유지
    const startIndex = Math.max(0, this.currentStartIndex - this.overscan);
    const endIndex = Math.min(
      this.currentStartIndex + visibleCount + this.overscan,
      this.totalRows
    );

    return {
      startIndex,
      endIndex,
      scrollTop: this.scrollProxy?.scrollTop ?? 0,
      totalHeight: this.totalRows * this.estimatedRowHeight,
    };
  }

  /**
   * Viewport에 보이는 행 수
   */
  getVisibleRowCount(): number {
    // viewportHeight가 아직 측정되지 않은 경우 (attach 직후)
    // ResizeObserver 또는 requestAnimationFrame 콜백에서 측정될 예정
    // 그 전까지는 최소 1행을 반환하여 초기 렌더링 보장
    if (this.viewportHeight <= 0) {
      return Math.max(1, this.overscan * 2);
    }
    return Math.ceil(this.viewportHeight / this.estimatedRowHeight);
  }

  /**
   * 현재 예상 행 높이
   */
  getEstimatedRowHeight(): number {
    return this.estimatedRowHeight;
  }

  /**
   * 화면에 보이는 첫 번째 행 인덱스 (overscan 미포함)
   *
   * renderRow에서 Y 위치 계산 시 이 값을 기준으로 해야 합니다.
   * getState().startIndex는 overscan을 포함하므로 렌더링 범위용입니다.
   */
  getVisibleStartIndex(): number {
    return this.currentStartIndex;
  }

  /**
   * 행 위치 보정 오프셋 (맨 아래 스크롤 시 마지막 행이 잘리지 않도록)
   *
   * 문제: ceil()로 계산된 visibleCount * rowHeight > viewportHeight 일 수 있음
   * 예: viewport=500px, rowHeight=36px → visibleCount=14, 14*36=504px → 4px 잘림
   *
   * 해결: 맨 아래 스크롤 시 음수 오프셋을 적용하여 마지막 행이 viewport 하단에 맞춰지도록 함
   */
  getRowOffset(): number {
    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);

    // 맨 아래 스크롤인지 확인
    if (this.currentStartIndex >= maxStartIndex && this.totalRows > 0) {
      const contentHeight = visibleCount * this.estimatedRowHeight;
      // 음수 오프셋: 콘텐츠가 viewport보다 크면 위로 이동
      const offset = this.viewportHeight - contentHeight;
      return offset; // 보통 음수 (예: 500 - 504 = -4)
    }

    return 0;
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * Proxy 스크롤 → 행 인덱스 계산
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
   * Spacer 높이 업데이트 (스크롤바 크기 결정)
   */
  private updateSpacerHeight(): void {
    if (!this.spacer) return;

    const totalHeight = this.totalRows * this.estimatedRowHeight;
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
