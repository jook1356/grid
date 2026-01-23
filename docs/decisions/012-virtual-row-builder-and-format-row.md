# 012. VirtualRowBuilder 분리 및 formatRow API

## 상태
**구현됨** (2026-01-23)

Phase 1-3 구현 완료:
- VirtualRowBuilder 클래스 생성
- GroupManager 책임 축소
- formatRow API 추가

## 컨텍스트

### 1. 현재 구조의 문제점

GroupManager가 너무 많은 책임을 가지고 있습니다:

```typescript
// 현재 GroupManager의 책임 (SRP 위반)
class GroupManager {
  // 1. 그룹 설정 관리
  private groupColumns: string[] = [];
  private aggregates: Record<string, AggregateFn> = {};

  // 2. 그룹 상태 관리 (접기/펼치기)
  private collapsedGroups: Set<string> = new Set();

  // 3. 그룹 트리 구축
  buildGroupTree(data): GroupNode[]

  // 4. VirtualRow[] 플래트닝 ← 관심사 분리 필요
  flattenWithGroups(data): VirtualRow[]

  // 5. 캐싱
  private cachedVirtualRows: VirtualRow[] | null = null;
}
```

### 2. Wijmo formatItem의 성능 문제

Wijmo FlexGrid의 `formatItem`은 매 셀마다 호출됩니다:

```javascript
// 1000행 × 20열 = 20,000번 콜백 호출
grid.formatItem.addHandler((s, e) => {
  if (e.panel === s.cells) {
    e.cell.style.backgroundColor = '...';
  }
});
```

**문제점:**
- O(rows × cols) 콜백 호출
- 스크롤마다 재실행
- 연관 셀 처리 시 조건 검사 중복

### 3. 피벗 부분합과의 통합 고려

향후 피벗에 부분합(Subtotals) 기능이 추가될 예정:

```
Grouping: 그룹 헤더가 "위"에 배치
┌─────────────────────────────────────┐
│ [▼ Engineering] (합계: $240,000)   │ ← group-header (위)
│     김철수     $80,000              │
│     이영희     $70,000              │
└─────────────────────────────────────┘

Pivot: 부분합이 "아래"에 배치
┌─────────────────────────────────────┐
│ East  │ Prod A │  100  │            │
│       │ Prod B │  200  │            │
│       │Subtotal│  300  │            │ ← subtotal (아래)
└─────────────────────────────────────┘
```

두 기능 모두 **VirtualRow[] 배열 생성**이라는 공통점이 있습니다.

### 4. Row CRUD 및 UndoStack 고려

향후 Row CRUD (Create, Read, Update, Delete)와 UndoStack 기능이 추가될 예정입니다.

#### 데이터 흐름 (CRUD + Undo 포함)

```
┌─────────────────────────────────────────────────────────────────┐
│                         UndoStack                                │
│  - Command 패턴으로 변경사항 추적                                 │
│  - push(command), undo(), redo()                                │
│  - DataStore 수준에서 동작                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DataStore                                │
│  - addRow(row), updateRow(id, changes), deleteRow(id)           │
│  - 변경 시 'data:changed' 이벤트 발행                            │
│  - version 번호 관리 (캐시 무효화용)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                         data:changed
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   GroupManager        PivotProcessor         Selection
   (트리 재빌드)        (피벗 재계산)          (무효 ID 제거)
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │    VirtualRowBuilder    │
                 │   (캐시 무효화 + 재생성)  │
                 └─────────────────────────┘
```

#### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **rowId 기반 식별** | dataIndex는 CRUD 시 변경되므로, 행 식별은 반드시 rowId 사용 |
| **Stateless Builder** | VirtualRowBuilder는 상태 없이 소스 데이터만 변환 |
| **버전 기반 캐시** | DataStore.version으로 캐시 무효화 판단 |
| **UndoStack 위치** | DataStore 상위에서 Command 패턴으로 동작 |

