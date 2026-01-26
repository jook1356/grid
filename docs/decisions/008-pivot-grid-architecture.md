# 008: 피벗 그리드 아키텍처

## 상태
**계획됨 (Planned)**

## 날짜
2026-01-21

## 배경

기존 PureSheet Grid를 피벗 그리드로 확장하기 위한 아키텍처 설계가 필요합니다.
피벗 그리드는 데이터를 행 차원과 열 차원으로 교차 집계하여 보여주는 컴포넌트입니다.

### 피벗 그리드 예시

```
          │    2023년       │    2024년       │  합계   │
          │  Q1   │  Q2     │  Q1   │  Q2     │         │
─────────────────────────────────────────────────────────
미국      │  100  │  150    │  200  │  250    │   700   │
  캘리포니아│   50  │   75    │  100  │  125    │   350   │
  뉴욕     │   50  │   75    │  100  │  125    │   350   │
한국      │   80  │  120    │  160  │  200    │   560   │
─────────────────────────────────────────────────────────
합계      │  180  │  270    │  360  │  450    │  1260   │
```

---

## 1. 피벗 설정 인터페이스

> **전체 Config API**: [Config API 재설계](./010-config-api-redesign.md)

피벗 모드는 PureSheet의 통합 Config에서 `mode: 'pivot'`으로 설정합니다:

```typescript
const pivotGrid = new PureSheet(container, {
  mode: 'pivot',
  
  data: [
    { month: '1월', product: 'A', sales: 100, profit: 30 },
    { month: '1월', product: 'B', sales: 150, profit: 50 },
    { month: '2월', product: 'A', sales: 200, profit: 60 },
  ],
  
  // 필드 정의 (메타데이터)
  fields: [
    { key: 'month', header: '월', dataType: 'string' },
    { key: 'product', header: '제품', dataType: 'string' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum' },
    { key: 'profit', header: '수익', dataType: 'number', aggregate: 'sum' },
  ],
  
  // 피벗 축 설정 (플랫하게)
  rowFields: ['product'],           // 행 축
  columnFields: ['month'],          // 열 축 (피벗되는 필드)
  valueFields: ['sales', 'profit'], // 값 필드
  
  // 공통 옵션
  theme: 'light',
  rowStyle: 'height: 36px;',
});
```

---

## 2. 컬럼 헤더 구조

### 결정: PivotHeaderRenderer 별도 분리

기존 `HeaderRenderer`를 재사용하지 않고 `PivotHeaderRenderer`를 별도로 구현합니다.

#### 이유

| 기준 | 기존 HeaderRenderer | PivotHeaderRenderer |
|------|---------------------|---------------------|
| **레벨 수** | 1레벨 (일반) 또는 rowTemplate 고정 | 동적 (columnFields 개수에 따라) |
| **컬럼 생성** | 정적 (`ColumnDef[]` 설정) | 동적 (데이터 값에서 추출) |
| **span 계산** | `rowTemplate`에서 직접 지정 | 트리 구조에서 자식 합계로 계산 |
| **구조** | 평면적 | 계층적 트리 |

#### 다중 레벨 컬럼 헤더

컬럼 헤더 레벨 수는 동적으로 결정됩니다:

```
컬럼 헤더 총 레벨 = columnFields.length + (valueFields.length > 1 ? 1 : 0)
```

**예시 1: columnFields 1개 + valueFields 2개**
```typescript
columnFields: ['demandCode']           // D0003, D0019, D0035...
valueFields: ['qty', 'priority']
```
```
Level 1: │  D0003         │  D0019         │  D0035         │
Level 2: │ 수량 │ 우선순위 │ 수량 │ 우선순위 │ 수량 │ 우선순위 │
```

**예시 2: columnFields 2개 + valueFields 2개**
```typescript
columnFields: ['year', 'quarter']
valueFields: ['qty', 'priority']
```
```
Level 1: │          2023                    │          2024                    │
Level 2: │  Q1           │  Q2             │  Q1           │  Q2             │
Level 3: │ 수량 │ 우선순위 │ 수량 │ 우선순위 │ 수량 │ 우선순위 │ 수량 │ 우선순위 │
```

### 헤더 트리 구조

```typescript
interface PivotHeaderNode {
  /** 노드 값 (예: '2023', 'Q1', 'qty') */
  value: string;
  
  /** 레벨 (0부터 시작) */
  level: number;
  
  /** 이 노드가 차지하는 컬럼 span (자식들의 합) */
  colspan: number;
  
  /** 자식 노드들 */
  children?: PivotHeaderNode[];
  
  /** 리프 노드인 경우 컬럼 키 */
  columnKey?: string;
}
```

