# 4회차: DataStore (데이터 저장소)

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

**원본 데이터를 보관하고 CRUD 작업을 처리**하는 DataStore를 구현했습니다.

---

## DataStore의 역할

```
┌─────────────────────────────────────────────────┐
│                   DataStore                      │
├─────────────────────────────────────────────────┤
│ 역할:                                            │
│ • 원본 데이터 보관 (정렬/필터 적용 X)             │
│ • 컬럼 정의 보관                                  │
│ • 인덱스로 행 접근                               │
│ • CRUD 작업 (추가, 수정, 삭제)                   │
│ • 변경 시 이벤트 발행                            │
├─────────────────────────────────────────────────┤
│ 하지 않는 것:                                    │
│ • 정렬 (Processor가 함)                          │
│ • 필터링 (Processor가 함)                        │
│ • 가상화 (IndexManager + Renderer가 함)          │
└─────────────────────────────────────────────────┘
```

---

## 구현한 내용

### DataStore 클래스 메서드

#### 데이터 설정
| 메서드 | 설명 |
|--------|------|
| `setData(rows, columns)` | 데이터와 컬럼 설정 |
| `setColumns(columns)` | 컬럼만 설정 |

#### 읽기 (Read)
| 메서드 | 설명 |
|--------|------|
| `getData()` | 전체 데이터 (readonly) |
| `getColumns()` | 컬럼 정의 (readonly) |
| `getRowCount()` | 행 수 |
| `getRowByIndex(index)` | 인덱스로 행 접근 |
| `getRowsByIndices(indices)` | 여러 인덱스로 접근 (가상화용) |
| `getRowById(id)` | ID로 행 접근 |
| `getColumnByKey(key)` | 컬럼 키로 컬럼 정의 조회 |

#### 추가 (Create)
| 메서드 | 설명 |
|--------|------|
| `addRow(row)` | 행 추가 (맨 끝) |
| `insertRow(index, row)` | 특정 위치에 추가 |
| `addRows(rows)` | 여러 행 추가 |

#### 수정 (Update)
| 메서드 | 설명 |
|--------|------|
| `updateRow(index, newRow)` | 행 전체 교체 |
| `patchRow(index, updates)` | 행 부분 수정 |
| `setCellValue(index, key, value)` | 셀 값 수정 |

#### 삭제 (Delete)
| 메서드 | 설명 |
|--------|------|
| `removeRow(index)` | 행 삭제 |
| `removeRowById(id)` | ID로 삭제 |
| `removeRows(indices)` | 여러 행 삭제 |
| `clear()` | 모든 데이터 삭제 |

---

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/core/DataStore.ts` | 원본 데이터 저장소 (~380줄) |

---

## 핵심 개념 정리

### 1. readonly 타입

```typescript
// 외부에서 수정 방지
getData(): readonly Row[] {
  return this.rows;
}

// 사용하는 쪽
const data = store.getData();
data.push({});  // ❌ 컴파일 에러! readonly 배열
data[0] = {};   // ❌ 컴파일 에러! readonly 배열
```

TypeScript의 `readonly`는 외부에서 데이터를 직접 수정하는 것을 막아줍니다.

### 2. ID → 인덱스 맵

```typescript
// Map으로 빠른 조회
private idToIndexMap = new Map<string | number, number>();

// ID로 조회: O(1)
getRowById(id) {
  const index = this.idToIndexMap.get(id);  // 즉시 찾음
  return this.rows[index];
}

// Map 없이 조회: O(n)
getRowById(id) {
  return this.rows.find(row => row.id === id);  // 전체 순회
}
```

100만 건에서 ID로 조회할 때:
- Map 사용: 거의 즉시
- find 사용: 최악의 경우 100만 번 비교

### 3. 불변성 유지

```typescript
// 부분 수정할 때 새 객체 생성
patchRow(index, updates) {
  const oldRow = this.rows[index];
  const newRow = { ...oldRow, ...updates };  // 새 객체!
  this.rows[index] = newRow;
}
```

왜 새 객체를 만드나요?
- React/Vue가 변경을 감지할 수 있음
- 이전 상태 보존 (Undo 기능 가능)

### 4. 삭제 시 역순 처리

```typescript
removeRows(indices) {
  // 내림차순 정렬 (뒤에서부터 삭제)
  const sorted = [...indices].sort((a, b) => b - a);
  
  for (const index of sorted) {
    this.rows.splice(index, 1);
  }
}
```

왜 뒤에서부터?
```
인덱스 [1, 3, 5] 삭제 시

[앞에서부터 - 잘못된 방식]
1 삭제 → 3이 2가 됨 → 원래 3 아닌 다른 것 삭제!

[뒤에서부터 - 올바른 방식]
5 삭제 → 3 그대로 → 1 그대로 → 정확히 삭제!
```

---

## 사용 예시

### 기본 CRUD

```typescript
const emitter = new EventEmitter();
const store = new DataStore(emitter);

// 데이터 설정
store.setData(
  [
    { id: 1, name: '홍길동', age: 25 },
    { id: 2, name: '김철수', age: 30 },
  ],
  [
    { key: 'id', type: 'number' },
    { key: 'name', type: 'string' },
    { key: 'age', type: 'number' },
  ]
);

// 조회
const row = store.getRowById(1);  // { id: 1, name: '홍길동', ... }

// 추가
store.addRow({ id: 3, name: '박영희', age: 28 });

// 수정
store.patchRow(0, { age: 26 });

// 삭제
store.removeRowById(2);
```

### 이벤트 연동

```typescript
// 데이터 변경 감지
emitter.on('data:rowUpdated', (event) => {
  console.log(`${event.payload.index}번 행 수정됨`);
  console.log('변경된 필드:', event.payload.changedKeys);
});

// 셀 수정
store.setCellValue(0, 'name', '홍길순');
// 출력: "0번 행 수정됨"
// 출력: "변경된 필드: ['name']"
```

---

## 다음 회차 예고

### 5회차: IndexManager (인덱스 관리자)

다음 회차에서는 정렬/필터 결과 인덱스를 관리하는 IndexManager를 만듭니다.

**만들 파일:**
- `src/core/IndexManager.ts`

**배울 내용:**
- Uint32Array (타입드 배열)
- 인덱스 기반 데이터 관리
- 메모리 효율성

**IndexManager의 역할:**
- Processor가 반환한 인덱스 배열 보관
- 가상화를 위한 범위 인덱스 제공
- visible 행 수 계산
