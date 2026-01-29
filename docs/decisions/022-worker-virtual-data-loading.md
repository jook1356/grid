# 022. Worker 가상 데이터 로딩 (Worker Virtual Data Loading)

## 상태
**인프라 구현됨** (2026-01-28)

### 구현 현황
- ✅ Phase 1: 기본 인프라
  - RowCache 클래스
  - IDataProcessor.fetchVisibleRows 인터페이스
  - WorkerProcessor.fetchVisibleRows 구현
  - processorWorker FETCH_VISIBLE_ROWS 핸들러
- ✅ Phase 2: GridCore 통합
  - RowCache 통합
  - getVisibleRowsAsync() 메서드
  - 캐시 무효화 (filter/sort 변경 시)
- ✅ Phase 3: VirtualScroller 연동 (인프라)
  - 핵심 인프라 완료
  - UI 완전 통합은 후속 작업
- ✅ Phase 4: 최적화
  - prefetchForScroll (스크롤 방향 기반 프리페치)
  - prefetchDebounced (요청 병합)
  - evictDistantCache (메모리 최적화)

## 배경 (Context)

현재 아키텍처의 문제점:

```
[현재 방식]
Worker에서 전체 데이터 처리 → 결과 전체를 Main Thread로 전송 → 렌더링

문제:
- 100만 건 데이터 = ~200MB 메모리 전송
- 초기 로딩 시 전체 데이터 복사 필요
- 메모리 이중 사용 (Worker + Main Thread)
```

**목표**: 화면에 보이는 행만 Worker에서 요청하여 메모리와 전송 비용 최소화

```
[개선된 방식]
Worker: 전체 데이터 보유 + 인덱스 관리
Main Thread: 보이는 행만 요청 (예: 50행)
→ 100만 건이어도 전송되는 데이터는 ~50행만
```

---

## 결정 (Decision)

### 1. 데이터 흐름 변경

```
[Before]
1. loadData(100만건) → Worker로 전송
2. filter/sort → 인덱스 배열 반환 (4MB)
3. Main Thread에서 getRowsInRange() → 이미 있는 데이터에서 추출

[After]
1. loadData(100만건) → Worker로 전송
2. filter/sort → 인덱스 배열만 반환 (4MB, Transferable)
3. Main Thread에서 fetchVisibleRows(start, end) → Worker에 요청
4. Worker가 해당 범위 행만 반환 (~50행, ~10KB)
```

### 2. 새로운 인터페이스

```typescript
// IDataProcessor 확장
interface IDataProcessor {
  // 기존 메서드들...

  /**
   * 가시 영역의 행 데이터를 비동기로 가져옵니다.
   *
   * @param startIndex - 시작 인덱스 (필터/정렬 후 순서)
   * @param endIndex - 끝 인덱스 (exclusive)
   * @returns 해당 범위의 Row 배열
   *
   * @example
   * // 화면에 0~50번 행이 보이는 경우
   * const visibleRows = await processor.fetchVisibleRows(0, 50);
   */
  fetchVisibleRows(startIndex: number, endIndex: number): Promise<Row[]>;

  /**
   * 현재 필터/정렬 상태의 총 행 수
   * (스크롤바 계산용)
   */
  getVisibleRowCount(): number;
}
```

### 3. 캐싱 전략

```typescript
interface RowCache {
  /** 캐시된 행 데이터 */
  rows: Map<number, Row>;

  /** 현재 캐시된 범위 */
  cachedRange: { start: number; end: number };

  /** 캐시 버전 (filter/sort 변경 시 무효화) */
  version: number;
}

// 캐시 정책
const CACHE_CONFIG = {
  /** 뷰포트 대비 캐시 크기 배율 */
  bufferMultiplier: 3,  // 뷰포트의 3배 캐시

  /** 최대 캐시 행 수 */
  maxCachedRows: 500,

  /** 프리페치 트리거 (뷰포트 끝에서 n% 도달 시) */
  prefetchThreshold: 0.7,
};
```

### 4. 스크롤 시 데이터 로딩 흐름

```
User Scrolls
    ↓
VirtualScroller.onScroll()
    ↓
새 visible range 계산 (예: 100-150)
    ↓
RowCache 확인
    ├── 캐시에 있음 → 즉시 렌더링
    └── 캐시에 없음 → fetchVisibleRows() 호출
                         ↓
                    Worker에 요청
                         ↓
                    응답 받으면 캐시 업데이트 + 렌더링
```

