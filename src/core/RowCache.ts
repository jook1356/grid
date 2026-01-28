/**
 * RowCache - Worker에서 가져온 행 데이터 캐시
 *
 * Worker 기반 가상 데이터 로딩에서 사용됩니다.
 * 화면에 보이는 행만 Worker에서 요청하고, 캐시하여 재사용합니다.
 *
 * 특징:
 * - LRU 기반 캐시 정리
 * - filter/sort 변경 시 자동 무효화
 * - 범위 기반 조회/저장
 */

import type { Row } from '../types/data.types';

/**
 * 캐시 설정
 */
export interface RowCacheConfig {
  /** 최대 캐시 행 수 (기본값: 500) */
  maxRows?: number;

  /** 뷰포트 대비 버퍼 배율 (기본값: 2) */
  bufferMultiplier?: number;
}

/**
 * 캐시 항목
 */
interface CacheEntry {
  row: Row;
  accessTime: number;
}

/**
 * 범위 조회 결과
 */
export interface RangeResult {
  /** 캐시에서 찾은 행들 (인덱스 순서대로) */
  rows: (Row | null)[];

  /** 캐시에 없는 인덱스들 */
  missingIndices: number[];

  /** 모든 행이 캐시에 있는지 여부 */
  complete: boolean;
}

/**
 * 행 데이터 캐시
 */
export class RowCache {
  /** 캐시 저장소 (인덱스 → 항목) */
  private cache = new Map<number, CacheEntry>();

  /** 캐시 버전 (filter/sort 변경 시 증가) */
  private version = 0;

  /** 최대 캐시 행 수 */
  private maxRows: number;

  /** 뷰포트 대비 버퍼 배율 */
  private bufferMultiplier: number;

  constructor(config: RowCacheConfig = {}) {
    this.maxRows = config.maxRows ?? 500;
    this.bufferMultiplier = config.bufferMultiplier ?? 2;
  }

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  /**
   * 단일 행 조회
   */
  get(index: number): Row | null {
    const entry = this.cache.get(index);
    if (!entry) return null;

    // 접근 시간 업데이트 (LRU)
    entry.accessTime = Date.now();
    return entry.row;
  }

  /**
   * 단일 행 저장
   */
  set(index: number, row: Row): void {
    this.cache.set(index, {
      row,
      accessTime: Date.now(),
    });

    // 캐시 크기 초과 시 정리
    if (this.cache.size > this.maxRows) {
      this.evictOldest();
    }
  }

  /**
   * 행 존재 여부 확인
   */
  has(index: number): boolean {
    return this.cache.has(index);
  }

  // ==========================================================================
  // 범위 연산
  // ==========================================================================

  /**
   * 범위 조회
   *
   * @param startIndex - 시작 인덱스 (inclusive)
   * @param endIndex - 끝 인덱스 (exclusive)
   * @returns 조회 결과 (캐시된 행 + 누락 인덱스)
   */
  getRange(startIndex: number, endIndex: number): RangeResult {
    const rows: (Row | null)[] = [];
    const missingIndices: number[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      const row = this.get(i);
      rows.push(row);
      if (row === null) {
        missingIndices.push(i);
      }
    }

    return {
      rows,
      missingIndices,
      complete: missingIndices.length === 0,
    };
  }

  /**
   * 범위 저장
   *
   * @param startIndex - 시작 인덱스
   * @param rows - 저장할 행 배열
   */
  setRange(startIndex: number, rows: Row[]): void {
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row) {
        this.cache.set(startIndex + i, {
          row,
          accessTime: now,
        });
      }
    }

    // 캐시 크기 초과 시 정리
    if (this.cache.size > this.maxRows) {
      this.evictOldest();
    }
  }

  // ==========================================================================
  // 캐시 관리
  // ==========================================================================

  /**
   * 캐시 무효화 (filter/sort 변경 시 호출)
   */
  invalidate(): void {
    this.cache.clear();
    this.version++;
  }

  /**
   * 현재 캐시 버전
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 캐시된 행 수
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 캐시 완전 삭제
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 특정 범위 외의 캐시 정리
   *
   * @param keepStart - 유지할 범위 시작
   * @param keepEnd - 유지할 범위 끝
   */
  evictOutsideRange(keepStart: number, keepEnd: number): void {
    // 버퍼 적용
    const bufferSize = Math.ceil((keepEnd - keepStart) * this.bufferMultiplier);
    const rangeStart = Math.max(0, keepStart - bufferSize);
    const rangeEnd = keepEnd + bufferSize;

    for (const index of this.cache.keys()) {
      if (index < rangeStart || index >= rangeEnd) {
        this.cache.delete(index);
      }
    }
  }

  // ==========================================================================
  // 내부 헬퍼
  // ==========================================================================

  /**
   * 가장 오래된 항목들 제거 (LRU)
   */
  private evictOldest(): void {
    // 삭제할 개수 (20% 정리)
    const evictCount = Math.ceil(this.maxRows * 0.2);

    // 접근 시간으로 정렬
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].accessTime - b[1].accessTime
    );

    // 가장 오래된 항목들 삭제
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      this.cache.delete(entries[i]![0]);
    }
  }

  // ==========================================================================
  // 디버그
  // ==========================================================================

  /**
   * 캐시 상태 정보
   */
  getStats(): {
    size: number;
    version: number;
    maxRows: number;
    cachedRanges: { start: number; end: number }[];
  } {
    const indices = Array.from(this.cache.keys()).sort((a, b) => a - b);
    const ranges: { start: number; end: number }[] = [];

    if (indices.length > 0) {
      let rangeStart = indices[0]!;
      let rangeEnd = indices[0]!;

      for (let i = 1; i < indices.length; i++) {
        if (indices[i] === rangeEnd + 1) {
          rangeEnd = indices[i]!;
        } else {
          ranges.push({ start: rangeStart, end: rangeEnd + 1 });
          rangeStart = indices[i]!;
          rangeEnd = indices[i]!;
        }
      }
      ranges.push({ start: rangeStart, end: rangeEnd + 1 });
    }

    return {
      size: this.cache.size,
      version: this.version,
      maxRows: this.maxRows,
      cachedRanges: ranges,
    };
  }
}
