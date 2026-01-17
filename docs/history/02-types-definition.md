# 2회차: 타입 정의 (types/)

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

모든 모듈의 기반이 되는 **타입(계약서)**을 정의했습니다.

---

## 왜 타입을 먼저 정의하나요?

1. **계약 우선 개발**: 구현 전에 "어떤 데이터가 오가는지" 정의
2. **자동완성 지원**: IDE가 타입을 보고 자동완성 제공
3. **컴파일 타임 오류**: 실수하면 실행 전에 에러 발생
4. **문서화 효과**: 타입 자체가 문서 역할

---

## 구현한 내용

### 1. data.types.ts - 데이터 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `CellValue` | 셀에 들어갈 수 있는 값 | `string \| number \| boolean \| Date \| null` |
| `Row` | 한 줄의 데이터 | `{ id: 1, name: "홍길동" }` |
| `ColumnDef` | 컬럼 정의 | `{ key: "name", type: "string" }` |
| `RowChange` | 행 변경 정보 | 실시간 업데이트, Undo용 |

### 2. state.types.ts - 상태 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `SortState` | 정렬 상태 | `{ columnKey: "name", direction: "asc" }` |
| `FilterState` | 필터 상태 | `{ columnKey: "age", operator: "gte", value: 20 }` |
| `GroupState` | 그룹화 상태 | `{ columnKeys: ["department"] }` |
| `ViewState` | 통합 뷰 상태 | sorts + filters + groups |
| `SelectionState` | 선택 상태 | 포커스된 셀, 선택 영역 등 |

### 3. event.types.ts - 이벤트 타입

| 타입 | 설명 |
|------|------|
| `GridEventType` | 가능한 이벤트 종류 (`'data:loaded'`, `'view:changed'` 등) |
| `GridEventPayloads` | 각 이벤트별 데이터 타입 |
| `GridEvent<T>` | 이벤트 객체 (type + payload + timestamp) |
| `GridEventHandler<T>` | 이벤트 핸들러 함수 타입 |

### 4. processor.types.ts - 프로세서 인터페이스

| 타입 | 설명 |
|------|------|
| `ProcessorResult` | 처리 결과 (인덱스 배열) |
| `IDataProcessor` | 프로세서 인터페이스 (핵심!) |
| `AggregateResult` | 집계 결과 |
| `WorkerRequest/Response` | Worker 통신 메시지 |

---

## 생성된 파일 목록

| 파일 | 라인 수 | 설명 |
|------|--------|------|
| `src/types/data.types.ts` | ~110 | 데이터 구조 타입 |
| `src/types/state.types.ts` | ~160 | 상태 관련 타입 |
| `src/types/event.types.ts` | ~165 | 이벤트 타입 |
| `src/types/processor.types.ts` | ~220 | 프로세서 인터페이스 |
| `src/types/index.ts` | ~45 | 타입 통합 내보내기 |

---

## 핵심 개념 정리

### 1. Union Type (유니온 타입)

```typescript
// 이 값은 이 중 하나만 될 수 있다
type CellValue = string | number | boolean | Date | null;

// 문자열도 가능
type SortDirection = 'asc' | 'desc';  // 이 두 문자열 중 하나만
```

### 2. Interface vs Type

```typescript
// Interface: 객체의 "모양"을 정의
interface Row {
  [key: string]: CellValue;
}

// Type: 더 유연함, Union 가능
type CellValue = string | number | null;

// 언제 뭘 써야 하나요?
// - 객체 모양 정의: interface
// - Union, 복잡한 타입: type
// - 둘 다 가능하면 취향 (일관성이 중요)
```

### 3. 제네릭 (Generic)

```typescript
// T는 "나중에 정해질 타입"
interface GridEvent<T extends GridEventType> {
  type: T;
  payload: GridEventPayloads[T];  // T에 따라 자동으로 결정
}

// 사용할 때 타입 지정
const event: GridEvent<'data:loaded'> = {
  type: 'data:loaded',
  payload: { rowCount: 100, columnCount: 5 }  // 자동완성 됨!
};
```

### 4. 인터페이스로 의존성 역전

```
[나쁜 예 - 직접 의존]
GridCore → ArqueroProcessor
          (Arquero 바꾸면 GridCore도 수정해야 함)

[좋은 예 - 인터페이스 의존]
GridCore → IDataProcessor (인터페이스)
                ↑
          ArqueroProcessor (구현)
          (다른 구현체로 바꿔도 GridCore 수정 불필요)
```

---

## 다음 회차 예고

### 3회차: EventEmitter (이벤트 시스템)

다음 회차에서는 이벤트를 발행/구독하는 시스템을 만듭니다.

**만들 파일:**
- `src/core/EventEmitter.ts`

**배울 내용:**
- Observer 패턴 (관찰자 패턴)
- Map과 Set 자료구조
- 클로저와 함수 반환

**왜 필요한가요?**
- React/Vue에서 Grid 상태 변화를 감지해야 함
- 모듈 간 느슨한 결합 (직접 호출 대신 이벤트로 통신)
