# 007. Row 클래스 아키텍처 및 행 고정 기능

## 1. 배경 및 동기

### 현재 상태

현재 그리드는 행 렌더링 로직이 `BodyRenderer`에 인라인으로 구현되어 있습니다:
- `renderDataRow()` - 데이터 행
- `renderGroupHeader()` - 그룹 헤더
- `renderMultiRowMode()` - Multi-Row 레이아웃

### 문제점

1. **Footer 기능 부재** - 합계 행, 커스텀 정보 표시 영역이 없음
2. **유연성 부족** - 사용자가 커스텀 행을 추가하기 어려움
3. **코드 분산** - 행 관련 로직이 여러 메서드에 흩어져 있음
4. **피봇 확장성** - 향후 피봇 그리드의 소계 행 지원이 어려움

### 목표

1. **Row 클래스 추상화** - 통합된 행 모델 제공
2. **행 고정 기능** - 컬럼 고정처럼 행도 고정 가능
3. **Footer 자연스러운 구현** - Row + 고정 = Footer
4. **피봇 대비** - 구조적 행과 데이터 행 구분

---

## 2. 핵심 설계 결정

### 2.1 이진 분류: Structural vs Non-structural

여러 행 타입(data, group-header, subtotal, grandtotal, custom)을 만드는 대신, **단일 이진 분류**로 동작을 결정합니다.

```typescript
interface VirtualRow {
  // 핵심 분류 - 동작 결정
  structural: boolean;
  
  // 렌더링 힌트 (선택적)
  variant?: RowVariant;
  
  // 데이터
  data: Record<string, any>;
  
  // Non-structural만 가짐
  dataIndex?: number;
}

type RowVariant = 
  | 'data'          // 일반 데이터
  | 'group-header'  // 그룹 헤더 (접기/펼치기)
  | 'subtotal'      // 부분합 (피봇용)
  | 'grandtotal'    // 총합계
  | 'filter'        // 필터 입력 행
  | 'custom';       // 사용자 정의
```

#### 동작 차이

| 특성 | Structural (구조적) | Non-structural (비구조적) |
|------|---------------------|--------------------------|
| **Selection** | ❌ 선택 안됨 | ✅ 선택 가능 |
| **dataIndex** | ❌ 없음 | ✅ 있음 |
| **가상화** | ✅ 포함 | ✅ 포함 |
| **정렬/필터** | 그룹과 함께 이동 | 데이터로 처리 |
| **내보내기** | ⚠️ 옵션에 따라 | ✅ 포함 |

#### 규칙

- `structural: true` → UI 전용, 선택/인덱스 제외
- `structural: false` → 데이터 기반, 선택/인덱스 포함 (DataStore에 데이터 존재)

### 2.2 행 고정 (Row Pinning)

컬럼 고정 패턴을 행에도 적용합니다.

```typescript
// 컬럼 고정 (기존)
column.pinned = 'left' | 'right' | null;

// 행 고정 (신규)
row.pinned = 'top' | 'bottom' | null;
```

#### 그리드 영역 구조

```
┌─────────────────────────────────────────────────┐
│  HeaderRenderer                                 │  ← 컬럼 헤더 (기존)
├─────────────────────────────────────────────────┤
│  Pinned Top Rows                                │  ← Row[] + pinned: 'top'
│  (필터 행, 부가 라벨, 선택 요약 등)               │
├─────────────────────────────────────────────────┤
│  Body (VirtualScroller)                         │  ← Row[] (가상화)
│  - 데이터 행 (non-structural)                    │
│  - 그룹 헤더, 소계 (structural)                  │
├─────────────────────────────────────────────────┤
│  Pinned Bottom Rows = "Footer"                  │  ← Row[] + pinned: 'bottom'
│  (합계, 페이지 정보, 커스텀 등)                   │
└─────────────────────────────────────────────────┘
```

### 2.3 Footer = Pinned Bottom Rows

별도의 `FooterRenderer`를 복잡하게 구현하는 대신, **Row + 고정**으로 Footer를 자연스럽게 구현합니다.

```typescript
// Footer는 그냥 pinned: 'bottom'인 Row들
const footerRows = [
  new Row({ structural: true, variant: 'grandtotal', pinned: 'bottom', ... }),
  new Row({ structural: true, variant: 'custom', pinned: 'bottom', ... }),
];
```

---

## 3. Row 클래스 설계

### 3.1 인터페이스

