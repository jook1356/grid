/**
 * WorkerBridge - Worker 통신 브릿지
 *
 * 메인 스레드에서 Worker와 통신하는 인터페이스입니다.
 * Promise 기반 API로 요청/응답을 처리합니다.
 *
 * 역할:
 * 1. Worker 생성 및 관리
 * 2. 요청 ID 관리 (요청-응답 매칭)
 * 3. Promise 기반 API 제공
 * 4. Transferable 데이터 복원
 *
 * @example
 * const bridge = new WorkerBridge(eventEmitter);
 * await bridge.initialize();
 *
 * // Promise 기반 API
 * const result = await bridge.query({
 *   sorts: [{ columnKey: 'name', direction: 'asc' }]
 * });
 */

import type { EventEmitter } from '../core/EventEmitter';
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerRequestType,
  Row,
  SortState,
  FilterState,
  QueryOptions,
  AggregateQueryOptions,
  ProcessorResult,
  AggregateResult,
} from '../types';
// PivotResult는 ArqueroProcessor에서 직접 정의한 것을 사용
import type { PivotResult, PivotOptions } from './ArqueroProcessor';

/**
 * 대기 중인 요청 정보
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  type: WorkerRequestType;
  startTime: number;
}

/**
 * Worker 통신 브릿지
 */
export class WorkerBridge {
  /** Worker 인스턴스 */
  private worker: Worker | null = null;

  /** 요청 ID 카운터 */
  private requestId = 0;

  /** 대기 중인 요청들 */
  private pendingRequests = new Map<number, PendingRequest>();

  /** Worker 준비 완료 여부 */
  private isReady = false;

  /** Worker 준비 대기 Promise */
  private readyPromise: Promise<void> | null = null;

  /**
   * @param events - 이벤트 발행기
   */
  constructor(private readonly events: EventEmitter) {}

  // ==========================================================================
  // 초기화 / 정리
  // ==========================================================================

  /**
   * Worker 초기화
   *
   * Worker 스크립트를 로드하고 준비 완료를 대기합니다.
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      return; // 이미 초기화됨
    }

    // Worker 생성
    // Vite는 이 문법을 보고 worker.ts를 별도 번들로 빌드함
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' }
    );

    // 메시지 핸들러 설정
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

    // Worker 준비 완료 대기
    this.readyPromise = new Promise<void>((resolve) => {
      const checkReady = (event: MessageEvent) => {
        if (event.data?.type === 'READY') {
          this.isReady = true;
          resolve();
        }
      };
      this.worker!.addEventListener('message', checkReady, { once: true });
    });

    await this.readyPromise;
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    // 대기 중인 요청 모두 reject
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('WorkerBridge destroyed'));
      this.pendingRequests.delete(id);
    }

    // Worker 종료
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.isReady = false;
  }

  // ==========================================================================
  // 메시지 핸들러
  // ==========================================================================

  /**
   * Worker 응답 처리
   */
  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const { id, type, payload, error } = event.data;

    // READY 메시지는 초기화에서 처리
    if (type === 'READY' as unknown) {
      return;
    }

    // 대기 중인 요청 찾기
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      console.warn(`No pending request for id: ${id}`);
      return;
    }

    this.pendingRequests.delete(id);

    // 처리 시간 계산
    const duration = Date.now() - pending.startTime;

    // 이벤트 발행
    this.events.emit('processing:end', {
      operation: pending.type,
      duration,
      success: type !== 'ERROR',
    });

    // 응답 처리
    if (type === 'ERROR') {
      pending.reject(new Error(error ?? 'Unknown error'));
    } else {
      pending.resolve(payload);
    }
  }

  /**
   * Worker 에러 처리
   */
  private handleError(event: ErrorEvent): void {
    console.error('Worker error:', event.message);
    this.events.emit('error', {
      code: 'WORKER_ERROR',
      message: event.message,
    });
  }

  // ==========================================================================
  // 요청 전송
  // ==========================================================================

  /**
   * Worker에 요청 전송 (내부)
   */
  private async send<T>(
    type: WorkerRequestType,
    payload: unknown,
    transferables?: Transferable[]
  ): Promise<T> {
    if (!this.worker || !this.isReady) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    const id = ++this.requestId;

    // 이벤트 발행
    this.events.emit('processing:start', {
      operation: type,
    });

    // Promise 생성
    return new Promise<T>((resolve, reject) => {
      // 대기 목록에 추가
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        type,
        startTime: Date.now(),
      });

      // 요청 전송
      const request: WorkerRequest = { id, type, payload };
      this.worker!.postMessage(request, transferables ?? []);
    });
  }

  // ==========================================================================
  // 공개 API
  // ==========================================================================

  /**
   * 데이터 초기화
   *
   * @param data - 원본 데이터 배열
   */
  async initializeData(data: Row[]): Promise<void> {
    await this.send('INITIALIZE', { data });
  }

  /**
   * 정렬
   *
   * @param sorts - 정렬 조건
   * @returns 정렬된 인덱스 배열
   */
  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    const result = await this.send<{
      indices: ArrayBuffer;
      totalCount: number;
      filteredCount: number;
    }>('SORT', { sorts });

    return this.restoreProcessorResult(result);
  }

  /**
   * 필터링
   *
   * @param filters - 필터 조건
   * @returns 필터링된 인덱스 배열
   */
  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    const result = await this.send<{
      indices: ArrayBuffer;
      totalCount: number;
      filteredCount: number;
    }>('FILTER', { filters });

    return this.restoreProcessorResult(result);
  }

  /**
   * 복합 쿼리 (필터 + 정렬)
   *
   * @param options - 쿼리 옵션
   * @returns 처리된 인덱스 배열
   */
  async query(options: QueryOptions): Promise<ProcessorResult> {
    const result = await this.send<{
      indices: ArrayBuffer;
      totalCount: number;
      filteredCount: number;
    }>('QUERY', options);

    return this.restoreProcessorResult(result);
  }

  /**
   * 집계
   *
   * @param options - 집계 옵션
   * @returns 집계 결과
   */
  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    return this.send<AggregateResult[]>('AGGREGATE', options);
  }

  /**
   * 피봇
   *
   * 데이터를 피봇하여 행↔열 변환을 수행합니다.
   * 새로운 Row[]와 ColumnDef[]를 반환합니다.
   *
   * @param options - 피봇 옵션
   * @returns 피봇 결과 (rows, columns, generatedValueColumnKeys)
   *
   * @example
   * const result = await bridge.pivot({
   *   rowFields: ['department'],
   *   columnFields: ['year', 'quarter'],
   *   valueFields: [{ field: 'sales', aggregate: 'sum' }]
   * });
   * // result.rows: 피봇된 행 데이터
   * // result.columns: 동적 생성된 컬럼 정의
   */
  async pivot(options: PivotOptions): Promise<PivotResult> {
    return this.send<PivotResult>('PIVOT', options);
  }

  /**
   * Worker 정리
   */
  async destroyProcessor(): Promise<void> {
    await this.send('DESTROY', {});
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * Transferable에서 ProcessorResult 복원
   *
   * Worker에서 ArrayBuffer로 전송된 데이터를 Uint32Array로 복원합니다.
   */
  private restoreProcessorResult(result: {
    indices: ArrayBuffer;
    totalCount: number;
    filteredCount: number;
  }): ProcessorResult {
    return {
      indices: new Uint32Array(result.indices),
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
    };
  }

  /**
   * Worker 준비 여부
   */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * 대기 중인 요청 수
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
