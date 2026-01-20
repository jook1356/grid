/**
 * VirtualScroller - 청크 기반 네이티브 스크롤 + Proxy Scrollbar 가상 스크롤러
 *
 * 100만 행 이상의 대용량 데이터를 효율적으로 지원합니다.
 *
 * 핵심 아이디어:
 * 1. 브라우저 높이 제한(~16M px)을 우회하기 위해 데이터를 청크로 분할
 * 2. 각 청크 내에서 네이티브 HTML 스크롤 사용 (휠/터치)
 * 3. 청크 경계에서 부드럽게 전환
 * 4. 프록시 스크롤바는 전체 데이터 범위를 표시
 *
 * 장점:
 * - 휠/터치 시 네이티브 스크롤링으로 자연스러운 UX
 * - 수백만 행에서도 브라우저 제한 없이 스크롤 가능
 * - 스크롤바 드래그로 빠른 위치 이동 가능
 */

import { EventEmitter } from '../core/EventEmitter';
import type { VirtualScrollerOptions, VirtualScrollState } from './types';

/**
 * VirtualScroller 이벤트 타입
 */
interface VirtualScrollerEvents {
  /** 보이는 행 범위가 변경됨 */
  rangeChanged: { startIndex: number; endIndex: number };
}

/**
 * Proxy 스크롤바용 고정 행 높이 (인덱스 기반 스크롤용)
 * 이 값은 스크롤바 범위 계산에만 사용되며, 실제 렌더링과는 무관합니다.
 */
const SPACER_ROW_HEIGHT = 36;

/**
 * 브라우저 최대 요소 높이 제한
 * 
 * 주의: 값이 너무 크면 GPU transform 정밀도 손실로 인해
 * row 사이에 subpixel gap이 발생하여 클릭/호버가 불안정해짐.
 * 1M px 이하로 유지하면 정밀도 문제 최소화.
 */
const MAX_CHUNK_HEIGHT = 1_000_000;

/**
 * 브라우저 최대 scrollHeight 제한
 * 테스트 결과: Chrome ~16,777,214px (2^24)
 * 안전 마진을 두고 15M으로 설정
 */
const MAX_SCROLL_HEIGHT = 15_000_000;

/**
 * 청크 전환 버퍼 (행 수)
 * 청크 경계에 도달하기 전에 미리 전환 준비
 */
const CHUNK_TRANSITION_BUFFER = 50;