```typescript
/**
 * Row 설정
 */
interface RowConfig {
  /** 구조적 행 여부 (선택/인덱스 제외) */
  structural?: boolean;
  
  /** 행 변형 (렌더링 힌트) */
  variant?: RowVariant;
  
  /** 고정 위치 */
  pinned?: 'top' | 'bottom' | null;
  
  /** 행 높이 (null이면 기본값 사용) */
  height?: number | null;
  
  /** 행 데이터 */
  data?: Record<string, any>;
  
  /** 그룹 정보 (variant: 'group-header' | 'subtotal') */
  group?: GroupInfo;
  
  /** 집계 설정 (variant: 'subtotal' | 'grandtotal') */
  aggregates?: AggregateConfig[];
  
  /** 커스텀 렌더러 (variant: 'custom') */
  render?: (container: HTMLElement, context: RowRenderContext) => void;
  
  /** CSS 클래스 */
  className?: string;
}

/**
 * 그룹 정보 (그룹 헤더, 소계 행용)
 */
interface GroupInfo {
  /** 그룹 식별자 (토글용) */
  id: string;
  
  /** 계층 깊이 (0부터 시작) */
  level: number;
  
  /** 그룹 경로 (예: ['지역A', '제품X']) */
  path: string[];
  
  /** 그룹 값 (표시용) */
  value: any;
  
  /** 접힘 상태 */
  collapsed: boolean;
  
  /** 그룹 내 항목 수 */
  itemCount: number;
}

/**
 * 집계 설정
 */
interface AggregateConfig {
  /** 대상 컬럼 키 */
  columnKey: string;
  
  /** 집계 함수 */
  func: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((values: any[]) => any);
  
  /** 표시 포맷터 */
  formatter?: (value: any) => string;
}

/**
 * 행 렌더링 컨텍스트
 */
interface RowRenderContext {
  /** 컬럼 상태 */
  columns: ColumnState[];
  
  /** 컬럼 그룹 (Left/Center/Right) */
  columnGroups: ColumnGroups;
  
  /** 행 높이 */
  rowHeight: number;
  
  /** GridCore 참조 (데이터 접근용) */
  gridCore: GridCore;
}
```

### 3.2 Row 클래스

```typescript
/**
 * Row 클래스
 * 
 * Body, 고정 영역 모두에서 사용되는 통합 행 추상화입니다.
 */
class Row {
  readonly id: string;
  readonly structural: boolean;
  readonly variant: RowVariant;
  readonly pinned: 'top' | 'bottom' | null;
  readonly height: number | null;
  readonly className: string | null;
  
  private data: Record<string, any>;
  private group: GroupInfo | null;
  private aggregates: AggregateConfig[] | null;
  private customRender: ((container: HTMLElement, context: RowRenderContext) => void) | null;
  
  constructor(config: RowConfig) {
    this.id = config.id ?? generateRowId();
    this.structural = config.structural ?? false;
    this.variant = config.variant ?? 'data';
    this.pinned = config.pinned ?? null;
    this.height = config.height ?? null;
    this.className = config.className ?? null;
    this.data = config.data ?? {};
    this.group = config.group ?? null;
    this.aggregates = config.aggregates ?? null;
    this.customRender = config.render ?? null;
  }
  
  /**
   * 행 렌더링
   */
  render(container: HTMLElement, context: RowRenderContext): void {
    // 커스텀 렌더러가 있으면 사용
    if (this.customRender) {
      this.customRender(container, context);
      return;
    }
    
    // variant별 기본 렌더링
    switch (this.variant) {
      case 'group-header':
        this.renderGroupHeader(container, context);
        break;
      case 'subtotal':
      case 'grandtotal':
        this.renderAggregate(container, context);
        break;
      case 'data':
      default:
        this.renderData(container, context);
    }
  }
  
  /**
   * 기존 DOM 요소 업데이트 (RowPool 재사용 시)
   */
  update(container: HTMLElement, context: RowRenderContext): void {
    // render와 동일하지만 DOM 생성 대신 업데이트
    this.render(container, context);
  }
  
  /**
   * 행 높이 반환
   */
  getHeight(defaultHeight: number): number {
    return this.height ?? defaultHeight;
  }
  
  /**
   * 데이터 반환
   */
  getData(): Record<string, any> {
    return this.data;
  }
  
  /**
   * 데이터 업데이트
   */
  setData(data: Record<string, any>): void {
    this.data = data;
  }
  
  /**
   * 그룹 정보 반환
   */
  getGroup(): GroupInfo | null {
    return this.group;
  }
  
  /**
   * 그룹 접힘 상태 토글
   */
  toggleCollapsed(): boolean {
    if (this.group) {
      this.group.collapsed = !this.group.collapsed;
      return this.group.collapsed;
    }
    return false;
  }
  
  // === Private 렌더링 메서드 ===
  
  private renderData(container: HTMLElement, context: RowRenderContext): void {
    // 기존 BodyRenderer.renderDataRow() 로직 이동
    // - 컬럼별 셀 생성
    // - 셀 값 포맷팅
    // - 선택 상태 스타일
  }
  
  private renderGroupHeader(container: HTMLElement, context: RowRenderContext): void {
    // 기존 BodyRenderer.renderGroupHeader() 로직 이동
    // - 접기/펼치기 아이콘 (▶/▼)
    // - 그룹 라벨 (value + itemCount)
    // - 레벨에 따른 들여쓰기
    // - 집계 값 표시 (있는 경우)
    
    const group = this.group!;
    const indent = group.level * 20;
    
    container.style.paddingLeft = `${indent + 8}px`;
    container.innerHTML = `
      <span class="ps-group-toggle">${group.collapsed ? '▶' : '▼'}</span>
      <span class="ps-group-label">
        <strong>${group.value}</strong> (${group.itemCount} items)
      </span>
    `;
  }
  
  private renderAggregate(container: HTMLElement, context: RowRenderContext): void {
    // 집계 행 렌더링
    // - this.aggregates를 사용하여 각 컬럼의 집계값 계산 및 표시
    // - 그룹 소계 또는 전체 합계
  }
}
```

