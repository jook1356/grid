/**
 * IndexManager - 인덱스 배열 관리자
 *
 * Processor가 반환한 정렬/필터 결과 인덱스를 관리합니다.
 * 원본 데이터는 건드리지 않고, 인덱스만으로 다양한 "뷰"를 표현합니다.
 *
 * 핵심 개념:
 * - 원본 인덱스: DataStore 배열의 실제 인덱스 (0, 1, 2, ...)
 * - 가시 인덱스: 현재 화면에 보이는 순서상의 인덱스
 *
 * @example
 * // 원본 데이터: ["C", "A", "B", "E", "D"]
 * // 정렬 후 인덱스: [1, 2, 0, 4, 3] → ["A", "B", "C", "D", "E"]
 *
 * const manager = new IndexManager(emitter);
 * manager.initialize(5);  // 5개 행
 * manager.setVisibleIndices(new Uint32Array([1, 2, 0, 4, 3]));
 *
 * // 가시 인덱스 0번 → 원본 인덱스 1번 → "A"
 * manager.toOriginalIndex(0);  // 1
 */

import type { ProcessorResult } from '../types';
import type { EventEmitter } from './EventEmitter';

/**
 * 인덱스 배열 관리자
 */
export class IndexManager {
  /**
   * 전체 행 수 (원본 데이터 기준)
   */
  private totalCount: number = 0;

  /**
   * 현재 보이는 행들의 원본 인덱스 배열
   *
   * Uint32Array를 사용하는 이유:
   * 1. 메모리 효율: 인덱스 하나당 정확히 4바이트
   *    - 일반 배열: 인덱스 하나당 8바이트 이상
   *    - Uint32Array: 100만 개 = 4MB
   *    - 일반 배열: 100만 개 = 8MB+
   *
   * 2. Transferable: Worker와 메인 스레드 간 복사 없이 전송
   *    - 일반 배열: postMessage 시 직렬화/역직렬화 필요
   *    - Uint32Array.buffer: 소유권만 이전 (zero-copy)
   *
   * 3. 타입 안전: 0 ~ 4,294,967,295 범위의 정수만 저장
   */
  private visibleIndices: Uint32Array = new Uint32Array(0);

  /**
   * @param events - 이벤트 발행기
   */
  constructor(private readonly events: EventEmitter) {}

  // ==========================================================================
  // 초기화
  // ==========================================================================

  /**
   * 초기화
   *
   * 데이터 로드 시 호출합니다.
   * 초기 상태에서는 모든 행이 순서대로 보입니다.
   *
   * @param rowCount - 전체 행 수
   *
   * @example
   * manager.initialize(1000000);  // 100만 행 초기화
   * // visibleIndices = [0, 1, 2, ..., 999999]
   */
  initialize(rowCount: number): void {
    this.totalCount = rowCount;

    // 모든 인덱스를 순서대로 (0, 1, 2, ..., n-1)
    this.visibleIndices = new Uint32Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
      this.visibleIndices[i] = i;
    }