/**
 * 청크 기반 Proxy Scrollbar 가상 스크롤러
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
   */
  private renderRowHeight: number;

  // 청크 관련 상태
  private currentChunk = 0;
  private chunkSize = 0; // 청크당 행 수
  private isTransitioning = false;

  /**
   * 프록시 스크롤바 동기화 중 플래그
   */
  private isSyncingProxy = false;

  /**
   * 마지막으로 설정한 scrollTop 값 (루프 방지용)
   */
  private lastSetProxyScrollTop = -1;
  private lastSetViewportScrollTop = -1;

  // DOM 요소
  private scrollProxy: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private spacer: HTMLElement | null = null;
  private rowContainer: HTMLElement | null = null;

  // 이벤트 바인딩
  private boundOnProxyScroll: () => void;
  private boundOnViewportScroll: () => void;

  // ResizeObserver (viewport 크기 자동 감지)
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: VirtualScrollerOptions = {}) {
    super();

    this.renderRowHeight = options.estimatedRowHeight ?? SPACER_ROW_HEIGHT;
    this.overscan = options.overscan ?? 5;

    // 청크 크기 계산
    this.chunkSize = Math.floor(MAX_CHUNK_HEIGHT / this.renderRowHeight);

    // 이벤트 핸들러 바인딩
    this.boundOnProxyScroll = this.onProxyScroll.bind(this);
    this.boundOnViewportScroll = this.onViewportScroll.bind(this);
  }

  // ===========================================================================
  // 초기화 / 정리
  // ===========================================================================

  /**
   * DOM 요소에 스크롤러 연결
   */
  attach(scrollProxy: HTMLElement, viewport: HTMLElement, spacer: HTMLElement, rowContainer?: HTMLElement): void {
    this.scrollProxy = scrollProxy;
    this.viewport = viewport;
    this.spacer = spacer;
    this.rowContainer = rowContainer ?? null;

    // 이벤트 리스너 등록
    scrollProxy.addEventListener('scroll', this.boundOnProxyScroll, { passive: true });
    viewport.addEventListener('scroll', this.boundOnViewportScroll, { passive: true });

    // ResizeObserver로 viewport 크기 자동 감지
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === viewport) {
            const newHeight = entry.contentRect.height;
            if (newHeight !== this.viewportHeight && newHeight > 0) {
              this.viewportHeight = newHeight;
              this.updateRowContainerHeight();
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
          this.updateRowContainerHeight();
          this.emitRangeChanged();
        }
      }
    });

    // 초기 높이 설정
    this.updateSpacerHeight();
    this.updateRowContainerHeight();
  }

  /**
   * 스크롤러 연결 해제
   */
  detach(): void {
    if (this.scrollProxy) {
      this.scrollProxy.removeEventListener('scroll', this.boundOnProxyScroll);
    }
    if (this.viewport) {
      this.viewport.removeEventListener('scroll', this.boundOnViewportScroll);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.scrollProxy = null;
    this.viewport = null;
    this.spacer = null;
    this.rowContainer = null;
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

    // currentStartIndex를 범위 내로 조정
    if (this.currentStartIndex >= count) {
      this.currentStartIndex = Math.max(0, count - 1);
      this.currentChunk = this.getChunkForIndex(this.currentStartIndex);
    }

    this.updateSpacerHeight();
    this.updateRowContainerHeight();
    this.emitRangeChanged();
  }

  /**
   * 렌더링용 행 높이 설정
   */
  setRenderRowHeight(height: number): void {
    this.renderRowHeight = height;
    // 청크 크기 재계산
    this.chunkSize = Math.floor(MAX_CHUNK_HEIGHT / this.renderRowHeight);
    this.updateRowContainerHeight();
    this.emitRangeChanged();
  }

  /**
   * Viewport 크기 변경 시 호출
   */
  updateViewportSize(): void {
    if (this.viewport) {
      this.viewportHeight = this.viewport.clientHeight;
      this.updateRowContainerHeight();
      this.emitRangeChanged();
    }
  }

  /**
   * 특정 행으로 스크롤
   */
  scrollToRow(rowIndex: number): void {
    const clampedIndex = Math.max(0, Math.min(rowIndex, this.totalRows - 1));
    const targetChunk = this.getChunkForIndex(clampedIndex);

    // 청크 전환 필요시
    if (targetChunk !== this.currentChunk) {
      this.transitionToChunk(targetChunk);
    }

    this.currentStartIndex = clampedIndex;

    // Viewport 스크롤 위치 설정 (청크 내 상대 위치)
    if (this.viewport) {
      const indexInChunk = clampedIndex - this.getChunkStartIndex(this.currentChunk);
      this.isSyncingProxy = true;
      this.viewport.scrollTop = indexInChunk * this.renderRowHeight;
      requestAnimationFrame(() => {
        this.isSyncingProxy = false;
      });
    }

    // 프록시 스크롤바 동기화
    this.syncProxyScrollbar();
    this.emitRangeChanged();
  }

  /**
   * 스크롤을 맨 위로 이동
   */
  scrollToTop(): void {
    this.scrollToRow(0);
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
   * Viewport에 보이는 행 수
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
   * 화면에 보이는 첫 번째 행 인덱스 (overscan 미포함)
   */
  getVisibleStartIndex(): number {
    return this.currentStartIndex;
  }

  /**
   * 현재 청크 번호
   */
  getCurrentChunk(): number {
    return this.currentChunk;
  }

  /**
   * 현재 청크의 시작 인덱스
   */
  getCurrentChunkStartIndex(): number {
    return this.getChunkStartIndex(this.currentChunk);
  }

  /**
   * 행의 청크 내 상대 위치 (픽셀)
   * BodyRenderer에서 row 배치에 사용
   */
  getRowOffsetInChunk(rowIndex: number): number {
    const chunkStartIndex = this.getChunkStartIndex(this.currentChunk);
    const indexInChunk = rowIndex - chunkStartIndex;
    return indexInChunk * this.renderRowHeight;
  }

  // ===========================================================================
  // 청크 관리 (Private)
  // ===========================================================================

  /**
   * 인덱스가 속한 청크 번호
   */
  private getChunkForIndex(index: number): number {
    return Math.floor(index / this.chunkSize);
  }

  /**
   * 청크의 시작 인덱스
   */
  private getChunkStartIndex(chunk: number): number {
    return chunk * this.chunkSize;
  }

  /**
   * 청크의 행 수
   *
   * 마지막 청크인 경우 남은 모든 행을 포함합니다 (작은 청크 병합 효과).
   */
  private getChunkRowCount(chunk: number): number {
    const startIndex = this.getChunkStartIndex(chunk);
    if (startIndex >= this.totalRows) return 0;

    const totalChunks = this.getTotalChunks();

    // 마지막 청크인 경우 남은 모든 행 포함
    if (chunk === totalChunks - 1) {
      return this.totalRows - startIndex;
    }

    return this.chunkSize;
  }

  /**
   * 총 청크 수
   *
   * 마지막 청크가 너무 작으면 이전 청크에 병합하여 청크 수를 줄입니다.
   * 이렇게 하면 마지막 청크에서의 스크롤 공간이 확보됩니다.
   */
  private getTotalChunks(): number {
    if (this.totalRows === 0) return 0;

    const rawChunks = Math.ceil(this.totalRows / this.chunkSize);

    // 마지막 청크가 너무 작으면 이전 청크에 병합
    if (rawChunks > 1) {
      const lastChunkStart = (rawChunks - 1) * this.chunkSize;
      const lastChunkRows = this.totalRows - lastChunkStart;
      // CHUNK_TRANSITION_BUFFER * 2 미만이면 병합
      if (lastChunkRows < CHUNK_TRANSITION_BUFFER * 2) {
        return rawChunks - 1;
      }
    }

    return rawChunks;
  }

  /**
   * 청크 전환
   */
  private transitionToChunk(newChunk: number): void {
    if (this.isTransitioning) return;
    if (newChunk < 0 || newChunk >= this.getTotalChunks()) return;

    this.isTransitioning = true;
    this.currentChunk = newChunk;
    this.updateRowContainerHeight();

    // 다음 프레임에서 전환 완료
    requestAnimationFrame(() => {
      this.isTransitioning = false;
    });
  }

  // ===========================================================================
  // 이벤트 핸들러 (Private)
  // ===========================================================================

  /**
   * Proxy 스크롤바 직접 조작 시 (드래그)
   */
  private onProxyScroll(): void {
    if (this.isSyncingProxy) return;
    if (!this.scrollProxy) return;

    const { scrollTop, scrollHeight, clientHeight } = this.scrollProxy;

    // 프로그래밍적으로 설정한 값과 동일하면 무시 (무한 루프 방지)
    if (Math.abs(scrollTop - this.lastSetProxyScrollTop) < 2) {
      return;
    }

    const maxScroll = scrollHeight - clientHeight;
    const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;

    // 비율 → 전역 행 인덱스
    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);
    const targetStartIndex = Math.round(scrollRatio * maxStartIndex);

    // 청크 전환 필요시
    const targetChunk = this.getChunkForIndex(targetStartIndex);
    if (targetChunk !== this.currentChunk) {
      this.transitionToChunk(targetChunk);
    }

    if (targetStartIndex !== this.currentStartIndex) {
      this.currentStartIndex = targetStartIndex;

      // Viewport 스크롤 위치 동기화 (청크 내 상대 위치)
      this.syncViewportScroll();
      this.emitRangeChanged();
    }
  }

  /**
   * Viewport 네이티브 스크롤 이벤트 핸들러
   */
  private onViewportScroll(): void {
    if (!this.viewport || !this.scrollProxy) return;
    if (this.isSyncingProxy || this.isTransitioning) return;

    const scrollTop = this.viewport.scrollTop;

    // 프로그래밍적으로 설정한 값과 동일하면 무시 (무한 루프 방지)
    if (Math.abs(scrollTop - this.lastSetViewportScrollTop) < 2) {
      return;
    }

    const chunkStartIndex = this.getChunkStartIndex(this.currentChunk);
    const chunkRowCount = this.getChunkRowCount(this.currentChunk);

    // 청크 내 인덱스 계산
    const indexInChunk = Math.floor(scrollTop / this.renderRowHeight);
    const targetStartIndex = chunkStartIndex + indexInChunk;

    // 청크 경계 감지 및 전환
    if (indexInChunk >= chunkRowCount - CHUNK_TRANSITION_BUFFER &&
        this.currentChunk < this.getTotalChunks() - 1) {
      // 다음 청크로 전환
      this.transitionToAdjacentChunk('next');
      return;
    } else if (indexInChunk < CHUNK_TRANSITION_BUFFER && this.currentChunk > 0) {
      // 이전 청크로 전환하기 전에 검사:
      // 현재 보고 있는 행이 이전 청크의 유효 범위 내에 있어야만 전환
      const prevChunk = this.currentChunk - 1;
      const prevChunkStartIndex = this.getChunkStartIndex(prevChunk);
      const prevChunkRowCount = this.getChunkRowCount(prevChunk);
      const prevChunkEndIndex = prevChunkStartIndex + prevChunkRowCount - 1;

      // targetStartIndex가 이전 청크 범위를 벗어나면 전환하지 않음
      // (마지막 청크의 시작 부분에 있어서 이전 청크로 갈 수 없는 경우)
      if (targetStartIndex <= prevChunkEndIndex) {
        this.transitionToAdjacentChunk('prev');
        return;
      }
    }

    // 시작 인덱스 업데이트
    if (targetStartIndex !== this.currentStartIndex) {
      this.currentStartIndex = Math.min(targetStartIndex, this.totalRows - 1);
      this.emitRangeChanged();
    }

    // 프록시 스크롤바 동기화
    this.syncProxyScrollbar();
  }

  /**
   * 인접 청크로 전환 (스크롤 위치 유지)
   *
   * @param direction - 'next' 또는 'prev'
   */
  private transitionToAdjacentChunk(direction: 'next' | 'prev'): void {
    if (this.isTransitioning) return;

    const targetChunk = direction === 'next'
      ? this.currentChunk + 1
      : this.currentChunk - 1;

    // 범위 검사
    if (targetChunk < 0 || targetChunk >= this.getTotalChunks()) return;

    this.isTransitioning = true;

    // 현재 보이는 전역 인덱스 기억
    const currentGlobalIndex = this.currentStartIndex;

    // 청크 전환
    this.currentChunk = targetChunk;
    this.updateRowContainerHeight();

    // 새 청크에서의 스크롤 위치 계산
    const newChunkStartIndex = this.getChunkStartIndex(targetChunk);
    const indexInNewChunk = currentGlobalIndex - newChunkStartIndex;
    const newScrollTop = Math.max(0, indexInNewChunk * this.renderRowHeight);

    // Viewport 스크롤 위치 설정
    if (this.viewport) {
      this.isSyncingProxy = true;
      this.viewport.scrollTop = newScrollTop;
    }

    this.emitRangeChanged();

    requestAnimationFrame(() => {
      this.isTransitioning = false;
      this.isSyncingProxy = false;
    });
  }

  /**
   * 프록시 스크롤바 위치 동기화
   */
  private syncProxyScrollbar(): void {
    if (!this.scrollProxy) return;

    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);
    const currentRatio = maxStartIndex > 0 ? this.currentStartIndex / maxStartIndex : 0;

    const { scrollHeight, clientHeight } = this.scrollProxy;
    const maxScroll = scrollHeight - clientHeight;
    const targetScrollTop = Math.round(currentRatio * maxScroll);

    // 프로그래밍적 설정값 기록 (scroll 이벤트에서 무시하기 위해)
    this.lastSetProxyScrollTop = targetScrollTop;
    this.isSyncingProxy = true;
    this.scrollProxy.scrollTop = targetScrollTop;

    requestAnimationFrame(() => {
      this.isSyncingProxy = false;
    });
  }

  /**
   * Viewport 스크롤 위치 동기화
   */
  private syncViewportScroll(): void {
    if (!this.viewport) return;

    const chunkStartIndex = this.getChunkStartIndex(this.currentChunk);
    const chunkRowCount = this.getChunkRowCount(this.currentChunk);
    const indexInChunk = this.currentStartIndex - chunkStartIndex;

    let targetScrollTop = Math.max(0, indexInChunk * this.renderRowHeight);

    // 맨 아래 행을 보고 있을 때: viewport를 최대 스크롤 위치로
    const visibleCount = this.getVisibleRowCount();
    const maxStartIndex = Math.max(0, this.totalRows - visibleCount);
    if (this.currentStartIndex >= maxStartIndex) {
      const maxScroll = (chunkRowCount * this.renderRowHeight) - this.viewportHeight;
      targetScrollTop = Math.max(0, maxScroll);
    }

    // 프로그래밍적 설정값 기록 (scroll 이벤트에서 무시하기 위해)
    this.lastSetViewportScrollTop = Math.round(targetScrollTop);
    this.isSyncingProxy = true;
    this.viewport.scrollTop = targetScrollTop;

    requestAnimationFrame(() => {
      this.isSyncingProxy = false;
    });
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * Spacer 높이 업데이트 (프록시 스크롤바 범위)
   * 브라우저 최대 scrollHeight 제한을 고려하여 안전한 높이로 설정
   */
  private updateSpacerHeight(): void {
    if (!this.spacer) return;

    const idealHeight = this.totalRows * SPACER_ROW_HEIGHT;
    // 브라우저 한계를 초과하면 최대값으로 제한
    // 비율 기반 스크롤 계산이 이를 보정함
    const safeHeight = Math.min(idealHeight, MAX_SCROLL_HEIGHT);
    this.spacer.style.height = `${safeHeight}px`;
  }

  /**
   * rowContainer 높이 업데이트 (현재 청크 크기)
   */
  private updateRowContainerHeight(): void {
    if (!this.rowContainer) return;

    const chunkRowCount = this.getChunkRowCount(this.currentChunk);
    const chunkHeight = chunkRowCount * this.renderRowHeight;
    this.rowContainer.style.height = `${chunkHeight}px`;
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