### 3.3 VirtualRow 타입 (내부용)

```typescript
/**
 * 가상화된 행 (BodyRenderer 내부용)
 */
interface VirtualRow {
  /** Row 인스턴스 */
  row: Row;
  
  /** 구조적 행 여부 (Row.structural 미러링) */
  structural: boolean;
  
  /** 데이터 인덱스 (non-structural만) */
  dataIndex?: number;
  
  /** 그룹 경로 (그룹화된 경우) */
  groupPath?: string[];
  
  /** 그룹 레벨 */
  level?: number;
}
```

### 3.4 Multi-Row와 Row의 관계

Row 클래스는 **데이터만 보유**하고, Multi-Row 레이아웃은 **MultiRowRenderer가 담당**합니다.

#### 역할 분리

```
┌─────────────────────────────────────────┐
│  Row 클래스                              │
│  ─────────────────────────────────────  │
│  • 데이터만 보유 (data, structural 등)   │
│  • Multi-Row 레이아웃 로직 없음           │
│  • "무엇을 보여줄지" 담당                 │
└─────────────────────────────────────────┘
                    ↓ Row.getData()
┌─────────────────────────────────────────┐
│  MultiRowRenderer                        │
│  ─────────────────────────────────────  │
│  • Row에서 데이터를 가져옴                │
│  • CSS Grid 레이아웃 적용                 │
│  • rowSpan, colSpan 처리                 │
│  • "어떻게 보여줄지" 담당                 │
└─────────────────────────────────────────┘
```

#### 설계 원칙

| 구분 | Row | MultiRowRenderer |
|------|-----|------------------|
| **역할** | 데이터 컨테이너 | 스타일링 엔진 |
| **알아야 할 것** | structural, variant, data | RowTemplate, CSS Grid |
| **Multi-Row 로직** | ❌ 없음 | ✅ 전담 |
| **재사용성** | 어떤 레이아웃에도 사용 가능 | 다양한 Row에 적용 가능 |

#### 렌더링 흐름

```typescript
// BodyRenderer에서의 분기
if (this.rowTemplate) {
  // Multi-Row 모드: Row 데이터를 MultiRowRenderer가 스타일링
  for (const virtualRow of visibleRows) {
    const row = virtualRow.row;
    this.multiRowRenderer.render(row, container);
  }
} else {
  // 일반 모드: Row가 직접 렌더링
  for (const virtualRow of visibleRows) {
    virtualRow.row.render(container, context);
  }
}
```

#### MultiRowRenderer 구현 예시

