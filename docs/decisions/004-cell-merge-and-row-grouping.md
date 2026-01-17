# 004: 셀 병합 및 행 그룹화 전략

## 상태
**계획됨 (Planned)** - 2차 구현 예정

## 날짜
2026-01-17

## 배경

Grid 라이브러리에서 고급 기능으로 **셀 병합**과 **행 그룹화**가 필요합니다.
이 두 기능은 복잡도가 높아 1차 구현(기본 가상화) 완료 후 2차에서 구현합니다.

---

## 1. 셀 병합 (Cell Merge)

### 요구사항

- **가로 + 세로 병합** 모두 지원
- **데이터 레벨 + API 레벨** 둘 다 지원

### 병합 결과 예시

```
┌──────────────────┬────────┬────────┐
│   Merged Cell    │   B    │   C    │  ← 가로 병합 (colspan)
├────────┬─────────┼────────┼────────┤
│   D    │    E    │        │   G    │
├────────┼─────────┤   F    ├────────┤  ← 세로 병합 (rowspan)
│   H    │    I    │        │   J    │
└────────┴─────────┴────────┴────────┘
```

### 정의 방식

#### 방식 A: 데이터 레벨 (선언적)

```typescript
// 컬럼 정의에서 병합 전략 선언
const columns: ColumnDef[] = [
  {
    key: 'category',
    header: '카테고리',
    /**
     * 같은 값이 연속되면 자동으로 세로 병합
     */
    mergeStrategy: 'same-value',
  },
];

// 또는 데이터에 병합 메타데이터 포함
const data = [
  { 
    id: 1, 
    category: '과일', 
    name: '사과',
    __cellMeta: {
      category: { rowSpan: 3 }  // 3행 병합
    }
  },
  { id: 2, category: '과일', name: '바나나' },
  { id: 3, category: '과일', name: '오렌지' },
];
```

#### 방식 B: API 레벨 (명령적)

```typescript
const sheet = new PureSheet(container, options);

// Excel 스타일 범위로 병합
sheet.mergeCells('A1:C1');
sheet.mergeCells('B2:B5');

// 좌표로 병합
sheet.mergeCells({
  startRow: 0,
  startCol: 0,
  endRow: 2,
  endCol: 0
});

// 병합 해제
sheet.unmergeCells('A1:C1');

// 병합 상태 조회
const merges = sheet.getMergedCells();
// → [{ range: 'A1:C1', startRow: 0, ... }]

// 모든 병합 해제
sheet.clearMerges();
```

### 인터페이스 설계

```typescript
interface MergeRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface CellMeta {
  rowSpan?: number;
  colSpan?: number;
  merged?: boolean;      // 다른 셀에 병합된 상태
  mergeParent?: {        // 병합 부모 셀 참조
    row: number;
    col: number;
  };
}

interface ColumnDef {
  key: string;
  header: string;
  // ...
  mergeStrategy?: 'none' | 'same-value' | 'custom';
  mergeComparator?: (a: CellValue, b: CellValue) => boolean;
}
```

### 가상화와의 통합

```typescript
class MergeManager {
  private merges: Map<string, MergeRange> = new Map();
  
  /**
   * 가상화된 행에서 병합 셀 처리
   * 병합된 셀이 viewport 밖에서 시작하는 경우 처리
   */
  getMergeInfoForRow(rowIndex: number): MergeCellInfo[] {
    const result: MergeCellInfo[] = [];
    
    for (const merge of this.merges.values()) {
      // 이 행이 병합 범위에 포함되는지 확인
      if (rowIndex >= merge.startRow && rowIndex <= merge.endRow) {
        result.push({
          ...merge,
          isStart: rowIndex === merge.startRow,
          visibleRowSpan: this.calculateVisibleRowSpan(merge, rowIndex),
        });
      }
    }
    
    return result;
  }
}
```

---

## 2. 행 그룹화 (Row Grouping)

### 요구사항

- **다중 레벨 그룹화**: Country → Product (중첩 그룹)
- **접기/펼치기**: 그룹 헤더 클릭 시 토글
- **그룹 헤더 행**: 그룹명 + 아이템 수 표시
- **집계 기능**: 그룹별 합계, 평균, 개수 등