#### VirtualRow의 행 식별

```typescript
interface VirtualRow {
  type: RowVariant;

  // 행 식별 (CRUD 안전)
  rowId?: string | number;   // ← 필수: 불변 식별자
  dataIndex?: number;        // ← 참고용: CRUD 시 변경될 수 있음

  data?: Row;
  // ...
}
```

#### 캐시 무효화 전략

```typescript
interface RowSource {
  type: 'flat' | 'grouped' | 'pivot';
  data: Row[];
  dataVersion: number;  // ← DataStore.version
}

class VirtualRowBuilder {
  private cacheVersion: number = -1;

  build(source: RowSource): VirtualRow[] {
    // 버전이 다르면 캐시 무효화
    if (source.dataVersion !== this.cacheVersion) {
      this.invalidate();
      this.cacheVersion = source.dataVersion;
    }
    // ...
  }
}
```

#### Selection 보존 전략

```typescript
// CRUD 후 Selection 정리
class SelectionManager {
  onDataChanged(validRowIds: Set<string | number>): void {
    // 삭제된 행의 선택 제거
    for (const id of this.state.selectedRows) {
      if (!validRowIds.has(id)) {
        this.state.selectedRows.delete(id);
      }
    }

    // 셀 선택도 정리 (rowId 기반으로 변경 필요)
    // ...
  }
}
```

#### Dirty State 패턴 (Pending Changes)

CRUD 작업은 원본 데이터에 즉시 반영하지 않고, 별도의 ChangeTracker에서 관리합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Original DataStore                            │
│  - 원본 데이터 (불변)                                             │
│  - commit() 호출 전까지 변경 안됨                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ChangeTracker                                │
│  - added: Row[]                    (추가된 행들)                 │
│  - modified: Map<rowId, Changes>   (수정된 행들)                 │
│  - deleted: Set<rowId>             (삭제된 행 ID들)              │
│                                                                  │
│  + addRow(), updateRow(), deleteRow()                           │
│  + commit() → DataStore에 반영                                   │
│  + discard() → 변경사항 폐기                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               VirtualRowBuilder (Merged View)                    │
│  - Original + Pending Changes 병합                              │
│  - 각 행에 RowState 부여                                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Row State (행 변경 상태)

```typescript
/**
 * 행 변경 상태
 */
type RowState =
  | 'pristine'   // 원본 그대로
  | 'added'      // 새로 추가됨 (commit 전)
  | 'modified'   // 수정됨 (commit 전)
  | 'deleted';   // 삭제 예정 (commit 전)

/**
 * 수정된 행 정보
 */
interface ModifiedRow {
  rowId: string | number;
  originalData: Row;           // 원본 (되돌리기용)
  currentData: Row;            // 현재 (수정된 값)
  changedFields: Set<string>;  // 변경된 필드들
}
```

#### ChangeTracker 인터페이스

```typescript
interface ChangeTracker {
  // 상태
  readonly hasChanges: boolean;
  readonly addedRows: Row[];
  readonly modifiedRows: Map<string | number, ModifiedRow>;
  readonly deletedRowIds: Set<string | number>;

  // 변경 메서드
  addRow(row: Row, insertIndex?: number): void;
  updateCell(rowId: string | number, field: string, value: CellValue): void;
  deleteRow(rowId: string | number): void;

  // 행 상태 조회
  getRowState(rowId: string | number): RowState;
  getOriginalData(rowId: string | number): Row | undefined;
  getChangedFields(rowId: string | number): Set<string> | undefined;

  // 커밋/폐기
  commit(): Promise<void>;  // DataStore에 반영
  discard(): void;          // 전체 변경사항 폐기
  discardRow(rowId: string | number): void;  // 특정 행만 폐기
}
```

#### DOM 상태 표현