---

## 모듈 구조

### 디렉토리 구조

```
src/
├── processor/
│   ├── WorkerProcessor.ts      # fetchVisibleRows 추가
│   └── processorWorker.ts      # FETCH_ROWS 메시지 처리
│
├── core/
│   ├── GridCore.ts             # RowCache 관리
│   └── RowCache.ts             # 캐시 로직 (신규)
│
└── ui/
    └── VirtualScroller.ts      # 스크롤 시 데이터 요청
```

### 핵심 클래스

```typescript
// src/core/RowCache.ts
export class RowCache {
  private cache = new Map<number, Row>();
  private version = 0;
  private pendingRequests = new Map<string, Promise<Row[]>>();

  /**
   * 캐시에서 행 가져오기 (없으면 null)
   */
  get(index: number): Row | null;

  /**
   * 범위 내 행들 가져오기 (일부 누락 가능)
   */
  getRange(start: number, end: number): { rows: Row[]; missing: number[] };

  /**
   * 캐시에 행 저장
   */
  set(index: number, row: Row): void;

  /**
   * 범위로 캐시 저장
   */
  setRange(startIndex: number, rows: Row[]): void;

  /**
   * 캐시 무효화 (filter/sort 변경 시)
   */
  invalidate(): void;

  /**
   * 오래된 캐시 정리 (LRU)
   */
  evict(keepRange: { start: number; end: number }): void;
}
```

```typescript
// WorkerProcessor 변경
export class WorkerProcessor implements IDataProcessor {
  // ... 기존 메서드들

  async fetchVisibleRows(start: number, end: number): Promise<Row[]> {
    const result = await this.sendMessage('FETCH_ROWS', { start, end });
    return result.rows;
  }
}
```

```typescript
// processorWorker.ts 변경
case 'FETCH_ROWS': {
  const { start, end } = payload;

  // 현재 인덱스 배열에서 해당 범위 추출
  const targetIndices = currentIndices.slice(start, end);

  // 원본 데이터에서 해당 행들 추출
  const rows = await engine.getRows(Array.from(targetIndices));

  respond({ rows });
  break;
}
```

---

## GridCore 통합

```typescript
// GridCore.ts
class GridCore {
  private rowCache: RowCache;
  private processor: IDataProcessor;

  /**
   * 가시 영역 행 가져오기 (캐시 우선)
   */
  async getVisibleRows(start: number, end: number): Promise<Row[]> {
    // 1. 캐시 확인
    const { rows, missing } = this.rowCache.getRange(start, end);

    if (missing.length === 0) {
      return rows;
    }

    // 2. 누락된 범위 계산 (연속된 범위로 병합)
    const ranges = this.mergeToRanges(missing);

    // 3. Worker에서 누락된 행 가져오기
    const fetchPromises = ranges.map(([s, e]) =>
      this.processor.fetchVisibleRows(s, e)
    );
    const fetchedRows = await Promise.all(fetchPromises);

    // 4. 캐시 업데이트
    for (let i = 0; i < ranges.length; i++) {
      this.rowCache.setRange(ranges[i][0], fetchedRows[i]);
    }

    // 5. 완성된 행 배열 반환
    return this.rowCache.getRange(start, end).rows;
  }

  /**
   * filter/sort 변경 시
   */
  private onIndicesChanged(): void {
    this.rowCache.invalidate();
    // 현재 보이는 영역 다시 로드
    this.requestVisibleRows();
  }
}
```

---

## VirtualScroller 연동

```typescript
// VirtualScroller.ts
class VirtualScroller {
  private pendingFetch: Promise<void> | null = null;

  private async onScroll(): void {
    const { startIndex, endIndex } = this.calculateVisibleRange();

    // 버퍼 포함 범위 계산
    const bufferSize = Math.ceil((endIndex - startIndex) * 0.5);
    const fetchStart = Math.max(0, startIndex - bufferSize);
    const fetchEnd = Math.min(this.totalRows, endIndex + bufferSize);

    // 이미 요청 중이면 스킵 (debounce)
    if (this.pendingFetch) return;

    this.pendingFetch = this.gridCore
      .getVisibleRows(fetchStart, fetchEnd)
      .then(rows => {
        this.render(rows, startIndex, endIndex);
      })
      .finally(() => {
        this.pendingFetch = null;
      });
  }
}
```

---

## 성능 최적화

### 1. Transferable 활용

