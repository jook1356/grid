# 009. Worker 제거 및 메인 스레드 처리 전환

## 상태
**승인됨** (2026-01-21)

## 컨텍스트

기존 PureSheet Grid는 데이터 처리(정렬, 필터링, 집계)를 Web Worker에서 수행하도록 설계되었습니다:

```
현재 아키텍처:
┌─────────────┐    postMessage    ┌─────────────┐
│ Main Thread │ ───────────────→  │   Worker    │
│  GridCore   │                   │  Arquero    │
│  DataStore  │ ←───────────────  │  Processor  │
└─────────────┘    postMessage    └─────────────┘
```

그러나 피벗 그리드 확장을 검토하면서, Worker 아키텍처의 실제 비용을 분석한 결과 **예상과 다른 결론**에 도달했습니다.

---

## 문제점

### 1. 데이터 전송 비용이 연산 비용보다 큼

100만 건 기준 시간 분석:

| 단계 | 시간 | 설명 |
|------|------|------|
| 직렬화 (메인) | 300-1000ms | **UI 블로킹 발생** |
| 복사 전송 | 200-1000ms | 메모리 복제 |
| 연산 (Worker) | 200-500ms | 정렬/필터 |
| 결과 전송 | 50-200ms | 인덱스 배열 반환 |
| **총계** | **750-2700ms** | |

반면, 메인 스레드에서 직접 처리 시:

| 단계 | 시간 |
|------|------|
| 연산 | 200-500ms |
| **총계** | **200-500ms** |

**Worker를 사용하면 오히려 3-5배 느려집니다.**

### 2. 직렬화 시 UI 블로킹

```typescript
// postMessage 호출 시 직렬화가 메인 스레드에서 발생
worker.postMessage(data);  // 이 시점에 300-1000ms 블로킹!
```

Worker의 목적이 UI 블로킹 방지인데, **데이터 전송 자체가 블로킹을 유발**합니다.

### 3. 상용 그리드들의 선택

| 라이브러리 | Worker 사용 | 서버 사이드 |
|-----------|------------|------------|
| AG Grid | ❌ | ✅ |
| Handsontable | ❌ | ✅ |
| DevExtreme | ❌ | ✅ |
| Kendo UI | ❌ | ✅ |
| Syncfusion | ❌ | ✅ |

**모든 주요 상용 그리드가 Worker를 사용하지 않습니다.** 대신:
- 가상화로 렌더링 최적화
- 대용량은 서버 사이드로 처리

---

## 결정

### Worker 제거, 메인 스레드에서 직접 처리

```
새로운 아키텍처:
┌──────────────────────────────────────┐
│           Main Thread                │
│  ┌──────────────────────────────┐    │
│  │         GridCore             │    │
│  │  ┌────────┐ ┌─────────────┐  │    │
│  │  │DataStore│ │ArqueroProcessor│ │    │
│  │  └────────┘ └─────────────┘  │    │
│  │  ┌────────────┐              │    │
│  │  │IndexManager│              │    │
│  │  └────────────┘              │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

### 삭제할 파일

```
src/processor/
├── WorkerBridge.ts    ← 삭제
└── worker.ts          ← 삭제
```

### 수정할 파일

```
src/core/GridCore.ts   ← WorkerBridge → ArqueroProcessor 직접 사용
src/processor/index.ts ← WorkerBridge export 제거
src/types/processor.types.ts ← Worker 메시지 타입 제거 (선택)
```

---

## 데이터 규모별 권장 처리 방식

| 데이터 규모 | 처리 방식 | 예상 시간 |
|------------|----------|----------|
| 1만 건 이하 | 메인 스레드 JS | ~10ms |
| 1-10만 건 | 메인 스레드 JS + 인덱싱 | ~50-100ms |
| 10-50만 건 | 메인 스레드 JS + 최적화 | ~100-300ms |
| 50만+ 건 | **서버 사이드 권장** | - |

---

## 최적화 전략

Worker 대신 다음 방법으로 성능을 확보합니다:

### 1. 인덱싱

```typescript
// 정렬용 인덱스 캐싱
class ArqueroProcessor {
  private sortedIndices = new Map<string, Uint32Array>();
  