### 트리 빌드 비용

| 시나리오 | 데이터 N | columnFields | 유니크 값 | 피벗 컬럼 수 | 예상 시간 |
|---------|---------|--------------|----------|------------|----------|
| 소형 | 1K | 2개 | 5×10 | 100 | < 1ms |
| 중형 | 100K | 3개 | 5×12×20 | 2,400 | < 5ms |
| 대형 | 1M | 3개 | 10×12×100 | 24,000 | < 50ms |

**결론**: 트리 빌드 비용은 무시할 수 있는 수준.

---

## 3. 행 헤더 구조

### 결정: 기존 컬럼 고정(pinned: 'left') 재사용 + 셀 병합

행 헤더는 별도 구현 없이 기존 인프라를 활용합니다:

1. `rowFields`를 `pinned: 'left'` 컬럼으로 배치
2. `mergeStrategy: 'same-value'`로 같은 값 세로 병합

#### 이유

| 장점 | 설명 |
|------|------|
| 기존 인프라 재사용 | `pinned: 'left'` 이미 구현됨 |
| 스크롤 동작 | 가로 스크롤 시 행 헤더 고정 - 이미 동작 |
| 가상 스크롤 | BodyRenderer의 행 가상화 그대로 적용 |
| 컬럼 리사이즈 | 행 헤더 너비 조절 가능 |

#### 행 헤더 예시

```
┌────────────┬────────────┬───────────────────────────────┐
│  고객 이름  │  제품 코드  │  (피벗된 데이터 영역)          │
│ (pinned)   │  (pinned)  │         (scrollable)          │
├────────────┼────────────┼───────────────────────────────┤
│  LG전자    │  ITEM05   │  100  │  1  │  150  │  2  │ ...│
├────────────┼────────────┼───────────────────────────────┤
│            │  ITEM06   │  ...                          │
│  다이슨     ├────────────┼───────────────────────────────┤
│ (rowspan)  │  ITEM07   │  ...                          │
│            ├────────────┼───────────────────────────────┤
│            │  ITEM08   │  ...                          │
└────────────┴────────────┴───────────────────────────────┘
```

### 필요한 추가 구현: 셀 병합 (same-value)

현재 타입 정의는 있으나 실제 구현이 필요합니다:

```typescript
// ColumnDef 확장
interface ColumnDef {
  // ... 기존 속성
  mergeStrategy?: 'none' | 'same-value';
}

// BodyRenderer에서 처리
private calculateRowSpans(columnKey: string): Map<number, number> {
  const spans = new Map<number, number>();
  let spanStart = 0;
  let currentValue = null;
  
  for (let i = 0; i < this.virtualRows.length; i++) {
    const row = this.virtualRows[i];
    if (row.type !== 'data') continue;
    
    const value = row.data[columnKey];
    if (value !== currentValue) {
      if (i > spanStart) {
        spans.set(spanStart, i - spanStart);
      }
      spanStart = i;
      currentValue = value;
    }
  }
  
  return spans;
}
```

---

## 4. 필터/정렬 → 피벗 파이프라인

> **상세 문서**: [필터/정렬 → 피벗 통합 파이프라인](./011-filter-sort-pivot-pipeline.md)

### 데이터 처리 순서

피벗 모드에서 데이터는 다음 순서로 처리됩니다:

```
원본 데이터 → 필터 적용 → 정렬 적용 → 피벗 연산 → 렌더링
                ↓             ↓            ↓
           데이터 축소   순서 결정   집계 + 구조 변환
```

### 정렬이 피벗에 미치는 영향

| 정렬 대상 | 영향 받는 부분 | 예시 |
|----------|---------------|------|
| **rowFields** | 행 순서 | `product 내림차순` → Z~A |
| **columnFields** | 컬럼 헤더 순서 | `month 내림차순` → 12월~1월 |
| **valueFields** | 집계값 기준 행 순서 | `sales 내림차순` → 매출 높은 순 |

### columnFields 정렬 예시

`columnFields: ['year', 'month']` + `year 내림차순` + `month 내림차순`:

```
      2024          |       2023          |       2022
4월  3월  2월  1월  | 4월  3월  2월  1월  | 4월  3월  2월  1월
```

### PivotConfig 확장

```typescript
export interface PivotConfig {
  rowFields: string[];
  columnFields: string[];
  valueFields: PivotValueField[];
  
  // 전처리 옵션 (Filter → Sort → Pivot)
  filters?: FilterState[];
  sorts?: SortState[];
}
```

---

