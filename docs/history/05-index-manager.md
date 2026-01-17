# 5회차: IndexManager (인덱스 관리자)

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

**정렬/필터 결과 인덱스를 관리**하는 IndexManager를 구현했습니다.

---

## IndexManager의 역할

```
┌─────────────────────────────────────────────────────────────┐
│                      데이터 흐름                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. DataStore: 원본 데이터 ["C", "A", "B", "E", "D"]         │
│                                                              │
│  2. Processor: 정렬 수행 → 인덱스 배열 반환 [1, 2, 0, 4, 3]  │
│                                                              │
│  3. IndexManager: 인덱스 배열 보관                           │
│                                                              │
│  4. 화면 표시:                                               │
│     visibleIndices[0] = 1 → DataStore[1] = "A"              │
│     visibleIndices[1] = 2 → DataStore[2] = "B"              │
│     ...                                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 구현한 내용

### IndexManager 클래스 메서드

#### 초기화
| 메서드 | 설명 |
|--------|------|
| `initialize(rowCount)` | 초기 인덱스 생성 [0, 1, 2, ...] |
| `reset()` | 초기 상태로 리셋 |

#### Processor 결과 적용
| 메서드 | 설명 |
|--------|------|
| `applyProcessorResult(result)` | Worker 결과 적용 |
| `setVisibleIndices(indices)` | 인덱스 배열 직접 설정 |

#### 인덱스 조회
| 메서드 | 설명 |
|--------|------|
| `getVisibleIndices()` | 전체 가시 인덱스 |
| `getIndicesInRange(start, end)` | 범위 인덱스 (가상화용) |

#### 인덱스 변환
| 메서드 | 설명 |
|--------|------|
| `toOriginalIndex(visibleIndex)` | 가시 → 원본 인덱스 |
| `toVisibleIndex(originalIndex)` | 원본 → 가시 인덱스 |

#### 통계
| 메서드 | 설명 |
|--------|------|
| `getTotalCount()` | 전체 행 수 |
| `getVisibleCount()` | 보이는 행 수 |
| `isVisible(originalIndex)` | 특정 행이 보이는지 |
| `getFilteredOutCount()` | 필터링된 행 수 |

---

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/core/IndexManager.ts` | 인덱스 관리자 (~260줄) |

---

## 핵심 개념 정리

### 1. Uint32Array (타입드 배열)

```typescript
// 일반 배열
const arr = [0, 1, 2, 3, 4];  // 각 요소 8바이트+

// Uint32Array
const typed = new Uint32Array([0, 1, 2, 3, 4]);  // 각 요소 정확히 4바이트
```

**Uint32Array의 장점:**

| 장점 | 설명 |
|------|------|
| 메모리 효율 | 요소당 정확히 4바이트 |
| Transferable | Worker 간 복사 없이 전송 |
| 타입 안전 | 0~4,294,967,295 정수만 저장 |
| 캐시 효율 | 연속 메모리로 CPU 캐시 적중률 높음 |

### 2. 가시 인덱스 vs 원본 인덱스

```typescript
// 원본 데이터 (DataStore)
const data = ["C", "A", "B", "E", "D"];
//            [0]  [1]  [2]  [3]  [4]  ← 원본 인덱스

// 정렬 후 (IndexManager)
const visibleIndices = [1, 2, 0, 4, 3];
//                      ↓  ↓  ↓  ↓  ↓
// 화면 표시:          "A" "B" "C" "D" "E"
//                     [0] [1] [2] [3] [4]  ← 가시 인덱스

// 변환
manager.toOriginalIndex(0);  // 1 (화면 0번 → 원본 1번)
manager.toVisibleIndex(0);   // 2 (원본 0번 → 화면 2번)
```

### 3. 가상화(Virtualization)와 연동

```typescript
// 화면에 10~20번 행만 보일 때
const visibleRange = { start: 10, end: 20 };

// IndexManager: 해당 범위의 원본 인덱스 가져오기
const indices = manager.getIndicesInRange(10, 20);
// 예: [45, 12, 78, 3, 99, 23, 56, 8, 34, 67]

// DataStore: 해당 인덱스들의 실제 데이터 가져오기
const rows = dataStore.getRowsByIndices(indices);
// 10개 행만 메모리에 로드
```

### 4. slice vs subarray

```typescript
// slice: 새 배열 복사 (안전하지만 메모리 사용)
const copy = array.slice(0, 10);

// subarray: 뷰만 반환 (빠르지만 원본 변경 시 영향)
const view = array.subarray(0, 10);
```

외부에 반환할 때는 `slice`로 복사본을 주는 것이 안전합니다.

---

## 사용 예시

### 기본 사용

```typescript
const emitter = new EventEmitter();
const indexManager = new IndexManager(emitter);

// 초기화 (100만 행)
indexManager.initialize(1000000);

// 현재 상태: [0, 1, 2, ..., 999999]
console.log(indexManager.getVisibleCount());  // 1000000
```

### Processor 결과 적용

```typescript
// Worker에서 정렬 결과 수신
const result: ProcessorResult = {
  indices: new Uint32Array([5, 2, 8, 1, 9, ...]),
  totalCount: 1000000,
  filteredCount: 500000  // 필터로 50만 건만 통과
};

indexManager.applyProcessorResult(result);

console.log(indexManager.getTotalCount());     // 1000000
console.log(indexManager.getVisibleCount());   // 500000
console.log(indexManager.getFilteredOutCount()); // 500000
```

### 가상화 연동

```typescript
// 화면에 보이는 범위만 가져오기
function getVisibleRows(scrollTop: number, rowHeight: number, viewportHeight: number) {
  const startIndex = Math.floor(scrollTop / rowHeight);
  const endIndex = startIndex + Math.ceil(viewportHeight / rowHeight) + 1;
  
  // IndexManager에서 해당 범위의 원본 인덱스
  const indices = indexManager.getIndicesInRange(startIndex, endIndex);
  
  // DataStore에서 실제 데이터
  return dataStore.getRowsByIndices(indices);
}
```

---

## 다음 회차 예고

### 6회차: ArqueroProcessor + Worker

다음 회차에서는 Web Worker에서 실행되는 데이터 처리 모듈을 만듭니다.

**만들 파일:**
- `src/processor/ArqueroProcessor.ts` - Arquero 기반 프로세서
- `src/processor/worker.ts` - Worker 엔트리포인트
- `src/processor/WorkerBridge.ts` - Worker 통신 브릿지

**배울 내용:**
- Web Worker 기본 개념
- Arquero 라이브러리 사용법
- postMessage와 Transferable Objects

**왜 중요한가요?**
- 100만 건 정렬/필터가 메인 스레드를 블로킹하지 않음
- UI가 항상 부드럽게 반응