```typescript
// Worker → Main Thread 전송 시
const rowsBuffer = serializeRowsToArrayBuffer(rows);
self.postMessage(
  { id, type: 'SUCCESS', result: { buffer: rowsBuffer } },
  [rowsBuffer]  // Transferable로 전송 (복사 없음)
);
```

### 2. 청크 기반 프리페치

```typescript
// 스크롤 방향 감지하여 미리 로드
if (scrollDirection === 'down') {
  // 아래쪽 2청크 미리 로드
  prefetch(currentEnd, currentEnd + chunkSize * 2);
} else {
  // 위쪽 2청크 미리 로드
  prefetch(currentStart - chunkSize * 2, currentStart);
}
```

### 3. 요청 병합 (Debounce + Batch)

```typescript
// 빠른 스크롤 시 요청 병합
const debouncedFetch = debounce((ranges: Range[]) => {
  const merged = mergeOverlappingRanges(ranges);
  return fetchRows(merged);
}, 16);  // 1프레임
```

---

## 구현 단계

### Phase 1: 기본 인프라 (1-2시간)
1. `RowCache` 클래스 구현
2. `IDataProcessor.fetchVisibleRows()` 인터페이스 추가
3. `WorkerProcessor.fetchVisibleRows()` 구현
4. `processorWorker.ts`에 `FETCH_ROWS` 핸들러 추가

### Phase 2: GridCore 통합 (1-2시간)
1. `GridCore`에 `RowCache` 통합
2. `getVisibleRows()` 메서드 구현
3. 캐시 무효화 로직 (filter/sort 변경 시)

### Phase 3: VirtualScroller 연동 (1시간)
1. 스크롤 이벤트에서 `getVisibleRows()` 호출
2. 버퍼링 및 프리페치 로직

### Phase 4: 최적화 (1시간)
1. Transferable 직렬화
2. 요청 병합 (debounce)
3. 스크롤 방향 감지 프리페치

---

## 예상 효과

| 시나리오 | Before | After |
|---------|--------|-------|
| 초기 로딩 (100만건) | ~200MB 전송 | 인덱스만 4MB |
| 스크롤 시 | 메모리에서 추출 | ~50행 요청 (~10KB) |
| 메모리 사용 | Worker + Main 이중 | Worker만 전체 보유 |
| filter/sort 후 | 전체 재전송 | 인덱스만 + 보이는 행 |

---

## 고려사항

### 1. 로딩 상태 표시
```typescript
// 행이 아직 로드되지 않은 경우
<div class="row loading">
  <div class="skeleton"></div>
</div>
```

### 2. 오프라인 캐시
```typescript
// IndexedDB에 캐시하여 새로고침 후에도 유지
await idb.put('rowCache', { version, rows: cachedRows });
```

### 3. 메인 스레드 모드와의 호환
```typescript
// MainThreadProcessor는 동기적으로 동작 가능
if (!this.useWorker) {
  return this.processor.getRowsInRange(start, end);  // 동기
}
return this.processor.fetchVisibleRows(start, end);  // 비동기
```

---

---

## API 사용 예시

### 기본 사용

```typescript
// Worker 모드로 GridCore 생성
const grid = new GridCore({
  columns,
  useWorker: true,
  engine: 'aq',
});

await grid.initialize();
await grid.loadData(largeData);

// 비동기로 보이는 행만 가져오기
const rows = await grid.getVisibleRowsAsync(0, 50);
```

### 스크롤 시 프리페치

```typescript
// VirtualScroller의 rangeChanged 이벤트에서
virtualScroller.on('rangeChanged', ({ startIndex, endIndex }) => {
  // 현재 보이는 행 가져오기
  grid.getVisibleRowsAsync(startIndex, endIndex).then(rows => {
    renderRows(rows);
  });

  // 스크롤 방향 기반 프리페치 (debounced)
  grid.prefetchDebounced(startIndex, endIndex);

  // 먼 캐시 정리 (선택적)
  grid.evictDistantCache(startIndex, endIndex);
});
```

### 캐시 상태 확인

```typescript
// 디버그용 캐시 상태
const stats = grid.getCacheStats();
console.log('캐시된 행 수:', stats.size);
console.log('캐시 버전:', stats.version);
console.log('캐시된 범위:', stats.cachedRanges);
```

---

## 관련 문서

- [021. 엔진 추상화 아키텍처](./021-engine-abstraction-architecture.md)
- [013. 청크 기반 가상 스크롤](../history/13-chunk-based-virtual-scroll.md)
