/**
 * EventEmitter - 이벤트 발행/구독 시스템
 *
 * 모든 모듈이 이 클래스를 통해 이벤트를 주고받습니다.
 * Observer 패턴을 구현합니다.
 *
 * @example
 * const emitter = new EventEmitter();
 *
 * // 구독
 * const unsubscribe = emitter.on('data:loaded', (event) => {
 *   console.log(`${event.payload.rowCount}행 로드됨`);
 * });
 *
 * // 발행
 * emitter.emit('data:loaded', { rowCount: 100, columnCount: 5 });
 *
 * // 구독 해제
 * unsubscribe();
 */

import type {
  GridEventType,
  GridEvent,
  GridEventPayloads,
  GridEventHandler,
  Unsubscribe,
} from '../types';

/**
 * 이벤트 발행/구독 클래스
 *
 * 프레임워크 독립적인 이벤트 시스템입니다.
 * React의 useEffect, Vue의 onMounted에서 쉽게 사용할 수 있습니다.
 */
export class EventEmitter {
  /**
   * 이벤트 리스너 저장소
   *
   * Map<이벤트타입, Set<핸들러들>>
   *
   * Map을 쓰는 이유:
   * - 키로 다양한 타입 사용 가능 (여기선 문자열)
   * - 순서 보장
   * - has(), get(), set() 메서드 제공
   *
   * Set을 쓰는 이유:
   * - 중복 방지 (같은 핸들러 두 번 등록 안 됨)
   * - 삭제가 O(1)로 빠름
   */
  private listeners = new Map<GridEventType, Set<GridEventHandler<GridEventType>>>();

  /**
   * 와일드카드 리스너 (모든 이벤트 수신)
   *
   * 디버깅이나 로깅에 유용합니다.
   */
  private wildcardListeners = new Set<GridEventHandler<GridEventType>>();

  /**
   * 이벤트 구독
   *
   * @param type - 구독할 이벤트 타입
   * @param handler - 이벤트 발생 시 호출될 함수
   * @returns 구독 해제 함수
   *
   * @example
   * // 구독
   * const unsubscribe = emitter.on('data:loaded', (event) => {
   *   console.log(event.payload.rowCount);
   * });
   *
   * // React에서 사용
   * useEffect(() => {
   *   const unsubscribe = emitter.on('indices:updated', handler);
   *   return unsubscribe;  // cleanup 시 자동 해제
   * }, []);
   */
  on<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): Unsubscribe {
    // 해당 이벤트 타입의 리스너 Set이 없으면 생성
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    // 핸들러 추가
    // as 캐스팅: TypeScript에게 "이 타입이 맞아"라고 알려줌
    const handlers = this.listeners.get(type)!;
    handlers.add(handler as GridEventHandler<GridEventType>);

    // 구독 해제 함수 반환 (클로저 활용)
    // 이 함수는 handler와 type을 "기억"하고 있음
    return () => {
      this.off(type, handler);
    };
  }

  /**
   * 모든 이벤트 구독 (와일드카드)
   *
   * 디버깅이나 로깅 용도로 사용합니다.
   *
   * @param handler - 모든 이벤트를 받는 핸들러
   * @returns 구독 해제 함수
   *
   * @example
   * emitter.onAny((event) => {
   *   console.log(`[${event.type}]`, event.payload);
   * });
   */
  onAny(handler: GridEventHandler<GridEventType>): Unsubscribe {
    this.wildcardListeners.add(handler);
    return () => {
      this.wildcardListeners.delete(handler);
    };
  }

  /**
   * 이벤트 구독 해제
   *
   * @param type - 이벤트 타입
   * @param handler - 해제할 핸들러
   *
   * @example
   * emitter.off('data:loaded', myHandler);
   */
  off<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.delete(handler as GridEventHandler<GridEventType>);

      // 핸들러가 없으면 Map에서도 제거 (메모리 정리)
      if (handlers.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  /**
   * 한 번만 실행되는 구독
   *
   * 이벤트가 발생하면 자동으로 구독 해제됩니다.
   *
   * @param type - 이벤트 타입
   * @param handler - 핸들러
   * @returns 구독 해제 함수
   *
   * @example
   * // 첫 번째 데이터 로드 시에만 실행
   * emitter.once('data:loaded', (event) => {
   *   console.log('최초 로드 완료!');
   * });
   */
  once<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): Unsubscribe {
    // 래퍼 함수: 한 번 실행 후 자동 해제
    const onceHandler: GridEventHandler<T> = (event) => {
      this.off(type, onceHandler);  // 먼저 해제
      handler(event);               // 그 다음 실행
    };

    return this.on(type, onceHandler);
  }

  /**
   * 이벤트 발행
   *
   * 등록된 모든 핸들러에게 이벤트를 전달합니다.
   *
   * @param type - 이벤트 타입
   * @param payload - 이벤트 데이터
   *
   * @example
   * emitter.emit('data:loaded', { rowCount: 100, columnCount: 5 });
   */
  emit<T extends GridEventType>(
    type: T,
    payload: GridEventPayloads[T]
  ): void {
    // 이벤트 객체 생성
    const event: GridEvent<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    // 해당 타입의 핸들러들 실행
    const handlers = this.listeners.get(type);
    if (handlers) {
      // Set을 배열로 복사 후 순회
      // (순회 중에 핸들러가 추가/삭제될 수 있으므로)
      for (const handler of [...handlers]) {
        this.safeCall(handler, event);
      }
    }

    // 와일드카드 리스너들도 실행
    for (const handler of [...this.wildcardListeners]) {
      this.safeCall(handler, event);
    }
  }

  /**
   * 안전하게 핸들러 호출
   *
   * 핸들러에서 에러가 발생해도 다른 핸들러는 계속 실행됩니다.
   *
   * @param handler - 실행할 핸들러
   * @param event - 이벤트 객체
   */
  private safeCall<T extends GridEventType>(
    handler: GridEventHandler<T>,
    event: GridEvent<T>
  ): void {
    try {
      handler(event);
    } catch (error) {
      // 에러가 발생해도 다른 핸들러는 계속 실행
      console.error(
        `[EventEmitter] Handler error for "${event.type}":`,
        error
      );
    }
  }

  /**
   * 특정 이벤트의 모든 리스너 제거
   *
   * @param type - 이벤트 타입
   *
   * @example
   * emitter.removeAllListeners('data:loaded');
   */
  removeAllListeners(type?: GridEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      // 인자 없으면 모든 리스너 제거
      this.listeners.clear();
      this.wildcardListeners.clear();
    }
  }

  /**
   * 리스너 개수 조회
   *
   * 디버깅이나 테스트에 유용합니다.
   *
   * @param type - 이벤트 타입 (없으면 전체)
   * @returns 리스너 개수
   */
  listenerCount(type?: GridEventType): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }

    // 전체 개수
    let count = this.wildcardListeners.size;
    for (const handlers of this.listeners.values()) {
      count += handlers.size;
    }
    return count;
  }

  /**
   * 등록된 이벤트 타입 목록
   *
   * @returns 이벤트 타입 배열
   */
  eventTypes(): GridEventType[] {
    return [...this.listeners.keys()];
  }

  /**
   * 모든 리소스 정리
   *
   * 컴포넌트 언마운트 시 호출합니다.
   */
  destroy(): void {
    this.removeAllListeners();
  }
}
