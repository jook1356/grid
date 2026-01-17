# 6회차: ArqueroProcessor + Worker

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

**Web Worker에서 Arquero를 사용해 데이터를 처리**하는 모듈을 구현했습니다.

---

## 왜 Web Worker인가요?

JavaScript는 싱글 스레드입니다. 100만 건 정렬 같은 무거운 작업을 하면:

```
[Worker 없이]
사용자 클릭 → 정렬 시작 (3초) → UI 멈춤 😰 → 정렬 완료 → UI 반응

[Worker 사용]  
사용자 클릭 → Worker에게 요청 → UI 계속 반응 😊
                ↓
            Worker: 백그라운드에서 정렬
                ↓
            완료 → 결과 전송 → 화면 업데이트
```

---

## 구현한 내용

### 1. ArqueroProcessor (Worker 내부)

Arquero 라이브러리를 사용한 데이터 처리기입니다.

| 메서드 | 설명 |
|--------|------|
| `initialize(data)` | 데이터를 Arquero Table로 변환 |
| `sort(sorts)` | 정렬 수행 |
| `filter(filters)` | 필터링 수행 |
| `query(options)` | 정렬 + 필터 동시 처리 |
| `aggregate(options)` | 그룹화 + 집계 |

### 2. worker.ts (Worker 엔트리포인트)

메인 스레드에서 오는 메시지를 받아 처리합니다.

```typescript
self.onmessage = async (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SORT':
      const result = await processor.sort(payload.sorts);
      self.postMessage(result, [result.indices.buffer]); // Transferable
      break;
    // ...
  }
};
```

### 3. WorkerBridge (메인 스레드)

Worker와 통신하는 브릿지입니다. Promise 기반 API를 제공합니다.

| 메서드 | 설명 |
|--------|------|
| `initialize()` | Worker 생성 및 준비 |
| `initializeData(data)` | 데이터 전송 |
| `sort(sorts)` | 정렬 요청 |
| `filter(filters)` | 필터 요청 |
| `query(options)` | 복합 쿼리 요청 |
| `aggregate(options)` | 집계 요청 |
| `destroy()` | Worker 종료 |

---

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/processor/ArqueroProcessor.ts` | Arquero 기반 프로세서 (~320줄) |
| `src/processor/worker.ts` | Worker 엔트리포인트 (~150줄) |
| `src/processor/WorkerBridge.ts` | Worker 통신 브릿지 (~280줄) |
| `src/types/arquero.d.ts` | Arquero 타입 선언 |

---

## 핵심 개념 정리

### 1. Web Worker 기본

```typescript
// 메인 스레드
const worker = new Worker('./worker.js');
worker.postMessage({ type: 'SORT', data: [...] });
worker.onmessage = (event) => console.log(event.data);

// Worker (worker.js)
self.onmessage = (event) => {
  const result = processData(event.data);
  self.postMessage(result);
};
```

### 2. Transferable Objects

```typescript
// 일반 전송: 데이터 복사 (느림)
self.postMessage({ indices: array });

// Transferable: 소유권 이전 (빠름, zero-copy)
self.postMessage({ indices: buffer }, [buffer]);
// 주의: 전송 후 Worker에서 buffer 접근 불가!
```

100만 개 인덱스 전송:
- 일반: ~100ms (복사)
- Transferable: ~1ms (소유권 이전)

### 3. Arquero 기본 사용법

```typescript
import * as aq from 'arquero';

// 테이블 생성
const table = aq.from([
  { name: 'Kim', age: 25 },
  { name: 'Lee', age: 30 },
]);

// 필터
const filtered = table.filter(d => d.age >= 25);

// 정렬
const sorted = table.orderby('name');
const sortedDesc = table.orderby(aq.desc('age'));

// 집계
const grouped = table
  .groupby('department')
  .rollup({ avgAge: aq.op.mean('age') });
```

### 4. Vite의 Worker 번들링

```typescript
// Vite가 이 문법을 보고 worker.ts를 별도 번들로 빌드
const worker = new Worker(
  new URL('./worker.ts', import.meta.url),
  { type: 'module' }
);
```

---

## 사용 예시

### 기본 사용

```typescript
const emitter = new EventEmitter();
const bridge = new WorkerBridge(emitter);

// 초기화
await bridge.initialize();

// 데이터 전송
await bridge.initializeData([
  { id: 1, name: 'Kim', age: 25 },
  { id: 2, name: 'Lee', age: 30 },
  // ... 100만 건
]);

// 정렬 요청 (Promise 반환)
const result = await bridge.sort([
  { columnKey: 'name', direction: 'asc' }
]);

console.log(result.indices);      // Uint32Array
console.log(result.filteredCount); // 100만
```

### 복합 쿼리

```typescript
// 필터 + 정렬 동시에
const result = await bridge.query({
  filters: [
    { columnKey: 'age', operator: 'gte', value: 20 },
    { columnKey: 'name', operator: 'contains', value: '김' }
  ],
  sorts: [
    { columnKey: 'age', direction: 'desc' }
  ]
});

console.log(result.totalCount);    // 100만
console.log(result.filteredCount); // 필터 통과 수
```

### 집계

```typescript
const result = await bridge.aggregate({
  groupBy: ['department'],
  aggregates: [
    { columnKey: 'salary', function: 'avg' },
    { columnKey: 'age', function: 'max' }
  ]
});

// [
//   { groupKey: 'IT', groupValues: { department: 'IT' }, 
//     aggregates: { avg_salary: 5000, max_age: 45 }, count: 100 },
//   ...
// ]
```

---

## 다음 회차 예고

### 7회차: GridCore (통합 파사드)

다음 회차에서는 모든 모듈을 통합하는 GridCore를 만듭니다.

**만들 파일:**
- `src/core/GridCore.ts`

**배울 내용:**
- 파사드 패턴
- 모듈 통합
- 공개 API 설계

**GridCore의 역할:**
- DataStore, IndexManager, WorkerBridge 통합
- 간단한 API 제공
- React/Vue에서 사용할 진입점
