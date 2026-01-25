/**
 * ColumnManager - 컬럼 상태 관리
 *
 * 컬럼의 너비, 순서, 가시성, 고정 상태를 관리합니다.
 */

import { SimpleEventEmitter } from '../../core/SimpleEventEmitter';
import type { ColumnDef } from '../../types';
import type { ColumnState, PinPosition } from '../types';

/**
 * ColumnManager 이벤트 타입
 */
interface ColumnManagerEvents {
  /** 컬럼 너비 변경 */
  widthChanged: { columnKey: string; width: number };
  /** 컬럼 순서 변경 */
  orderChanged: { order: string[] };
  /** 컬럼 가시성 변경 */
  visibilityChanged: { columnKey: string; visible: boolean };
  /** 컬럼 고정 변경 */
  pinnedChanged: { columnKey: string; pinned: PinPosition };
  /** 모든 상태 변경 */
  stateChanged: ColumnState[];
}

/**
 * ColumnManager 설정
 */
export interface ColumnManagerOptions {
  /** 컬럼 정의 */
  columns: ColumnDef[];
}

/**
 * 컬럼 상태 관리자
 */
export class ColumnManager extends SimpleEventEmitter<ColumnManagerEvents> {
  private columnStates: Map<string, ColumnState> = new Map();
  private columnOrder: string[] = [];

