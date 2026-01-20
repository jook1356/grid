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
  
  /** 집계 설정 (variant: 'subtotal' | 'grandtotal') */
  aggregates?: AggregateConfig[];
  
  /** 커스텀 렌더러 (variant: 'custom') */
  render?: (container: HTMLElement, context: RowRenderContext) => void;
  
  /** CSS 클래스 */
  className?: string;
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
  
  // === Private 렌더링 메서드 ===
  
  private renderData(container: HTMLElement, context: RowRenderContext): void {
    // 기존 BodyRenderer.renderDataRow() 로직 이동
  }
  
  private renderGroupHeader(container: HTMLElement, context: RowRenderContext): void {
    // 기존 BodyRenderer.renderGroupHeader() 로직 이동
  }
  
  private renderAggregate(container: HTMLElement, context: RowRenderContext): void {
    // 집계 행 렌더링
    // this.aggregates를 사용하여 각 컬럼의 집계값 계산 및 표시
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
   * 고정 행 추가
   */
  addPinnedRow(row: Row, position: 'top' | 'bottom'): void;
  
  /**
   * 고정 행 제거
   */
  removePinnedRow(row: Row): void;
  removePinnedRow(rowId: string): void;
  
  /**
   * 고정 행 조회
   */
  getPinnedRows(position: 'top' | 'bottom'): Row[];
  
  /**
   * 모든 고정 행 제거
   */
  clearPinnedRows(position?: 'top' | 'bottom'): void;
  
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

grid.addPinnedRow(summaryRow, 'top');

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
2. `RowConfig`, `RowRenderContext` 타입 정의
3. 기존 `renderDataRow()`, `renderGroupHeader()` 로직을 `Row` 클래스로 이동
4. `BodyRenderer`에서 `Row.render()` 호출하도록 리팩토링

### 5.2 Phase 2: 행 고정 기능

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

### 5.3 Phase 3: 집계 기능

1. `AggregateConfig` 처리 로직 구현
2. `variant: 'subtotal' | 'grandtotal'` 렌더링
3. 데이터 변경 시 자동 재계산

### 5.4 Phase 4: 피봇 대비

1. `GroupManager` 확장 - 소계 행 생성 지원
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

### 장점

| 장점 | 설명 |
|------|------|
| 단순함 | 하나의 Row 클래스로 모든 행 타입 처리 |
| 일관성 | 컬럼 고정과 동일한 패턴의 행 고정 |
| 유연성 | 위/아래 원하는 만큼, 원하는 타입의 행 고정 |
| 확장성 | 피봇 그리드의 소계 행도 동일한 모델로 처리 |
| 효율성 | FooterRenderer 별도 구현 불필요 |