  sort(column: string) {
    // 캐시된 인덱스 재사용
    if (this.sortedIndices.has(column)) {
      return this.sortedIndices.get(column);
    }
    // 계산 후 캐시
    const indices = this.computeSort(column);
    this.sortedIndices.set(column, indices);
    return indices;
  }
}
```

### 2. 디바운싱

```typescript
// 빠른 필터 입력 시 마지막 값만 처리
const debouncedFilter = debounce((value) => {
  processor.filter(value);
}, 150);
```

### 3. 가상화

```typescript
// 10만 건 있어도 화면에 보이는 건 50줄
const visibleRows = grid.getRowsInRange(scrollTop, scrollTop + viewportHeight);
// 50줄만 렌더링 → ~5ms
```

### 4. 서버 사이드 (대용량)

```typescript
// 50만+ 건은 서버에서 처리
const grid = new PureSheet(container, {
  serverSide: {
    url: '/api/grid',
    // 정렬/필터 쿼리를 서버로 전송
  }
});
```

---

## 고려했던 대안

### 대안 1: WASM 사용

```
장점: 연산 4-10배 빠름
단점: JS 객체 ↔ WASM 변환 비용, 문자열 처리 복잡, 개발 복잡도
결론: 변환 비용 포함하면 총 이득 30-50% 수준, 복잡도 대비 가치 낮음
```

### 대안 2: Worker + Transferable 최적화

```
장점: Zero-copy 전송
단점: 초기 전송(직렬화)은 여전히 블로킹, TypedArray만 가능
결론: JS 객체 기반 데이터에는 적용 어려움
```

### 대안 3: SharedArrayBuffer

```
장점: 진정한 공유 메모리
단점: COOP/COEP 헤더 필요, 브라우저 호환성, 보안 제약
결론: 배포 환경 제약이 너무 큼
```

---

## 결과

### 장점

1. **구조 단순화**: Worker 통신 레이어 제거
2. **디버깅 용이**: 단일 스레드에서 스택 트레이스 가능
3. **번들 사이즈 감소**: Worker 파일 분리 불필요
4. **초기화 시간 단축**: Worker 로드 대기 시간 제거
5. **실제 성능 향상**: 전송 비용 제거로 3-5배 빠름

### 단점

1. **UI 블로킹 가능성**: 10만+ 건에서 ~100ms 블로킹
   - 대응: 로딩 인디케이터 표시
2. **대용량 처리 한계**: 50만+ 건은 클라이언트 한계
   - 대응: 서버 사이드 모드 제공

---

## 마이그레이션 가이드

### Before

```typescript
// GridCore에서 WorkerBridge 사용
class GridCore {
  private workerBridge: WorkerBridge;
  
  async initialize() {
    await this.workerBridge.initialize();
  }
  
  async sort(sorts: SortState[]) {
    const result = await this.workerBridge.query({ sorts });
    this.indexManager.applyProcessorResult(result);
  }
}
```

### After

```typescript
// GridCore에서 ArqueroProcessor 직접 사용
class GridCore {
  private processor: ArqueroProcessor;
  
  async initialize() {
    // Worker 초기화 불필요
  }
  
  async sort(sorts: SortState[]) {
    const result = await this.processor.query({ sorts });
    this.indexManager.applyProcessorResult(result);
  }
}
```

### API 변경 없음

```typescript
// 사용자 코드는 변경 불필요
const grid = new GridCore({ columns });
await grid.initialize();
await grid.loadData(data);
await grid.sort([{ columnKey: 'name', direction: 'asc' }]);
```

---

## 참고 자료

- [AG Grid - Client-Side vs Server-Side](https://www.ag-grid.com/javascript-data-grid/row-models/)
- [Web Workers - When to Use](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [Structured Clone Algorithm Performance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)

