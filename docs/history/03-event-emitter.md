# 3회차: EventEmitter (이벤트 시스템)

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

모든 모듈이 서로 통신하는 **이벤트 시스템**을 구현했습니다.

---

## 왜 이벤트 시스템이 필요한가요?

### 1. 느슨한 결합 (Loose Coupling)

```
[직접 호출] - 강한 결합
DataStore가 GridCore를 알아야 함 → 순환 의존성 위험

[이벤트 방식] - 느슨한 결합
DataStore는 그냥 이벤트만 발행 → 누가 듣든 상관없음
```

### 2. React/Vue 통합 용이

```typescript
// React에서 Grid 상태 변화 감지
useEffect(() => {
  const unsubscribe = grid.on('indices:updated', () => {
    setRows(grid.getRowsInRange(0, 50));
  });
  return unsubscribe;  // cleanup
}, []);
```

### 3. 확장성

새 기능 추가 시 기존 코드 수정 없이 이벤트만 구독하면 됨.

---

## 구현한 내용

### EventEmitter 클래스

| 메서드 | 설명 | 반환값 |
|--------|------|--------|
| `on(type, handler)` | 이벤트 구독 | 구독 해제 함수 |
| `off(type, handler)` | 이벤트 구독 해제 | - |
| `once(type, handler)` | 한 번만 실행 | 구독 해제 함수 |
| `emit(type, payload)` | 이벤트 발행 | - |
| `onAny(handler)` | 모든 이벤트 구독 | 구독 해제 함수 |
| `removeAllListeners(type?)` | 리스너 제거 | - |
| `listenerCount(type?)` | 리스너 개수 | number |
| `eventTypes()` | 등록된 이벤트 타입들 | string[] |
| `destroy()` | 리소스 정리 | - |

---

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/core/EventEmitter.ts` | 이벤트 발행/구독 클래스 (~230줄) |

---

## 핵심 개념 정리

### 1. Map과 Set

```typescript
// Map: 키-값 쌍 저장 (객체보다 유연함)
const map = new Map<string, number>();
map.set('age', 25);
map.get('age');  // 25
map.has('age');  // true

// Set: 중복 없는 값들의 집합
const set = new Set<string>();
set.add('a');
set.add('a');  // 중복 무시
set.size;      // 1
```

### 2. 클로저 (Closure)

```typescript
on(type, handler) {
  // ... 핸들러 등록 ...
  
  // 반환되는 함수가 type과 handler를 "기억"함
  return () => {
    this.off(type, handler);  // 클로저!
  };
}
```

클로저: 함수가 자신이 생성될 때의 환경(변수들)을 기억하는 것

### 3. 타입 안전한 이벤트

```typescript
// 이벤트 타입에 따라 payload 타입이 자동 결정
emitter.emit('data:loaded', { 
  rowCount: 100,      // ✅ 필수
  columnCount: 5      // ✅ 필수
});

emitter.emit('data:loaded', { 
  rowCount: 100
  // ❌ 컴파일 에러! columnCount 누락
});
```

### 4. 안전한 핸들러 호출

```typescript
private safeCall(handler, event) {
  try {
    handler(event);
  } catch (error) {
    console.error(error);
    // 에러가 발생해도 다른 핸들러는 계속 실행
  }
}
```

하나의 핸들러가 에러를 던져도 다른 핸들러들은 영향받지 않음.

---

## 사용 예시

### 기본 사용

```typescript
const emitter = new EventEmitter();

// 구독
const unsubscribe = emitter.on('data:loaded', (event) => {
  console.log(`${event.payload.rowCount}행 로드됨`);
});

// 발행
emitter.emit('data:loaded', { rowCount: 100, columnCount: 5 });
// 출력: "100행 로드됨"

// 구독 해제
unsubscribe();
```

### React에서 사용

```tsx
function useGridEvents(grid: GridCore) {
  const [rowCount, setRowCount] = useState(0);
  
  useEffect(() => {
    // 구독
    const unsubscribe = grid.on('indices:updated', (event) => {
      setRowCount(event.payload.visibleCount);
    });
    
    // cleanup 시 자동 해제
    return unsubscribe;
  }, [grid]);
  
  return rowCount;
}
```

### Vue에서 사용

```typescript
export function useGridEvents(grid: GridCore) {
  const rowCount = ref(0);
  
  onMounted(() => {
    grid.on('indices:updated', (event) => {
      rowCount.value = event.payload.visibleCount;
    });
  });
  
  onUnmounted(() => {
    grid.destroy();
  });
  
  return { rowCount };
}
```

---

## 다음 회차 예고

### 4회차: DataStore (데이터 저장소)

다음 회차에서는 원본 데이터를 관리하는 DataStore를 만듭니다.

**만들 파일:**
- `src/core/DataStore.ts`

**배울 내용:**
- 불변성(Immutability) 개념
- readonly 타입
- CRUD 작업 구현

**DataStore의 역할:**
- 원본 데이터 보관 (정렬/필터 적용 X)
- 인덱스로 행 접근
- 데이터 변경 시 이벤트 발행