```typescript
class MultiRowRenderer {
  constructor(
    private template: RowTemplate,
    private columnDefs: Map<string, ColumnDef>,
    private baseRowHeight: number
  ) {}
  
  /**
   * Row 인스턴스를 Multi-Row 레이아웃으로 렌더링
   */
  render(row: Row, container: HTMLElement): void {
    const data = row.getData();  // Row에서 데이터만 가져옴
    
    // CSS Grid 스타일링 (MultiRowRenderer 책임)
    container.style.display = 'grid';
    container.style.gridTemplateRows = `repeat(${this.template.rowCount}, ${this.baseRowHeight}px)`;
    container.style.gridTemplateColumns = this.buildGridTemplateColumns();
    
    // 템플릿에 따라 셀 배치
    for (const placement of this.cellPlacements) {
      const cell = this.createCell(placement, data);
      container.appendChild(cell);
    }
  }
  
  /**
   * Row의 총 높이 (Multi-Row 기준)
   */
  getRowHeight(): number {
    return this.baseRowHeight * this.template.rowCount;
  }
}
```

#### 장점

1. **관심사 분리**: Row = 데이터, MultiRowRenderer = 표현
2. **Row 클래스 단순화**: Multi-Row 로직이 없어 가벼움
3. **유연성**: 같은 Row를 다른 템플릿으로 렌더링 가능
4. **Grid 전역 설정**: Multi-Row는 보통 모든 행에 동일 적용

### 3.5 GroupManager와 Row 통합

GroupManager는 데이터를 그룹화하고 Row 인스턴스를 생성합니다.

```typescript
class GroupManager {
  /**
   * 데이터를 그룹화하여 Row[] 반환
   * - 그룹 헤더는 structural: true인 Row
   * - 데이터 행은 structural: false인 Row
   */
  flattenWithRows(data: any[]): Row[] {
    const result: Row[] = [];
    
    for (const group of this.groups) {
      // 그룹 헤더 Row 생성
      result.push(new Row({
        structural: true,
        variant: 'group-header',
        group: {
          id: group.id,
          level: group.level,
          path: group.path,
          value: group.value,
          collapsed: group.collapsed,
          itemCount: group.items.length,
        },
      }));
      
      // 접히지 않은 경우 데이터 행 추가
      if (!group.collapsed) {
        for (const item of group.items) {
          result.push(new Row({
            structural: false,
            variant: 'data',
            data: item,
          }));
        }
        
        // 소계 행 (설정된 경우)
        if (this.config.showSubtotals) {
          result.push(new Row({
            structural: true,
            variant: 'subtotal',
            group: { ...group, collapsed: false },
            aggregates: this.config.aggregates,
          }));
        }
      }
    }
    
    return result;
  }
}
```

---

## 4. API 설계

### 4.1 PureSheet 옵션

```typescript
interface PureSheetOptions {
  // 기존 옵션들...
  columns: ColumnDef[];
  data?: Record<string, any>[];
  
  // 행 고정 (신규)
  pinnedRows?: {
    top?: Row[];
    bottom?: Row[];
  };
}
```

### 4.2 동적 API

```typescript
class PureSheet {
  // === 고정 행 관리 ===
  
  /**
   * 상단에 행 고정
   */
  pinRowTop(row: Row | RowConfig): Row;
  
  /**
   * 하단에 행 고정
   */
  pinRowBottom(row: Row | RowConfig): Row;
  
  /**
   * 행 고정 해제
   */
  unpinRow(rowId: string): boolean;
  
  /**
   * 고정 행 조회
   */
  getPinnedRows(): { top: Row[]; bottom: Row[] };
  
  /**
   * 모든 고정 행 제거
   */
  clearPinnedRows(): void;
  
  // === 집계 행 편의 메서드 ===
  
  /**
   * 총합계 행 추가 (편의 메서드)
   */
  addGrandTotalRow(aggregates: AggregateConfig[]): Row;
  
  /**
   * 필터 행 추가 (편의 메서드)
   */
  addFilterRow(config: FilterRowConfig): Row;
}
```

### 4.3 사용 예시