## 5. 메인 스레드 처리 전략

### 결정: 모든 연산을 메인 스레드에서 처리

> **변경 이유**: [009-remove-worker-architecture.md](./009-remove-worker-architecture.md) 참조
> 
> Worker 사용 시 데이터 전송 비용(직렬화)이 연산 비용보다 크고,
> 직렬화 자체가 UI 블로킹을 유발합니다.
> 상용 그리드(AG Grid, DevExtreme 등)도 Worker를 사용하지 않습니다.

피벗 관련 모든 연산(집계, 트리 빌드, 병합 계산)을 메인 스레드에서 수행합니다.

#### 처리 흐름

```
┌─────────────────────────────────────────────────────────────┐
│  Main Thread                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  PivotProcessor (ArqueroProcessor 확장)                │ │
│  │  1. 집계 연산 (Arquero groupBy + rollup)               │ │
│  │  2. 컬럼 헤더 트리 빌드 + colspan 계산                  │ │
│  │  3. 행 병합 정보 계산 (same-value 기반)                 │ │
│  │  4. 피벗 데이터 구조 변환                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ↓                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Rendering                                              │ │
│  │  5. PivotHeaderRenderer: 헤더 트리 → DOM               │ │
│  │  6. BodyRenderer: 피벗 데이터 + 병합 정보 → 셀 DOM     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 성능 분석

| 데이터 규모 | 집계 연산 | 트리 빌드 | 총 시간 | 비고 |
|------------|----------|----------|--------|------|
| 1만 건 | ~10ms | < 1ms | ~15ms | 즉시 |
| 10만 건 | ~50ms | < 5ms | ~60ms | 약간 지연 |
| 50만 건 | ~200ms | < 20ms | ~250ms | 로딩 표시 권장 |
| 100만+ 건 | - | - | - | **서버 사이드 권장** |

### 피벗 결과 인터페이스

```typescript
interface PivotResult {
  /** 컬럼 헤더 트리 (빌드 완료, colspan 계산됨) */
  columnHeaderTree: PivotHeaderNode;
  
  /** 행 병합 정보 (컬럼별 병합 구간) */
  rowMergeInfo: {
    [columnKey: string]: Array<{
      startIndex: number;
      span: number;
    }>;
  };
  
  /** 피벗된 데이터 */
  pivotedData: PivotRow[];
  
  /** 동적 생성된 컬럼 정의 */
  columns: ColumnDef[];
  
  /** 메타 정보 */
  meta: {
    totalRows: number;
    totalColumns: number;
  };
}

interface PivotRow {
  /** 행 헤더 값들 (rowFields 순서대로) */
  rowHeaders: Record<string, CellValue>;
  
  /** 피벗된 값들 (동적 컬럼 키 → 값) */
  values: Record<string, CellValue>;
}
```

---

## 6. 전체 아키텍처

### 컴포넌트 구조

```
┌─────────────────────────────────────────────────────────────┐
│                       PivotSheet                            │
├─────────────────────────────────────────────────────────────┤
│  Main Thread                                                │
├─────────────────────────────────────────────────────────────┤
│  1. pivotConfig 설정                                        │
│                    ↓                                        │
│  2. PivotProcessor                                          │
│     - 집계 연산 (Arquero)                                   │
│     - 헤더 트리 빌드                                        │
│     - 병합 정보 계산                                        │
│     - 피벗 구조 변환                                        │
│                    ↓                                        │
│  3. 렌더링                                                  │
│     - PivotHeaderRenderer                                   │
│     - BodyRenderer                                          │
└─────────────────────────────────────────────────────────────┘
```

### 파일 구조

```
src/
├── processor/
│   ├── ArqueroProcessor.ts     # 기존 (sort, filter, aggregate)
│   └── PivotProcessor.ts       # 신규 (피벗 전용, ArqueroProcessor 확장)
│
├── ui/
│   ├── pivot/
│   │   ├── PivotSheet.ts           # 피벗 그리드 파사드
│   │   ├── PivotHeaderRenderer.ts  # 다중 레벨 컬럼 헤더 렌더링
│   │   └── types.ts                # 피벗 관련 타입
│   │
│   ├── header/
│   │   ├── HeaderRenderer.ts       # 기존 (일반 + Multi-Row)
│   │   └── HeaderCell.ts           # 공유 컴포넌트 (재사용)
│   │
│   └── body/
│       └── BodyRenderer.ts         # 기존 + mergeStrategy 구현
│
└── types/
    └── pivot.types.ts              # PivotConfig, PivotResult 등