  constructor(options: ColumnManagerOptions) {
    super();
    this.initializeFromDefs(options.columns);
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 모든 컬럼 상태 가져오기
   */
  getState(): ColumnState[] {
    return this.columnOrder.map((key) => this.columnStates.get(key)!).filter(Boolean);
  }

  /**
   * 특정 컬럼 상태 가져오기
   */
  getColumnState(columnKey: string): ColumnState | undefined {
    return this.columnStates.get(columnKey);
  }

  /**
   * 보이는 컬럼만 가져오기
   */
  getVisibleColumns(): ColumnState[] {
    return this.getState().filter((col) => col.visible);
  }

  // ===========================================================================
  // 너비 관리
  // ===========================================================================

  /**
   * 컬럼 너비 설정
   */
  setWidth(columnKey: string, width: number): void {
    const state = this.columnStates.get(columnKey);
    if (!state) return;

    const newWidth = Math.max(50, width); // 최소 50px
    state.width = newWidth;

    this.emit('widthChanged', { columnKey, width: newWidth });
    this.emitStateChanged();
  }

  /**
   * 컬럼 너비 가져오기
   */
  getWidth(columnKey: string): number {
    return this.columnStates.get(columnKey)?.width ?? 100;
  }

  /**
   * 모든 컬럼 너비 설정
   */
  setWidths(widths: Record<string, number>): void {
    for (const [key, width] of Object.entries(widths)) {
      const state = this.columnStates.get(key);
      if (state) {
        state.width = Math.max(50, width);
      }
    }
    this.emitStateChanged();
  }

  // ===========================================================================
  // 순서 관리
  // ===========================================================================

  /**
   * 컬럼 순서 설정
   */
  setOrder(order: string[]): void {
    // 유효한 컬럼만 필터링
    const validOrder = order.filter((key) => this.columnStates.has(key));

    // 누락된 컬럼 추가
    for (const key of this.columnOrder) {
      if (!validOrder.includes(key)) {
        validOrder.push(key);
      }
    }

    this.columnOrder = validOrder;

    // 각 상태의 order 업데이트
    validOrder.forEach((key, index) => {
      const state = this.columnStates.get(key);
      if (state) {
        state.order = index;
      }
    });

    this.emit('orderChanged', { order: validOrder });
    this.emitStateChanged();
  }

  /**
   * 컬럼 순서 가져오기
   */
  getOrder(): string[] {
    return [...this.columnOrder];
  }

  /**
   * 컬럼 이동
   */
  moveColumn(fromKey: string, toKey: string, insertBefore: boolean): void {
    const fromIndex = this.columnOrder.indexOf(fromKey);
    const toIndex = this.columnOrder.indexOf(toKey);

    if (fromIndex === -1 || toIndex === -1) return;

    // 제거
    this.columnOrder.splice(fromIndex, 1);

    // 삽입 위치 계산
    let insertIndex = this.columnOrder.indexOf(toKey);
    if (!insertBefore) {
      insertIndex++;
    }

    // 삽입
    this.columnOrder.splice(insertIndex, 0, fromKey);

    // order 업데이트
    this.columnOrder.forEach((key, index) => {
      const state = this.columnStates.get(key);
      if (state) {
        state.order = index;
      }
    });

    this.emit('orderChanged', { order: this.columnOrder });
    this.emitStateChanged();
  }

  // ===========================================================================
  // 가시성 관리
  // ===========================================================================

  /**
   * 컬럼 표시
   */
  show(columnKey: string): void {
    const state = this.columnStates.get(columnKey);
    if (!state || state.visible) return;

    state.visible = true;
    this.emit('visibilityChanged', { columnKey, visible: true });
    this.emitStateChanged();
  }

  /**
   * 컬럼 숨기기
   */
  hide(columnKey: string): void {
    const state = this.columnStates.get(columnKey);
    if (!state || !state.visible) return;

    state.visible = false;
    this.emit('visibilityChanged', { columnKey, visible: false });
    this.emitStateChanged();
  }

  /**
   * 컬럼 가시성 토글
   */
  toggleVisibility(columnKey: string): void {
    const state = this.columnStates.get(columnKey);
    if (!state) return;

    state.visible = !state.visible;
    this.emit('visibilityChanged', { columnKey, visible: state.visible });
    this.emitStateChanged();
  }

  /**
   * 컬럼이 보이는지 확인
   */
  isVisible(columnKey: string): boolean {
    return this.columnStates.get(columnKey)?.visible ?? false;
  }

  // ===========================================================================
  // 고정 관리
  // ===========================================================================

  /**
   * 컬럼 고정
   */
  pin(columnKey: string, position: 'left' | 'right'): void {
    const state = this.columnStates.get(columnKey);
    if (!state) return;

    state.pinned = position;
    this.emit('pinnedChanged', { columnKey, pinned: position });
    this.emitStateChanged();
  }

  /**
   * 컬럼 고정 해제
   */
  unpin(columnKey: string): void {
    const state = this.columnStates.get(columnKey);
    if (!state || state.pinned === 'none') return;

    state.pinned = 'none';
    this.emit('pinnedChanged', { columnKey, pinned: 'none' });
    this.emitStateChanged();
  }

  /**
   * 컬럼 고정 여부 확인
   */
  isPinned(columnKey: string): PinPosition {
    return this.columnStates.get(columnKey)?.pinned ?? 'none';
  }

  // ===========================================================================
  // Offset 관리 (가로 가상화용)
  // ===========================================================================

  /**
   * 모든 컬럼의 offset 재계산
   *
   * 컬럼 너비나 순서가 변경된 후 호출합니다.
   * 가로 가상화 시 어떤 컬럼이 viewport에 있는지 빠르게 판단하는 데 사용됩니다.
   */
  recalculateOffsets(): void {
    const visibleColumns = this.getVisibleColumns();
    let offset = 0;

    for (const col of visibleColumns) {
      col.offset = offset;
      offset += col.width;
    }
  }

  /**
   * 주어진 X 범위에 해당하는 컬럼 인덱스 반환
   *
   * 이진 탐색으로 O(log n) 구현 - 가로 가상화 시 사용
   *
   * @param startX - 시작 X 좌표 (스크롤 위치)
   * @param endX - 끝 X 좌표 (스크롤 위치 + viewport 너비)
   * @returns 시작/끝 인덱스 (visible 컬럼 기준)
   */
  getColumnsInRange(startX: number, endX: number): { start: number; end: number } {
    const visibleColumns = this.getVisibleColumns();
    if (visibleColumns.length === 0) {
      return { start: 0, end: 0 };
    }

    // offset이 계산되지 않았으면 먼저 계산
    if (visibleColumns[0]?.offset === undefined) {
      this.recalculateOffsets();
    }

    // 시작 컬럼 찾기 (이진 탐색)
    let startIndex = this.binarySearchColumnStart(visibleColumns, startX);

    // 끝 컬럼 찾기 (이진 탐색)
    let endIndex = this.binarySearchColumnEnd(visibleColumns, endX);

    return { start: startIndex, end: endIndex };
  }

  /**
   * 이진 탐색 - startX 이하의 offset 중 가장 큰 인덱스
   */
  private binarySearchColumnStart(columns: ColumnState[], x: number): number {
    let low = 0;
    let high = columns.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const offset = columns[mid]?.offset ?? 0;
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
  private binarySearchColumnEnd(columns: ColumnState[], x: number): number {
    let low = 0;
    let high = columns.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const col = columns[mid];
      const offset = col?.offset ?? 0;
      const width = col?.width ?? 0;
      if (offset + width <= x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * 특정 컬럼의 offset 반환
   */
  getColumnOffset(columnKey: string): number | undefined {
    return this.columnStates.get(columnKey)?.offset;
  }

  /**
   * 전체 컬럼 너비 합계 반환
   */
  getTotalWidth(): number {
    return this.getVisibleColumns().reduce((sum, col) => sum + col.width, 0);
  }

  // ===========================================================================
  // 상태 저장/복원
  // ===========================================================================

  /**
   * 상태를 JSON으로 직렬화
   */
  serialize(): string {
    return JSON.stringify({
      order: this.columnOrder,
      states: Object.fromEntries(
        Array.from(this.columnStates.entries()).map(([key, state]) => [
          key,
          {
            width: state.width,
            visible: state.visible,
            pinned: state.pinned,
          },
        ])
      ),
    });
  }

  /**
   * JSON에서 상태 복원
   */
  deserialize(json: string): void {
    try {
      const data = JSON.parse(json) as {
        order: string[];
        states: Record<string, { width: number; visible: boolean; pinned: PinPosition }>;
      };

      // 순서 복원
      if (Array.isArray(data.order)) {
        this.setOrder(data.order);
      }

      // 상태 복원
      if (data.states) {
        for (const [key, saved] of Object.entries(data.states)) {
          const state = this.columnStates.get(key);
          if (state) {
            if (typeof saved.width === 'number') {
              state.width = saved.width;
            }
            if (typeof saved.visible === 'boolean') {
              state.visible = saved.visible;
            }
            if (saved.pinned) {
              state.pinned = saved.pinned;
            }
          }
        }
      }

      this.emitStateChanged();
    } catch {
      console.warn('Failed to deserialize column state');
    }
  }

  // ===========================================================================
  // 리소스 해제
  // ===========================================================================

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.removeAllListeners();
    this.columnStates.clear();
    this.columnOrder = [];
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * 컬럼 정의에서 초기화
   */
  private initializeFromDefs(columns: ColumnDef[]): void {
    columns.forEach((col, index) => {
      this.columnStates.set(col.key, {
        key: col.key,
        width: col.width ?? 100,
        pinned: (col.pinned as PinPosition) ?? 'none',
        visible: col.visible !== false,
        order: index,
      });
      this.columnOrder.push(col.key);
    });
  }

  /**
   * 상태 변경 이벤트 발생
   */
  private emitStateChanged(): void {
    this.emit('stateChanged', this.getState());
  }
}