```css
/* 행 상태별 스타일 */
.ps-row-added {
  background-color: rgba(76, 175, 80, 0.1);
  border-left: 3px solid #4caf50;
}

.ps-row-modified {
  background-color: rgba(255, 193, 7, 0.1);
  border-left: 3px solid #ffc107;
}

.ps-row-deleted {
  background-color: rgba(244, 67, 54, 0.1);
  text-decoration: line-through;
  opacity: 0.6;
}

/* 셀 단위 수정 표시 */
.ps-cell-modified {
  background-color: rgba(255, 193, 7, 0.2);
}
```

#### UndoStack과의 관계

UndoStack은 ChangeTracker 위에서 동작합니다:

```typescript
class UndoStack {
  push(command: Command): void;
  undo(): void;  // ChangeTracker 상태 복원
  redo(): void;
}

// UndoStack은 ChangeTracker의 변경을 추적
// commit() 후에는 UndoStack도 초기화
```
```

---

## 결정

### Hybrid 아키텍처 채택

공통 파이프라인 + 모드별 처리기 + 통합 VirtualRowBuilder 구조를 채택합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    공통 파이프라인 (기존)                         │
│                 Source → Filter → Sort                          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐          ┌──────────┐          ┌──────────┐
   │  Flat   │          │ Grouped  │          │  Pivot   │
   │  Mode   │          │GroupMgr  │          │PivotProc │
   └─────────┘          └──────────┘          └──────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │    VirtualRowBuilder    │
                 │  → VirtualRow[] 생성     │
                 └─────────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │      formatRow 적용      │
                 │  (행 단위 포맷팅 콜백)    │
                 └─────────────────────────┘
                              │
                              ▼
                        BodyRenderer
```

---

## 상세 설계

### 1. 행 타입 정의

```typescript
/**
 * 행 변형 타입
 */
type RowVariant =
  | 'data'           // 일반 데이터 행
  | 'group-header'   // 그룹 헤더 (Grouping, 위에 배치)
  | 'group-footer'   // 그룹 푸터 (향후 Grouping 소계)
  | 'subtotal'       // 부분합 (Pivot, 아래에 배치)
  | 'grand-total';   // 총합

/**
 * 행 변경 상태
 */
type RowState =
  | 'pristine'   // 원본 그대로
  | 'added'      // 새로 추가됨 (commit 전)
  | 'modified'   // 수정됨 (commit 전)
  | 'deleted';   // 삭제 예정 (commit 전)

/**
 * 통합 VirtualRow
 */
interface VirtualRow {
  type: RowVariant;

  // 행 식별 (CRUD 안전)
  rowId?: string | number;   // 불변 식별자 (CRUD 후에도 유지)

  // 데이터 행용
  dataIndex?: number;        // 현재 배열 인덱스 (CRUD 시 변경 가능)
  data?: Row;
  groupPath?: GroupIdentifier[];

  // 변경 상태 (Dirty State)
  rowState: RowState;                 // 행의 변경 상태
  originalData?: Row;                 // modified일 때 원본 보관
  changedFields?: Set<string>;        // 변경된 필드 목록

  // 집계 행용 (group-header, subtotal 등)
  aggregateInfo?: {
    level: number;
    groupKey?: string;
    column?: string;
    value?: CellValue;
    itemCount?: number;
    collapsed?: boolean;
    aggregates: Record<string, CellValue>;
  };

  // 피벗 전용
  mergeInfo?: RowMergeInfo;
}
```

### 2. VirtualRowBuilder