```

---

## 7. 구현 순서

| 단계 | 작업 | 설명 |
|------|------|------|
| 1 | `PivotProcessor` | ArqueroProcessor 확장, pivot 메서드 구현 |
| 2 | `mergeStrategy` | ColumnDef 확장 + BodyRenderer 병합 렌더링 |
| 3 | `PivotHeaderRenderer` | 다중 레벨 컬럼 헤더 렌더링 |
| 4 | `PivotSheet` | 피벗 그리드 파사드 통합 |
| 5 | 테스트 및 최적화 | 대용량 데이터 성능 테스트 |

---

## 8. 공유 컴포넌트

### HeaderCell 재사용

`PivotHeaderRenderer`에서 개별 셀 렌더링에 기존 `HeaderCell`을 재사용합니다:

```typescript
class PivotHeaderRenderer {
  private renderCell(node: PivotHeaderNode): HTMLElement {
    // HeaderCell 재사용 또는 확장
    const cell = new HeaderCell({
      columnDef: this.toPseudoColumnDef(node),
      // ... 옵션
    });
    
    // 피벗 전용 스타일 추가
    cell.getElement().classList.add('ps-pivot-header-cell');
    cell.getElement().dataset['level'] = String(node.level);
    
    return cell.getElement();
  }
}
```

### PivotProcessor 구현

`PivotProcessor`는 기존 `ArqueroProcessor`를 확장하여 피벗 기능을 추가합니다:

```typescript
// processor/PivotProcessor.ts
class PivotProcessor extends ArqueroProcessor {
  /**
   * 피벗 연산 수행 (메인 스레드에서 직접 실행)
   */
  async pivot(config: PivotConfig): Promise<PivotResult> {
    const table = this.ensureInitialized();
    
    // 1. 집계 연산
    const aggregated = await this.aggregate({
      groupBy: [...config.rowFields, ...config.columnFields],
      aggregates: config.valueFields.map(v => ({
        columnKey: v.field,
        function: v.aggregate,
      })),
    });
    
    // 2. 피벗 구조 변환
    const pivotedData = this.transformToPivotStructure(aggregated, config);
    
    // 3. 컬럼 헤더 트리 빌드
    const columnHeaderTree = this.buildHeaderTree(aggregated, config.columnFields);
    
    // 4. 행 병합 정보 계산
    const rowMergeInfo = this.calculateRowMergeInfo(pivotedData, config.rowFields);
    
    // 5. 동적 컬럼 정의 생성
    const columns = this.generateColumnDefs(columnHeaderTree, config);
    
    return {
      columnHeaderTree,
      rowMergeInfo,
      pivotedData,
      columns,
      meta: {
        totalRows: pivotedData.length,
        totalColumns: columns.length,
      },
    };
  }
  
  /**
   * 헤더 트리 빌드
   */
  private buildHeaderTree(
    data: AggregateResult[],
    columnFields: string[]
  ): PivotHeaderNode {
    // 유니크 값 추출 및 트리 구조 생성
    // colspan은 자식 노드들의 합으로 계산
  }
  
  /**
   * 행 병합 정보 계산
   */
  private calculateRowMergeInfo(
    data: PivotRow[],
    rowFields: string[]
  ): PivotResult['rowMergeInfo'] {
    // same-value 기반 병합 구간 계산
  }
}
```

---

## 9. 대용량 데이터 처리

### 서버 사이드 피벗 (50만+ 건)

클라이언트에서 50만+ 건을 피벗팅하는 것은 권장되지 않습니다.
서버에서 집계하여 결과만 받는 방식을 권장합니다:

```typescript
const grid = new PivotSheet(container, {
  serverSide: {
    url: '/api/pivot',
    // 서버에서 피벗 결과 반환
  },
  pivotConfig: {
    rowFields: ['customer', 'product'],
    columnFields: ['year', 'quarter'],
    valueFields: [{ field: 'amount', aggregate: 'sum' }],
  },
});
```

### 로딩 처리

10만+ 건 피벗 시 로딩 인디케이터 표시:

```typescript
grid.on('processing:start', () => showSpinner());
grid.on('processing:end', () => hideSpinner());

await grid.pivot(config);  // ~50-200ms 소요
```

---

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [셀 병합 및 행 그룹화 전략](./004-cell-merge-and-row-grouping.md)
- [Core Architecture](../base/ARCHITECTURE-CORE.md)
- [Worker 제거 결정](./009-remove-worker-architecture.md)
- [필터/정렬 → 피벗 파이프라인](./011-filter-sort-pivot-pipeline.md)
- [피벗 부분합/총합계 기능](./017-pivot-subtotals-grandtotals.md)
