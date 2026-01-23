/**
 * SimpleEventEmitter - 제네릭 이벤트 발행/구독 시스템
 *
 * UI 컴포넌트에서 사용하는 단순한 이벤트 시스템입니다.
 * GridEventType에 종속되지 않고 자유롭게 이벤트 타입을 정의할 수 있습니다.
 */

/**
 * 이벤트 핸들러 타입
 */
type EventHandler<T> = (payload: T) => void;

/**
 * 제네릭 이벤트 발행/구독 클래스
 *
 * @template Events - 이벤트 이름과 페이로드 타입의 맵
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   click: { x: number; y: number };
 *   change: string;
 * }
 *
 * const emitter = new SimpleEventEmitter<MyEvents>();
 * emitter.on('click', ({ x, y }) => console.log(x, y));
 * emitter.emit('click', { x: 10, y: 20 });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class SimpleEventEmitter<Events extends Record<string, any> = Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<EventHandler<unknown>>>();

  /**
   * 이벤트 구독
   */
  on<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    handlers.add(handler as EventHandler<unknown>);

    return () => {
      handlers.delete(handler as EventHandler<unknown>);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * 이벤트 발행
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of [...handlers]) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[SimpleEventEmitter] Handler error for "${String(event)}":`, error);
        }
      }
    }
  }

  /**
   * 모든 리스너 제거
   */
  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.removeAllListeners();
  }
}