```typescript
/**
 * VirtualRow 소스 타입
 */
interface BaseSource {
  dataVersion: number;  // DataStore.version (캐시 무효화용)
}

interface FlatSource extends BaseSource {
  type: 'flat';
  data: Row[];
}

interface GroupedSource extends BaseSource {
  type: 'grouped';
  data: Row[];
  groupTree: GroupNode[];
  collapsedSet: Set<string>;
  aggregates: Record<string, AggregateFn>;
}

interface PivotSource extends BaseSource {
  type: 'pivot';
  pivotResult: PivotResult;
}

type RowSource = FlatSource | GroupedSource | PivotSource;

/**
 * VirtualRow 배열 생성기
 *
 * 다양한 소스로부터 통합된 VirtualRow[] 배열을 생성합니다.
 * Stateless 설계로 CRUD/Undo와 자연스럽게 통합됩니다.
 */
class VirtualRowBuilder {
  private cache: VirtualRow[] | null = null;
  private cacheKey: string | null = null;

  /**
   * 소스로부터 VirtualRow[] 생성
   *
   * 캐시 키는 dataVersion + 소스 타입별 상태로 구성됩니다.
   * CRUD 발생 시 dataVersion이 증가하여 자동으로 캐시가 무효화됩니다.
   */
  build(source: RowSource): VirtualRow[] {
    const key = this.computeCacheKey(source);
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }

    let result: VirtualRow[];

    switch (source.type) {
      case 'flat':
        result = this.buildFlat(source.data);
        break;
      case 'grouped':
        result = this.buildGrouped(source);
        break;
      case 'pivot':
        result = this.buildPivot(source.pivotResult);
        break;
    }

    this.cache = result;
    this.cacheKey = key;
    return result;
  }

  /**
   * 캐시 키 계산
   *
   * - dataVersion: CRUD 시 증가 → 캐시 무효화
   * - collapsedSet: 그룹 펼치기/접기 시 변경
   * - pivotResult.meta: 피벗 결과 변경 감지
   */
  private computeCacheKey(source: RowSource): string {
    const base = `v${source.dataVersion}`;

    switch (source.type) {
      case 'flat':
        return `${base}:flat`;
      case 'grouped':
        return `${base}:grouped:${[...source.collapsedSet].sort().join(',')}`;
      case 'pivot':
        return `${base}:pivot:${source.pivotResult.meta.totalRows}`;
    }
  }

  private buildFlat(data: Row[]): VirtualRow[];
  private buildGrouped(source: GroupedSource): VirtualRow[];
  private buildPivot(result: PivotResult): VirtualRow[];

  invalidate(): void {
    this.cache = null;
    this.cacheKey = null;
  }
}
```

### 3. GroupManager (책임 축소)

```typescript
/**
 * 그룹 상태 관리자
 *
 * 그룹 설정과 접기/펼치기 상태만 관리합니다.
 * VirtualRow[] 생성은 VirtualRowBuilder가 담당합니다.
 */
class GroupManager {
  private groupColumns: string[] = [];
  private aggregates: Record<string, AggregateFn> = {};
  private collapsedGroups: Set<string> = new Set();

  // 설정
  setConfig(config: GroupingConfig): void;
  getGroupColumns(): string[];
  getAggregates(): Record<string, AggregateFn>;

  // 상태 관리
  toggleGroup(groupId: string): boolean;
  expandAll(): void;
  collapseAll(): void;
  isCollapsed(groupId: string): boolean;
  getCollapsedSet(): Set<string>;

  // 트리 빌드 (플래트닝 없이)
  buildTree(data: Row[]): GroupNode[];

  // 활성화 여부
  hasGrouping(): boolean;
}
```

### 4. formatRow API