    this.events.emit('indices:updated', {
      totalCount: rowCount,
      visibleCount: rowCount,
    });
  }

  // ==========================================================================
  // Processor 결과 적용
  // ==========================================================================

  /**
   * Processor 결과 적용
   *
   * Worker에서 정렬/필터링 결과가 오면 호출합니다.
   *
   * @param result - Processor 결과
   *
   * @example
   * // Worker에서 결과 수신
   * workerBridge.send('QUERY', { sorts, filters }).then(result => {
   *   indexManager.applyProcessorResult(result);
   * });
   */
  applyProcessorResult(result: ProcessorResult): void {
    this.totalCount = result.totalCount;
    this.visibleIndices = result.indices;

    this.events.emit('indices:updated', {
      totalCount: result.totalCount,
      visibleCount: result.filteredCount,
      processingTime: undefined,  // WorkerBridge에서 측정
    });
  }

  /**
   * 인덱스 배열 직접 설정
   *
   * @param indices - 새 인덱스 배열
   */
  setVisibleIndices(indices: Uint32Array): void {
    this.visibleIndices = indices;

    this.events.emit('indices:updated', {
      totalCount: this.totalCount,
      visibleCount: indices.length,
    });
  }

  // ==========================================================================
  // 인덱스 조회
  // ==========================================================================

  /**
   * 전체 가시 인덱스 반환
   *
   * @returns 현재 보이는 행들의 원본 인덱스 배열
   */
  getVisibleIndices(): Uint32Array {
    return this.visibleIndices;
  }

  /**
   * 범위 내 인덱스 반환 (가상화용)
   *
   * 화면에 보이는 범위만 가져올 때 사용합니다.
   *
   * @param start - 시작 가시 인덱스 (포함)
   * @param end - 끝 가시 인덱스 (미포함)
   * @returns 해당 범위의 원본 인덱스 배열
   *
   * @example
   * // 화면에 10~20번 행이 보일 때
   * const indices = manager.getIndicesInRange(10, 20);
   * const rows = dataStore.getRowsByIndices(indices);
   */
  getIndicesInRange(start: number, end: number): Uint32Array {
    // 범위 보정
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(end, this.visibleIndices.length);

    if (safeStart >= safeEnd) {
      return new Uint32Array(0);
    }

    // subarray: 새 배열 생성 없이 뷰만 반환 (메모리 효율적)
    // slice: 새 배열 복사본 생성
    // 여기서는 외부에서 수정할 수 있으므로 slice 사용
    return this.visibleIndices.slice(safeStart, safeEnd);
  }

  // ==========================================================================
  // 인덱스 변환
  // ==========================================================================

  /**
   * 가시 인덱스 → 원본 인덱스 변환
   *
   * 화면에서 n번째 행이 원본 데이터의 몇 번째인지 반환합니다.
   *
   * @param visibleIndex - 화면상 인덱스
   * @returns 원본 데이터 인덱스 (없으면 -1)
   *
   * @example
   * // 정렬 후 화면의 0번째 행이 원본 5번 행이라면
   * manager.toOriginalIndex(0);  // 5
   */
  toOriginalIndex(visibleIndex: number): number {
    const original = this.visibleIndices[visibleIndex];
    return original !== undefined ? original : -1;
  }

  /**
   * 원본 인덱스 → 가시 인덱스 변환
   *
   * 원본 데이터의 n번째가 화면에서 몇 번째인지 반환합니다.
   * (선형 탐색 O(n) - 자주 호출하면 안 됨)
   *
   * @param originalIndex - 원본 데이터 인덱스
   * @returns 화면상 인덱스 (없으면 -1, 즉 필터링되어 안 보임)
   *
   * @example
   * // 원본 5번 행이 화면에서 안 보인다면 (필터링됨)
   * manager.toVisibleIndex(5);  // -1
   */
  toVisibleIndex(originalIndex: number): number {
    // indexOf는 TypedArray에서도 동작
    return this.visibleIndices.indexOf(originalIndex);
  }

  // ==========================================================================
  // 통계
  // ==========================================================================

  /**
   * 전체 행 수 (필터 적용 전)
   */
  getTotalCount(): number {
    return this.totalCount;
  }

  /**
   * 현재 보이는 행 수 (필터 적용 후)
   */
  getVisibleCount(): number {
    return this.visibleIndices.length;
  }

  /**
   * 특정 원본 인덱스가 현재 보이는지 확인
   *
   * @param originalIndex - 원본 인덱스
   * @returns 보이면 true
   */
  isVisible(originalIndex: number): boolean {
    return this.visibleIndices.includes(originalIndex);
  }

  /**
   * 필터링된 행 수 (= 전체 - 보이는 수)
   */
  getFilteredOutCount(): number {
    return this.totalCount - this.visibleIndices.length;
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * 인덱스 배열 복사본 반환
   *
   * 외부에서 수정해도 내부에 영향 없음
   */
  cloneVisibleIndices(): Uint32Array {
    return new Uint32Array(this.visibleIndices);
  }

  /**
   * 초기 상태로 리셋
   *
   * 정렬/필터 해제 시 호출
   */
  reset(): void {
    this.initialize(this.totalCount);
  }

  /**
   * 비어있는지 확인
   */
  isEmpty(): boolean {
    return this.visibleIndices.length === 0;
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.visibleIndices = new Uint32Array(0);
    this.totalCount = 0;
  }
}
