# 19. VirtualRowBuilder 분리 및 formatRow API

## 개요

GroupManager에서 VirtualRow[] 생성 책임을 분리하여 관심사 분리(SRP)를 달성했습니다.
또한 Wijmo의 formatItem보다 20배 효율적인 formatRow API를 추가했습니다.

## 문제 상황

### 1. GroupManager의 과도한 책임

기존 GroupManager가 너무 많은 책임을 가지고 있었습니다:

```typescript
// 기존 GroupManager의 책임
class GroupManager {
  // 1. 그룹 설정 관리
  // 2. 그룹 상태 관리 (접기/펼치기)
  // 3. 그룹 트리 구축
  // 4. VirtualRow[] 플래트닝 ← 관심사 분리 필요
  // 5. 캐싱
}
```

### 2. Wijmo formatItem의 성능 문제

```javascript
// 1000행 × 20열 = 20,000번 콜백 호출
grid.formatItem.addHandler((s, e) => {
  if (e.panel === s.cells) {
    e.cell.style.backgroundColor = '...';
  }
});
```

## 해결 방안

### Hybrid 아키텍처 채택

```
                    공통 파이프라인
              Source → Filter → Sort
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
     Flat           Grouped          Pivot
     Mode           GroupMgr        PivotProc
        │               │               │
        └───────────────┼───────────────┘
                        ▼
               VirtualRowBuilder
              → VirtualRow[] 생성
                        │
                        ▼
               formatRow 적용
              (행 단위 포맷팅)
                        │
                        ▼
                  BodyRenderer
```

## 구현 내용

### 1. VirtualRowBuilder 클래스

```typescript
// src/ui/row/VirtualRowBuilder.ts

type RowSource = FlatSource | GroupedSource | PivotSource;

class VirtualRowBuilder {
  build(source: RowSource): VirtualRow[] {
    const key = this.computeCacheKey(source);
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }
    // 소스 타입별 처리
    switch (source.type) {
      case 'flat': return this.buildFlat(source.data);
      case 'grouped': return this.buildGrouped(source);
      case 'pivot': return this.buildPivot(source);
    }
  }
}
```

### 2. GroupManager 책임 축소

```typescript
// GroupManager는 이제 그룹 상태 관리만 담당
class GroupManager {
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

  // @deprecated - VirtualRowBuilder 사용 권장
  flattenWithGroups(data: Row[]): VirtualRow[];
}
```

### 3. formatRow API

```typescript
// Discriminated Union으로 타입 안전한 컨텍스트 제공
type FormatRowInfo =
  | { type: 'data'; ctx: DataRowContext }
  | { type: 'group-header'; ctx: GroupHeaderContext }
  | { type: 'subtotal'; ctx: SubtotalContext }
  | { type: 'grand-total'; ctx: SubtotalContext };

type FormatRowCallback = (info: FormatRowInfo) => void;

// DataRowContext 예시
interface DataRowContext {
  viewIndex: number;
  dataIndex: number;
  rowId?: string | number;
  data: Row;
  groupPath: string[];
  rowState: RowState;          // Dirty State
  originalData?: Row;
  changedFields?: Set<string>;
  rowElement: HTMLElement;
  cells: Record<string, CellInfo>;
}
```

### 4. Dirty State CSS

```css
/* 추가된 행 */
.ps-row.ps-row-added {
  background-color: rgba(76, 175, 80, 0.08);
  border-left: 3px solid #4caf50;
}

/* 수정된 행 */
.ps-row.ps-row-modified {
  background-color: rgba(255, 193, 7, 0.08);
  border-left: 3px solid #ffc107;
}

/* 삭제 예정 행 */
.ps-row.ps-row-deleted {
  background-color: rgba(244, 67, 54, 0.08);
  border-left: 3px solid #f44336;
  opacity: 0.6;
}
```

### 5. RowState 타입

```typescript
// src/types/grouping.types.ts

type RowState =
  | 'pristine'   // 원본 그대로
  | 'added'      // 새로 추가됨
  | 'modified'   // 수정됨
  | 'deleted';   // 삭제 예정
```

## 성능 비교

| 시나리오 | formatItem (Wijmo) | formatRow (제안) |
|----------|-------------------|------------------|
| 1000행 × 20열 | 20,000 콜백 | 1,000 콜백 |
| 연관 셀 처리 | 조건 중복 검사 | 한 번에 처리 |
| 스크롤 (50행 visible) | 1,000 콜백 | 50 콜백 |

## 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [...],
  data: myData,

  // 행 단위 포맷팅
  formatRow: (info) => {
    if (info.type === 'data') {
      const { rowState, cells, rowElement } = info.ctx;

      // 음수 금액 강조
      if (cells['amount']?.value < 0) {
        cells['amount'].element.classList.add('negative');
      }

      // 수정된 셀에 툴팁 추가
      if (rowState === 'modified' && info.ctx.changedFields) {
        for (const field of info.ctx.changedFields) {
          const cell = cells[field];
          if (cell) {
            cell.element.title = `원본: ${cell.originalValue}`;
          }
        }
      }
    }
  }
});
```

## 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/ui/row/VirtualRowBuilder.ts` | 신규 생성 |
| `src/ui/row/index.ts` | VirtualRowBuilder export 추가 |
| `src/ui/grouping/GroupManager.ts` | 책임 축소, buildTree/getCollapsedSet/getAggregates 추가 |
| `src/ui/body/BodyRenderer.ts` | VirtualRowBuilder 사용, formatRow 콜백 지원 |
| `src/ui/GridRenderer.ts` | formatRow 옵션 전달 |
| `src/ui/utils/configAdapter.ts` | formatRow 옵션 추가 |
| `src/types/grouping.types.ts` | RowState, GroupFooterRow, SubtotalRow, GrandTotalRow 추가 |
| `src/types/field.types.ts` | FormatRowCallback 및 관련 타입 추가 |
| `src/types/index.ts` | 새 타입 export |
| `src/ui/style/default.css` | Dirty State CSS 스타일 추가 |
| `docs/decisions/012-virtual-row-builder-and-format-row.md` | 설계 결정 문서 |

## 향후 계획

### Phase 5: CRUD 및 Dirty State 통합
1. ChangeTracker 클래스 생성 (pending changes 관리)
2. VirtualRowBuilder에서 ChangeTracker 병합 로직 추가
3. PureSheet에 CRUD API 추가 (addRow, updateCell, deleteRow)
4. commit(), discard() 메서드 구현

### Phase 6: UndoStack 통합
1. UndoStack + Command 패턴 구현
2. ChangeTracker 변경을 Command로 래핑
3. Undo/Redo 시 ChangeTracker 상태 복원

## 변경 이력

### 2026-01
- VirtualRowBuilder 클래스 생성 (관심사 분리)
- GroupManager 책임 축소 (그룹 상태 관리만)
- formatRow API 추가 (행 단위 포맷팅)
- RowState 타입 추가 (Dirty State 패턴)
- Dirty State CSS 스타일 추가
- 타입 export 정리