```typescript
/**
 * 데이터 행 포맷팅 컨텍스트
 */
interface DataRowContext {
  viewIndex: number;
  dataIndex: number;
  rowId: string | number;       // 불변 식별자 (CRUD 안전)
  data: Row;
  groupPath: GroupIdentifier[];

  // 변경 상태 (Dirty State)
  rowState: RowState;           // 행의 변경 상태
  originalData?: Row;           // 원본 데이터 (비교/되돌리기용)
  changedFields?: Set<string>;  // 변경된 필드 목록

  // DOM
  rowElement: HTMLElement;
  cells: Record<string, {
    element: HTMLElement;
    value: CellValue;
    originalValue?: CellValue;  // 원본 값 (modified일 때)
    isModified: boolean;        // 이 셀이 수정되었는지
  }>;
}

/**
 * 그룹 헤더 포맷팅 컨텍스트
 */
interface GroupHeaderContext {
  viewIndex: number;
  groupId: string;
  column: string;
  value: CellValue;
  level: number;
  itemCount: number;
  collapsed: boolean;
  aggregates: Record<string, CellValue>;
  element: HTMLElement;
}

/**
 * 부분합 행 포맷팅 컨텍스트
 */
interface SubtotalContext {
  viewIndex: number;
  level: number;
  aggregates: Record<string, CellValue>;
  element: HTMLElement;
  cells: Record<string, {
    element: HTMLElement;
    value: CellValue;
  }>;
}

/**
 * 통합 포맷 정보 (Discriminated Union)
 */
type FormatRowInfo =
  | { type: 'data'; ctx: DataRowContext }
  | { type: 'group-header'; ctx: GroupHeaderContext }
  | { type: 'subtotal'; ctx: SubtotalContext }
  | { type: 'grand-total'; ctx: SubtotalContext };

/**
 * formatRow 콜백 타입
 */
type FormatRowCallback = (info: FormatRowInfo) => void;
```

### 5. 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [...],
  data: myData,

  // 행 단위 포맷팅 (셀 단위보다 20배 적은 콜백)
  formatRow: (info) => {
    if (info.type === 'data') {
      const { rowState, changedFields, cells, rowElement } = info.ctx;

      // === 비즈니스 로직 기반 포맷팅 ===
      if (info.ctx.data.status === 'error') {
        rowElement.classList.add('row-error');
        cells['status'].element.classList.add('cell-error');
      }

      // 음수 금액 강조
      if (cells['amount'].value < 0) {
        cells['amount'].element.classList.add('negative');
      }

      // === Dirty State 기반 포맷팅 ===
      // 기본 상태 클래스는 자동 적용됨 (.ps-row-added 등)
      // 추가 커스텀 처리가 필요한 경우:

      if (rowState === 'modified' && changedFields) {
        // 수정된 셀만 하이라이트
        for (const field of changedFields) {
          const cell = cells[field];
          if (cell) {
            cell.element.title = `원본: ${cell.originalValue}`;
          }
        }
      }

      if (rowState === 'deleted') {
        // 삭제 예정 행은 클릭 비활성화
        rowElement.style.pointerEvents = 'none';
      }

      if (rowState === 'added') {
        // 추가된 행에 아이콘 표시
        cells['id']?.element.insertAdjacentHTML('beforeend', ' 🆕');
      }
    }
    else if (info.type === 'group-header') {
      // 그룹 헤더 포맷팅
      if (info.ctx.level === 0) {
        info.ctx.element.style.fontWeight = 'bold';
      }
    }
    else if (info.type === 'subtotal') {
      // 피벗 부분합 포맷팅
      info.ctx.element.classList.add('subtotal-row');
    }
  }
});

// === CRUD 작업 ===
// 추가
grid.addRow({ id: 'new-1', name: '신규', amount: 1000 });

// 수정
grid.updateCell('row-5', 'amount', 2000);

// 삭제
grid.deleteRow('row-3');

// 변경사항 확인
console.log(grid.hasChanges());  // true
console.log(grid.getChanges());  // { added: [...], modified: [...], deleted: [...] }

// 커밋 (원본에 반영)
await grid.commitChanges();

// 또는 폐기
grid.discardChanges();