### 그룹화 결과 예시

```
┌────┬───────────────────────────────────────────────────────────┐
│    │ ▼ Country: Germany (34 items)           │ SUM: 45,032    │
├────┼───────────────────────────────────────────────────────────┤
│    │   ▼ Product: Computers (17 items)       │ SUM: 23,456    │
├────┼─────────┬────────────┬───────────┬────────┬──────────────┤
│  1 │ Germany │ Computers  │   4,552   │ 3,086  │    3,729     │
│ 13 │ Germany │ Computers  │   6,800   │ 6,632  │    3,009     │
├────┼───────────────────────────────────────────────────────────┤
│    │   ▶ Product: Phones (10 items)          │ SUM: 12,345    │  ← 접힌 상태
├────┼───────────────────────────────────────────────────────────┤
│    │   ▼ Product: Tablets (7 items)          │ SUM: 9,231     │
│ 72 │ Germany │ Tablets    │   1,234   │   890  │      567     │
└────┴─────────┴────────────┴───────────┴────────┴──────────────┘
```

### 정의 방식

#### 방식 A: 컬럼 정의 (선언적)

```typescript
const columns: ColumnDef[] = [
  {
    key: 'country',
    header: 'Country',
    /**
     * 그룹화 활성화 및 순서
     */
    groupable: true,
    groupOrder: 1,  // 1차 그룹
  },
  {
    key: 'product',
    header: 'Product',
    groupable: true,
    groupOrder: 2,  // 2차 그룹 (중첩)
  },
  {
    key: 'sales',
    header: 'Sales',
    /**
     * 그룹 집계 설정
     */
    aggregate: 'sum',  // 'sum' | 'avg' | 'count' | 'min' | 'max' | custom
  },
];
```

#### 방식 B: API (명령적)

```typescript
const sheet = new PureSheet(container, options);

// 그룹화 설정
sheet.groupBy(['country', 'product']);

// 그룹화 해제
sheet.ungroupBy('product');  // product 그룹만 해제
sheet.clearGroups();         // 모든 그룹 해제

// 그룹 접기/펼치기
sheet.collapseGroup('country', 'Germany');
sheet.expandGroup('country', 'Germany');
sheet.collapseAll();
sheet.expandAll();

// 그룹 상태 조회
const groupState = sheet.getGroupState();
// → { 
//     columns: ['country', 'product'],
//     collapsed: [
//       { column: 'country', value: 'France' },
//       { column: 'product', value: 'Phones' }
//     ]
//   }

// 집계 설정
sheet.setAggregation('sales', 'sum');
sheet.setAggregation('quantity', (values) => {
  // 커스텀 집계 함수
  return values.reduce((a, b) => a + b, 0) / values.length;
});
```

### 인터페이스 설계

```typescript
type AggregateFunction = 'sum' | 'avg' | 'count' | 'min' | 'max' | 
                          ((values: CellValue[]) => CellValue);

interface GroupState {
  columns: string[];           // 그룹화된 컬럼들 (순서대로)
  collapsed: GroupIdentifier[]; // 접힌 그룹들
}

interface GroupIdentifier {
  column: string;
  value: CellValue;
  parentGroups?: GroupIdentifier[];  // 상위 그룹 (중첩 시)
}

interface GroupRow {
  type: 'group-header';
  column: string;              // 그룹 컬럼
  value: CellValue;            // 그룹 값 (예: 'Germany')
  level: number;               // 중첩 레벨 (0, 1, 2, ...)
  itemCount: number;           // 하위 아이템 수
  collapsed: boolean;          // 접힘 상태
  aggregates: Record<string, CellValue>;  // 집계 값들
}

interface DataRow {
  type: 'data';
  data: Row;
  groupPath: GroupIdentifier[];  // 속한 그룹 경로
}

type VirtualRow = GroupRow | DataRow;
```

### 가상화와의 통합