```typescript
// 1. 초기 설정으로 고정 행 지정
const grid = new PureSheet(container, {
  columns: [
    { key: 'name', header: '이름' },
    { key: 'amount', header: '금액', type: 'number' },
  ],
  data: [...],
  
  pinnedRows: {
    top: [
      // 헤더 아래 필터 입력 행
      new Row({
        structural: true,
        variant: 'custom',
        pinned: 'top',
        render: (container, ctx) => {
          // 필터 입력 UI 렌더링
        },
      }),
    ],
    bottom: [
      // 총합계 행
      new Row({
        structural: true,
        variant: 'grandtotal',
        pinned: 'bottom',
        aggregates: [
          { columnKey: 'amount', func: 'sum', formatter: (v) => `₩${v.toLocaleString()}` },
        ],
      }),
    ],
  },
});

// 2. 동적으로 고정 행 추가
const summaryRow = new Row({
  structural: true,
  variant: 'custom',
  pinned: 'top',
  data: { selectedCount: 0 },
  render: (container, ctx) => {
    container.innerHTML = `선택된 항목: ${ctx.row.getData().selectedCount}개`;
  },
});

grid.pinRowTop(summaryRow);

// 선택 변경 시 업데이트
grid.on('selection:changed', ({ selectedRows }) => {
  summaryRow.setData({ selectedCount: selectedRows.length });
  grid.refreshPinnedRows('top');
});

// 3. 편의 메서드 사용
grid.addGrandTotalRow([
  { columnKey: 'amount', func: 'sum' },
  { columnKey: 'count', func: 'count' },
]);
```

---

## 5. 구현 계획

### 5.1 Phase 1: Row 클래스 기반 구축

1. `Row` 클래스 구현
   - `RowConfig`, `GroupInfo`, `RowRenderContext` 타입 정의
   - 기본 렌더링 메서드 (`renderData`, `renderGroupHeader`, `renderAggregate`)
2. 기존 `renderDataRow()`, `renderGroupHeader()` 로직을 `Row` 클래스로 이동
3. `BodyRenderer`에서 `Row.render()` 호출하도록 리팩토링

### 5.2 Phase 2: Multi-Row 통합

1. `MultiRowRenderer`가 `Row` 인스턴스를 사용하도록 수정
   - `Row.getData()`로 데이터 접근
   - Row는 데이터만 보유, MultiRowRenderer가 스타일링 담당
2. `BodyRenderer`에서 분기 처리
   - `rowTemplate` 있으면 → `MultiRowRenderer.render(row, container)`
   - 없으면 → `row.render(container, context)`

### 5.3 Phase 3: GroupManager 통합

1. `GroupManager.flattenWithRows()` 구현
   - 그룹 헤더를 `Row` 인스턴스로 생성 (structural: true)
   - 데이터 행을 `Row` 인스턴스로 생성 (structural: false)
   - 소계 행 지원 (variant: 'subtotal')
2. 그룹 토글 시 `Row.toggleCollapsed()` 호출

### 5.4 Phase 4: 행 고정 기능

1. `BodyRenderer`에 `pinnedTopContainer`, `pinnedBottomContainer` 추가
2. DOM 구조 변경:
   ```html
   <div class="ps-body">
     <div class="ps-pinned-top">...</div>      <!-- 신규 -->
     <div class="ps-scroll-proxy">...</div>
     <div class="ps-viewport">...</div>
     <div class="ps-pinned-bottom">...</div>   <!-- 신규 -->
   </div>
   ```
3. 가로 스크롤 동기화 (고정 영역도 함께 스크롤)
4. `PureSheet` API 추가

### 5.5 Phase 5: 집계 기능

1. `AggregateConfig` 처리 로직 구현
2. `variant: 'subtotal' | 'grandtotal'` 렌더링
3. 데이터 변경 시 자동 재계산

### 5.6 Phase 6: 피봇 대비

1. `GroupManager` 확장 - 다중 레벨 소계 행 생성 지원
2. `structural: true` 행의 정렬/필터 동작 구현

---

## 6. 고려사항

### 6.1 성능

- **Row 인스턴스 생성**: JavaScript 객체 생성은 DOM 조작 대비 무시할 수준
- **가상화 유지**: Body 영역은 기존대로 가상 스크롤
- **고정 영역**: 가상화 불필요 (보통 1~5행)

### 6.2 메모리

- 고정 행은 항상 메모리에 유지
- Body 가상 행은 `VirtualRow` 형태로 관리

### 6.3 스크롤 동기화

```
Header     ← 가로 스크롤 동기화
Pinned Top ← 가로 스크롤 동기화
Body       ← 가로 스크롤 + 세로 가상화
Pinned Bot ← 가로 스크롤 동기화
```

### 6.4 컬럼 고정과의 교차

```
┌──────────┬─────────────┬──────────┐
│ 고정Left  │   스크롤     │ 고정Right │
├──────────┼─────────────┼──────────┤  ← Pinned Top
│ 항상표시  │ 가로스크롤   │ 항상표시  │
├──────────┼─────────────┼──────────┤
│          │             │          │
│  Body    │   Body      │  Body    │  ← 가상 스크롤
│          │             │          │
├──────────┼─────────────┼──────────┤  ← Pinned Bottom
│ 항상표시  │ 가로스크롤   │ 항상표시  │
└──────────┴─────────────┴──────────┘
```

