# 7회차: GridCore (통합 파사드)

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

**모든 모듈을 통합하는 메인 클래스(파사드)**를 구현했습니다.

---

## 파사드 패턴이란?

복잡한 내부 시스템을 숨기고 간단한 인터페이스를 제공하는 패턴입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                        GridCore                              │
│   (간단한 API: sort, filter, getRowsInRange, ...)           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │EventEmitter│ │  DataStore  │  │IndexManager │          │
│  └──────────┘  └──────────────┘  └──────────────┘          │
│                                                              │
│  ┌──────────────────────────────────────────────┐          │
│  │              WorkerBridge                     │          │
│  │         (→ Worker → ArqueroProcessor)        │          │
│  └──────────────────────────────────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 구현한 내용

### GridCore 클래스 메서드

#### 초기화
| 메서드 | 설명 |
|--------|------|
| `constructor(options)` | 생성 (columns 필수) |
| `initialize()` | Worker 초기화 |
| `loadData(data)` | 데이터 로드 |

#### 정렬
| 메서드 | 설명 |
|--------|------|
| `sort(sorts)` | 정렬 적용 |
| `toggleSort(columnKey, multiSort?)` | 정렬 토글 |

#### 필터
| 메서드 | 설명 |
|--------|------|
| `filter(filters)` | 필터 적용 |
| `addFilter(filter)` | 필터 추가 |
| `removeFilter(columnKey)` | 필터 제거 |
| `clearFilters()` | 모든 필터 해제 |

#### 집계
| 메서드 | 설명 |
|--------|------|
| `aggregate(options)` | 그룹화 + 집계 |

#### 데이터 접근
| 메서드 | 설명 |
|--------|------|
| `getRowsInRange(start, end)` | 범위 내 행 (가상화용) |
| `getRowByVisibleIndex(index)` | 가시 인덱스로 조회 |
| `getRowById(id)` | ID로 조회 |
| `getAllData()` | 전체 데이터 |
| `getColumns()` | 컬럼 정의 |

#### CRUD
| 메서드 | 설명 |
|--------|------|
| `addRow(row)` | 행 추가 |
| `updateRow(index, updates)` | 행 수정 |
| `removeRow(index)` | 행 삭제 |

#### 상태 조회
| 메서드 | 설명 |
|--------|------|
| `getViewState()` | 현재 정렬/필터 상태 |
| `getTotalRowCount()` | 전체 행 수 |
| `getVisibleRowCount()` | 보이는 행 수 |

#### 이벤트
| 메서드 | 설명 |
|--------|------|
| `on(type, handler)` | 이벤트 구독 |
| `off(type, handler)` | 구독 해제 |
| `once(type, handler)` | 한 번만 실행 |

#### 정리
| 메서드 | 설명 |
|--------|------|
| `destroy()` | 리소스 정리 |

---

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/core/GridCore.ts` | 통합 파사드 클래스 (~500줄) |

---

## 사용 예시

### 기본 사용

```typescript
import { GridCore } from '@puresheet/core';

// 생성
const grid = new GridCore({
  columns: [
    { key: 'id', type: 'number' },
    { key: 'name', type: 'string' },
    { key: 'age', type: 'number' },
  ]
});

// 초기화
await grid.initialize();

// 데이터 로드
await grid.loadData([
  { id: 1, name: '홍길동', age: 25 },
  { id: 2, name: '김철수', age: 30 },
  // ... 100만 건
]);

// 정렬
await grid.sort([{ columnKey: 'name', direction: 'asc' }]);

// 필터
await grid.filter([{ columnKey: 'age', operator: 'gte', value: 20 }]);

// 화면에 표시할 데이터 가져오기
const rows = grid.getRowsInRange(0, 50);

// 정리
grid.destroy();
```

### React에서 사용

```tsx
function useGrid(columns: ColumnDef[]) {
  const gridRef = useRef<GridCore | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const grid = new GridCore({ columns });
    gridRef.current = grid;

    grid.initialize().then(() => {
      setLoading(false);
    });

    // 인덱스 변경 시 화면 업데이트
    const unsubscribe = grid.on('indices:updated', () => {
      setRows(grid.getRowsInRange(0, 50));
    });

    return () => {
      unsubscribe();
      grid.destroy();
    };
  }, [columns]);

  return { grid: gridRef.current, rows, loading };
}
```

### Vue에서 사용

```typescript
export function useGrid(columns: ColumnDef[]) {
  const grid = shallowRef<GridCore | null>(null);
  const rows = ref<Row[]>([]);
  const loading = ref(true);

  onMounted(async () => {
    grid.value = new GridCore({ columns });
    await grid.value.initialize();
    loading.value = false;

    grid.value.on('indices:updated', () => {
      rows.value = grid.value!.getRowsInRange(0, 50);
    });
  });

  onUnmounted(() => {
    grid.value?.destroy();
  });

  return { grid, rows, loading };
}
```

---

## 전체 아키텍처 완성!

```
┌─────────────────────────────────────────────────────────────┐
│                   사용자 애플리케이션                        │
│               (React / Vue / Angular)                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       GridCore                               │
│              (파사드 - 간단한 API 제공)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                    ┌──────────────┐       │
│  │  DataStore   │◄──── 이벤트 ────►│ EventEmitter │       │
│  │ (원본 데이터) │                    │ (이벤트 허브) │       │
│  └──────────────┘                    └──────────────┘       │
│         │                                   ▲               │
│         │                                   │               │
│         ▼                                   │               │
│  ┌──────────────┐                           │               │
│  │IndexManager │───── 이벤트 ────────────────┘               │
│  │ (인덱스 관리) │                                           │
│  └──────────────┘                                           │
│         ▲                                                   │
│         │ 결과                                               │
│         │                                                   │
│  ┌──────────────┐                                           │
│  │ WorkerBridge │                                           │
│  │ (Worker 통신) │                                           │
│  └──────────────┘                                           │
│         │                                                   │
└─────────┼───────────────────────────────────────────────────┘
          │ postMessage
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web Worker                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐          │
│  │           ArqueroProcessor                    │          │
│  │     (Arquero 기반 정렬/필터/집계)             │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 핵심 완료 항목

| 모듈 | 역할 | 상태 |
|------|------|------|
| types/ | 타입 정의 | ✅ |
| EventEmitter | 이벤트 시스템 | ✅ |
| DataStore | 원본 데이터 관리 | ✅ |
| IndexManager | 인덱스 배열 관리 | ✅ |
| ArqueroProcessor | 데이터 처리 (Worker) | ✅ |
| worker.ts | Worker 엔트리 | ✅ |
| WorkerBridge | Worker 통신 | ✅ |
| **GridCore** | **통합 파사드** | ✅ |

---

## 다음 단계

코어 라이브러리 구현이 완료되었습니다! 다음 단계로 가능한 작업들:

1. **테스트 작성**: 각 모듈의 단위 테스트
2. **DOM 렌더러**: 가상화된 테이블 렌더링
3. **프레임워크 래퍼**: React, Vue 컴포넌트
4. **기능 확장**: 셀 선택, 편집, 복사/붙여넣기 등