```typescript
class GroupManager {
  private groupColumns: string[] = [];
  private collapsedGroups: Set<string> = new Set();
  
  /**
   * 그룹화된 데이터를 가상화용 플랫 배열로 변환
   * 그룹 헤더 행 + 데이터 행
   */
  flattenWithGroups(data: Row[]): VirtualRow[] {
    const result: VirtualRow[] = [];
    const grouped = this.groupData(data);
    
    this.traverseGroups(grouped, [], result);
    
    return result;
  }
  
  private traverseGroups(
    group: GroupNode,
    path: GroupIdentifier[],
    result: VirtualRow[]
  ): void {
    // 그룹 헤더 추가
    result.push({
      type: 'group-header',
      column: group.column,
      value: group.value,
      level: path.length,
      itemCount: group.count,
      collapsed: this.isCollapsed(path),
      aggregates: group.aggregates,
    });
    
    // 접힌 상태면 하위 항목 스킵
    if (this.isCollapsed(path)) return;
    
    // 하위 그룹 또는 데이터 행 추가
    if (group.children) {
      for (const child of group.children) {
        this.traverseGroups(child, [...path, { column: group.column, value: group.value }], result);
      }
    } else {
      for (const row of group.rows) {
        result.push({ type: 'data', data: row, groupPath: path });
      }
    }
  }
}
```

### 렌더링

```typescript
class BodyRenderer {
  renderRow(virtualRow: VirtualRow, index: number): HTMLElement {
    if (virtualRow.type === 'group-header') {
      return this.renderGroupHeader(virtualRow);
    } else {
      return this.renderDataRow(virtualRow.data);
    }
  }
  
  private renderGroupHeader(group: GroupRow): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-group-header';
    row.style.paddingLeft = `${group.level * 20}px`;  // 들여쓰기
    
    row.innerHTML = `
      <span class="ps-group-toggle">${group.collapsed ? '▶' : '▼'}</span>
      <span class="ps-group-label">
        ${group.column}: <strong>${group.value}</strong>
        (${group.itemCount} items)
      </span>
      <span class="ps-group-aggregates">
        ${this.renderAggregates(group.aggregates)}
      </span>
    `;
    
    row.addEventListener('click', () => this.toggleGroup(group));
    
    return row;
  }
}
```

---

## 3. 구현 순서

### 1차 구현 (기본 가상화)
1. GridRenderer, VirtualScroller, BodyRenderer
2. HeaderRenderer, CellRenderer
3. ColumnManager (리사이즈, 고정)
4. SelectionManager
5. EditorManager
6. PureSheet 파사드

### 2차 구현 (고급 기능)
1. **셀 병합**
   - MergeManager 구현
   - 가상화와 병합 통합
   - 데이터 레벨 병합 (mergeStrategy)
   - API 레벨 병합 (mergeCells)

2. **행 그룹화**
   - GroupManager 구현
   - 그룹 헤더 렌더링
   - 접기/펼치기
   - 집계 기능

---

## 4. 고려사항

### 셀 병합 + 가상화

| 상황 | 처리 방법 |
|------|----------|
| 병합 시작 셀이 viewport 밖 | 병합 정보로 첫 보이는 행에서 병합 셀 렌더링 |
| 병합 끝 셀이 viewport 밖 | 보이는 범위까지만 rowSpan 적용 |
| 스크롤 중 병합 셀 | 스크롤 시 병합 셀 위치 재계산 |

### 행 그룹화 + 가상화

| 상황 | 처리 방법 |
|------|----------|
| 그룹 접기/펼치기 | VirtualRow 배열 재계산, 스크롤 위치 보정 |
| 그룹 헤더 행 높이 | 데이터 행과 다른 높이 가능 |
| 중첩 그룹 렌더링 | level에 따른 들여쓰기 |

### 셀 병합 + 행 그룹화

| 상황 | 처리 방법 |
|------|----------|
| 그룹 내 셀 병합 | 그룹 경계를 넘지 않도록 제한 |
| 그룹 헤더 셀 병합 | 그룹 헤더는 병합 불가 (또는 별도 규칙) |

---

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [가변 행 높이 가상화 전략](./003-variable-row-height-virtualization.md)