### 6.5 Row 컨테이너 재사용 시 초기화 전략

RowPool에서 DOM 요소를 재사용할 때, 이전 variant(data, group-header 등)의 
스타일/구조가 남아있을 수 있다. 이를 처리하는 두 가지 접근법을 검토했다.

#### Option A: Row 클래스 내 중앙집중식 초기화 ✅ (채택)

```typescript
// Row.ts
private resetContainerForVariant(container: HTMLElement): void {
  container.classList.remove('ps-group-header', 'ps-subtotal', ...);
  container.style.display = '';
  // 모든 variant 관련 초기화를 한 곳에서 처리
}
```

| 장점 | 단점 |
|------|------|
| 단순함 - 한 곳에서 관리 | Row가 DOM 구조를 알아야 함 |
| 사용하기 쉬움 | 새 variant 추가 시 Row 수정 필요 |
| 일관된 초기화 보장 | RowPool/BodyRenderer의 DOM 구조에 의존 |

#### Option B: 콜백 기반 초기화 (대안)

```typescript
// Row 생성 시 초기화 콜백 전달
new Row({
  variant: 'data',
  onReset?: (container: HTMLElement, fromVariant: RowVariant) => void,
});
```

| 장점 | 단점 |
|------|------|
| Row가 DOM 구조에 독립적 | 초기화 로직 중복 가능 |
| 확장성 - 새 환경에서 유연 | 사용 복잡성 증가 |
| 관심사 분리 (Row=데이터, 렌더러=DOM) | 초기화 누락 시 버그 가능 |

#### 결정: Option A 채택

현재 Row가 이미 `renderData()`, `renderGroupHeader()` 등에서 DOM을 직접 조작하므로,
초기화도 같은 레벨에서 처리하는 것이 응집도가 높고 사용이 간단하다.

만약 향후 Row를 순수 데이터 모델로 분리하고 렌더링을 완전히 외부로 위임한다면
Option B를 재검토할 수 있다.

---

## 7. 관련 문서

- [006. 셀 렌더링 전략](./006-cell-rendering-strategy.md)
- [004. 셀 병합 및 행 그룹화](./004-cell-merge-and-row-grouping.md)
- [UI 아키텍처](../base/ARCHITECTURE-UI.md)

---

## 8. 결론

### 핵심 아이디어

1. **이진 분류** (`structural: boolean`)로 행 동작 단순화
2. **Row 고정** (`pinned: 'top' | 'bottom'`)으로 컬럼 고정 패턴 확장
3. **Footer = Pinned Bottom Rows** - 별도 구현 불필요
4. **통합 Row 클래스** - Body, 고정 영역 모두 동일한 추상화
5. **역할 분리** - Row = 데이터 컨테이너, MultiRowRenderer = 스타일링 엔진

### Row와 다른 컴포넌트의 관계

```
┌─────────────────────────────────────────────────────────────┐
│                         Row 클래스                          │
│  • 데이터 보유 (data, group, aggregates)                    │
│  • structural/variant로 행 타입 정의                        │
│  • Multi-Row 레이아웃 로직 없음 (관심사 분리)                │
└─────────────────────────────────────────────────────────────┘
         ↑                    ↑                    ↑
         │                    │                    │
┌────────┴────────┐  ┌───────┴────────┐  ┌───────┴────────┐
│  GroupManager   │  │ MultiRowRenderer│  │  BodyRenderer  │
│  • Row[] 생성   │  │ • Row 스타일링  │  │ • Row 렌더링   │
│  • 그룹 헤더    │  │ • CSS Grid     │  │ • 가상 스크롤  │
│  • 소계 행      │  │ • rowSpan 처리 │  │ • 고정 영역    │
└─────────────────┘  └────────────────┘  └────────────────┘
```

### 장점

| 장점 | 설명 |
|------|------|
| 단순함 | 하나의 Row 클래스로 모든 행 타입 처리 |
| 일관성 | 컬럼 고정과 동일한 패턴의 행 고정 |
| 유연성 | 위/아래 원하는 만큼, 원하는 타입의 행 고정 |
| 확장성 | 피봇 그리드의 소계 행도 동일한 모델로 처리 |
| 효율성 | FooterRenderer 별도 구현 불필요 |
| 관심사 분리 | Row = 데이터, MultiRowRenderer = 표현 |