```

---

## 성능 비교

### formatItem (Wijmo) vs formatRow (제안)

| 시나리오 | formatItem | formatRow |
|----------|------------|-----------|
| 1000행 × 20열 | 20,000 콜백 | 1,000 콜백 |
| 연관 셀 처리 | 조건 중복 검사 | 한 번에 처리 |
| 스크롤 (50행 visible) | 1,000 콜백 | 50 콜백 |

### VirtualRowBuilder 성능

| 작업 | 복잡도 | 비고 |
|------|--------|------|
| Flat 변환 | O(n) | 단순 매핑 |
| Grouped 변환 | O(n) | 트리 순회 |
| Pivot 변환 | O(n) | PivotResult 매핑 |
| 캐시 히트 | O(1) | 키 비교만 |

---

## 마이그레이션 계획

### Phase 1: VirtualRowBuilder 추출
1. VirtualRowBuilder 클래스 생성
2. GroupManager에서 flattenWithGroups 로직 이동
3. BodyRenderer에서 VirtualRowBuilder 사용

### Phase 2: GroupManager 책임 축소
1. GroupManager에서 VirtualRow 관련 코드 제거
2. 순수 그룹 상태 관리만 담당하도록 정리
3. buildTree() 메서드만 유지

### Phase 3: formatRow API 추가
1. FormatRowInfo 타입 정의
2. BodyRenderer에 formatRow 콜백 통합
3. 셀 DOM 수집 헬퍼 구현

### Phase 4: 피벗 통합
1. PivotSource 타입으로 피벗 결과 처리
2. subtotal, grand-total 행 타입 지원
3. mergeInfo 통합

### Phase 5: CRUD 및 Dirty State 통합 (향후)
1. ChangeTracker 클래스 생성 (pending changes 관리)
2. RowState 타입 추가 (pristine, added, modified, deleted)
3. VirtualRowBuilder에서 ChangeTracker 병합 로직 추가
4. BodyRenderer에서 rowState CSS 클래스 자동 적용
5. PureSheet에 CRUD API 추가 (addRow, updateCell, deleteRow)
6. commit(), discard() 메서드 구현

### Phase 6: UndoStack 통합 (향후)
1. UndoStack + Command 패턴 구현
2. ChangeTracker 변경을 Command로 래핑
3. Undo/Redo 시 ChangeTracker 상태 복원
4. SelectionManager.onDataChanged() 연동

---

## 영향받는 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/ui/row/VirtualRowBuilder.ts` | 신규 생성 |
| `src/ui/grouping/GroupManager.ts` | 책임 축소, flattenWithGroups 제거 |
| `src/ui/body/BodyRenderer.ts` | VirtualRowBuilder 사용, formatRow 콜백, rowState CSS |
| `src/ui/PureSheet.ts` | formatRow 옵션, CRUD API 추가 |
| `src/types/grouping.types.ts` | RowVariant, VirtualRow, RowState 타입 확장 |
| `src/core/DataStore.ts` | version 필드 추가 (Phase 5) |
| `src/core/ChangeTracker.ts` | 신규 생성 - Dirty State 관리 (Phase 5) |
| `src/core/UndoStack.ts` | 신규 생성 - Command 패턴 (Phase 5) |
| `src/ui/interaction/SelectionManager.ts` | onDataChanged() 추가 (Phase 5) |
| `src/ui/style/default.css` | .ps-row-added/modified/deleted 스타일 (Phase 5) |

---

## 결론

1. **관심사 분리**: GroupManager는 그룹 상태만, VirtualRowBuilder는 배열 생성만
2. **성능 개선**: formatRow는 formatItem 대비 20배 적은 콜백
3. **통합 설계**: Grouping과 Pivot 모두 동일한 VirtualRow[] 구조 사용
4. **확장성**: 새로운 행 타입(RowVariant) 및 상태(RowState) 추가 용이
5. **CRUD 호환**: Stateless 설계 + 버전 기반 캐시로 CRUD 자연스럽게 지원
6. **Dirty State 지원**: ChangeTracker로 pending changes 관리, commit/discard 패턴
7. **UndoStack 호환**: ChangeTracker 상위에서 Command 패턴으로 동작
8. **시각적 피드백**: rowState에 따른 자동 CSS 클래스 + formatRow에서 커스텀 가능
