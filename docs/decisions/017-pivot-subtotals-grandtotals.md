# 017: 피벗 그리드 부분합(Subtotals) 및 총합계(GrandTotals) 기능

## 상태
**구현됨 (Implemented)**

## 날짜
2026-01-26

## 배경

피벗 그리드에서 데이터 분석을 위해 부분합(Subtotals)과 총합계(GrandTotals) 기능이 필요합니다.
기존 `PivotConfig`에 `showRowTotals`, `showColumnTotals`, `showGrandTotal` 옵션이 정의되어 있었으나,
용어가 명확하지 않아 새로운 체계로 재정의합니다.

---

## 1. 용어 정의

### 1.1 개념 및 옵션 체계

4가지 핵심 개념과 이를 활성화하는 옵션:

| 개념 | 옵션명 | 의미 | 위치 |
|------|--------|------|------|
| rowSubTotals | `showRowSubTotals` | 행 계층 변경 시 소계 **행** 삽입 | 데이터 중간 (행 추가) |
| rowGrandTotals | `showRowGrandTotals` | 모든 컬럼의 총합 **행** | 하단 (행 추가) |
| columnSubTotals | `showColumnSubTotals` | 열 계층 변경 시 소계 **컬럼** 삽입 | 데이터 중간 (컬럼 추가) |
| columnGrandTotals | `showColumnGrandTotals` | 모든 행의 총합 **컬럼** | 우측 끝 (컬럼 추가) |

### 1.2 기존 옵션과의 관계

| 기존 옵션 | 의미 | 새 옵션 |
|-----------|------|---------|
| `showRowTotals` | 불명확 | **삭제** → `showRowSubTotals` + `showColumnGrandTotals`로 대체 |
| `showColumnTotals` | 불명확 | **삭제** → `showColumnSubTotals` + `showRowGrandTotals`로 대체 |
| `showGrandTotal` | 전체 총합 | **삭제** → `showRowGrandTotals` + `showColumnGrandTotals` 조합 |

### 1.3 시각화

```
columnFields: [분기, 월], rowFields: [제품, 지역]

                    showColumnSubTotals  showColumnSubTotals  showColumnGrandTotals
                              ↓                    ↓                  ↓
┌────────┬────────┬─────┬─────┬─────────┬─────┬─────┬─────────┬──────────┐
│        │        │    Q1     │ Q1      │    Q2     │ Q2      │ 총합     │
│ 제품   │ 지역   │ 1월 │ 2월 │ 소계    │ 3월 │ 4월 │ 소계    │          │
├────────┼────────┼─────┼─────┼─────────┼─────┼─────┼─────────┼──────────┤
│ 노트북 │ 서울   │ 100 │ 150 │   250   │ 120 │ 130 │   250   │   500    │
│        │ 부산   │  80 │ 120 │   200   │ 100 │ 110 │   210   │   410    │
│ 노트북 소계     ││ 180 │ 270 │   450   │ 220 │ 240 │   460   │   910    │ ← showRowSubTotals
├────────┼────────┼─────┼─────┼─────────┼─────┼─────┼─────────┼──────────┤
│ 스마트폰│ 서울  │ 200 │ 180 │   380   │ 150 │ 160 │   310   │   690    │
│        │ 부산  │ 150 │ 140 │   290   │ 130 │ 120 │   250   │   540    │
│ 스마트폰 소계   ││ 350 │ 320 │   670   │ 280 │ 280 │   560   │  1230    │ ← showRowSubTotals
├────────┴────────┼─────┼─────┼─────────┼─────┼─────┼─────────┼──────────┤
│ 총합계          │ 530 │ 590 │  1120   │ 500 │ 520 │  1020   │  2140    │ ← showRowGrandTotals
└─────────────────┴─────┴─────┴─────────┴─────┴─────┴─────────┴──────────┘
```

---

## 2. 타입 정의

### 2.1 PivotConfig 수정

```typescript
export interface PivotConfig {
  /** 행 축 필드 키 배열 */
  rowFields: string[];

  /** 열 축 필드 키 배열 (피벗되는 필드) */
  columnFields: string[];

  /** 값 필드 설정 배열 */
  valueFields: PivotValueField[];

  // ==========================================================================
  // 부분합/총합계 옵션
  // ==========================================================================

  /**
   * 행 소계 표시 (rowSubTotals)
   * - true: 모든 rowFields 레벨에서 소계 삽입 (마지막 제외)
   * - rowSubTotalFields와 함께 사용 시 해당 필드만 적용
   * @default false
   */
  showRowSubTotals?: boolean;

  /**
   * 행 소계를 표시할 필드 목록
   * showRowSubTotals가 true일 때, 특정 필드에서만 소계 표시
   * @example rowSubTotalFields: ['category', 'product']
   */
  rowSubTotalFields?: string[];

  /**
   * 행 총합계 표시 (rowGrandTotals)
   * 하단에 총합 행 추가
   * @default false
   */
  showRowGrandTotals?: boolean;

  /**
   * 열 소계 표시 (columnSubTotals)
   * - true: 모든 columnFields 레벨에서 소계 컬럼 삽입 (마지막 제외)
   * - columnSubTotalFields와 함께 사용 시 해당 필드만 적용
   * @default false
   */
  showColumnSubTotals?: boolean;

  /**
   * 열 소계를 표시할 필드 목록
   * showColumnSubTotals가 true일 때, 특정 필드에서만 소계 컬럼 표시
   * @example columnSubTotalFields: ['year', 'quarter']
   */
  columnSubTotalFields?: string[];

  /**
   * 열 총합계 표시 (columnGrandTotals)
   * 우측 끝에 총합 컬럼 추가
   * @default false
   */
  showColumnGrandTotals?: boolean;

  // ==========================================================================
  // 전처리 옵션 (기존)
  // ==========================================================================

  filters?: FilterState[];
  sorts?: SortState[];
}
```

### 2.2 ColumnDef 확장 (Structural 컬럼)

Row 클래스의 `structural` 속성과 동일한 개념을 Column에도 적용합니다.

```typescript
export interface ColumnDef {
  key: string;
  header: string;
  width?: number;
  type?: 'string' | 'number' | 'boolean' | 'date';
  // ... 기존 속성들

  // ==========================================================================
  // 피벗 전용 속성 (신규)
  // ==========================================================================

  /**
   * 컬럼 타입 (피벗용)
   * - 'data': 일반 데이터 컬럼 (기본값)
   * - 'subtotal': 소계 컬럼 (showColumnSubTotals에 의해 생성)
   * - 'grandtotal': 총합계 컬럼 (showColumnGrandTotals에 의해 생성)
   */
  pivotType?: 'data' | 'subtotal' | 'grandtotal';

  /**
   * 구조적 컬럼 여부 (Row의 structural과 동일한 개념)
   * - true: 선택/집계에서 제외
   * - false: 일반 데이터 컬럼 (기본값)
   *
   * 용도:
   * - 드래그 선택 후 집계 시 제외
   * - 복사/붙여넣기 시 제외 가능
   */
  structural?: boolean;
}
```

### 2.3 PivotRow 확장 (기존)

기존 `PivotRow`의 `type` 속성을 활용합니다:

```typescript
export interface PivotRow {
  /** 행 헤더 값들 (rowFields 순서대로) */
  rowHeaders: Record<string, CellValue>;

  /** 피벗된 값들 (동적 컬럼 키 → 값) */
  values: Record<string, CellValue>;

  /**
   * 행 타입
   * - 'data': 일반 데이터 행
   * - 'subtotal': 소계 행 (showRowSubTotals에 의해 생성)
   * - 'grandtotal': 총합계 행 (showRowGrandTotals에 의해 생성)
   */
  type: 'data' | 'subtotal' | 'grandtotal';

  /** 그룹 깊이 (subtotal인 경우 어떤 레벨의 소계인지) */
  depth?: number;
}
```

---

## 3. Row와 Column의 Structural 개념 일관성

### 3.1 비교 표

| 구분 | Row | Column |
|------|-----|--------|
| 속성 | `structural: boolean` | `structural: boolean` |
| 타입 | `type: 'data' \| 'subtotal' \| 'grandtotal'` | `pivotType: 'data' \| 'subtotal' \| 'grandtotal'` |
| 선택 제외 | ✅ structural=true면 선택 안됨 | ✅ structural=true면 집계에서 제외 |
| 인덱스 | ❌ dataIndex 없음 | - (컬럼은 인덱스 개념 없음) |

### 3.2 활용 예시

```typescript
// 드래그 선택 후 집계 시 structural 컬럼 제외
function aggregateSelectedCells(selectedCells: CellPosition[]): number {
  let sum = 0;

  for (const cell of selectedCells) {
    const columnDef = getColumnDef(cell.columnKey);

    // structural 컬럼은 집계에서 제외 (이중 계산 방지)
    if (columnDef.structural) continue;

    const value = getCellValue(cell);
    if (typeof value === 'number') {
      sum += value;
    }
  }

  return sum;
}
```

---

## 4. 구현 전략

### 4.1 구현 순서 및 난이도

| 순서 | 기능 | 위치 | 난이도 | 설명 |
|------|------|------|--------|------|
| 1 | `showRowSubTotals` | 데이터 중간 (행) | ⭐ 쉬움 | 행 계층 변경 시 소계 행 삽입 |
| 2 | `showRowGrandTotals` | 하단 (행) | ⭐ 쉬움 | 하단에 총합 행 추가 |
| 3 | `showColumnGrandTotals` | 우측 (컬럼) | ⭐⭐ 중간 | 컬럼 헤더 트리에 총합 컬럼 추가 |
| 4 | `showColumnSubTotals` | 데이터 중간 (컬럼) | ⭐⭐⭐ 복잡 | 컬럼 헤더 트리 구조 변경 |

### 4.2 영향 받는 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/pivot.types.ts` | PivotConfig 옵션 추가, 기존 옵션 deprecate |
| `src/types/data.types.ts` | ColumnDef에 pivotType, structural 추가 |
| `src/processor/PivotProcessor.ts` | 소계/총합계 행 생성 로직 |
| `src/ui/body/BodyRenderer.ts` | __pivotType에 따른 Row variant 설정 |
| `src/ui/row/Row.ts` | subtotal/grandtotal variant 렌더링 |
| `src/ui/style/default.css` | 소계/총합계 행 스타일 |
| `demo/examples/pivot.html` | 옵션 토글 UI 추가 |

---

## 5. 다중 레벨 소계 (showRowSubTotals)

### 5.1 동작 방식

`showRowSubTotals`가 활성화되고 `rowFields`가 여러 개일 때, 각 계층 레벨에서 소계가 삽입됩니다.

**예시: rowFields = [제품, 지역, 매장]**

```
┌──────────┬────────┬──────────┬─────┬─────┬─────┐
│ 제품     │ 지역   │ 매장     │ 1월 │ 2월 │ 3월 │
├──────────┼────────┼──────────┼─────┼─────┼─────┤
│ 노트북   │ 서울   │ 강남점   │ 100 │ 150 │ 120 │
│          │        │ 종로점   │  80 │ 120 │ 100 │
│          │ 서울 소계         ││ 180 │ 270 │ 220 │  ← depth: 1 (지역 레벨)
│          ├────────┼──────────┼─────┼─────┼─────┤
│          │ 부산   │ 해운대점 │  90 │ 110 │  95 │
│          │        │ 서면점   │  70 │  90 │  85 │
│          │ 부산 소계         ││ 160 │ 200 │ 180 │  ← depth: 1 (지역 레벨)
│ 노트북 소계                  ││ 340 │ 470 │ 400 │  ← depth: 0 (제품 레벨)
├──────────┼────────┼──────────┼─────┼─────┼─────┤
│ 스마트폰 │ ...    │ ...      │ ... │ ... │ ... │
```

### 5.2 PivotRow의 depth 속성

```typescript
interface PivotRow {
  type: 'data' | 'subtotal' | 'grandtotal';
  depth?: number;  // subtotal인 경우 계층 레벨 (0 = 최상위)
}

// 예시
{ type: 'subtotal', depth: 1 }  // 지역 레벨 소계
{ type: 'subtotal', depth: 0 }  // 제품 레벨 소계
{ type: 'grandtotal' }          // 총합계
```

---

## 6. CSS 스타일

```css
/* 소계 행 */
.ps-row-subtotal {
  background-color: #f0f4f8;
  font-weight: 600;
}

.ps-row-subtotal .ps-cell {
  background-color: #f0f4f8;
}

/* 총합계 행 */
.ps-row-grandtotal {
  background-color: #e2e8f0;
  font-weight: 700;
}

.ps-row-grandtotal .ps-cell {
  background-color: #e2e8f0;
}

/* 다크 테마 */
.ps-theme-dark .ps-row-subtotal,
.ps-theme-dark .ps-row-subtotal .ps-cell {
  background-color: #2d3748;
}

.ps-theme-dark .ps-row-grandtotal,
.ps-theme-dark .ps-row-grandtotal .ps-cell {
  background-color: #1a202c;
}

/* 소계/총합계 컬럼 (showColumnSubTotals, showColumnGrandTotals) */
.ps-cell[data-pivot-type="subtotal"] {
  background-color: #f0f4f8;
  font-weight: 600;
}

.ps-cell[data-pivot-type="grandtotal"] {
  background-color: #e2e8f0;
  font-weight: 700;
}
```

---

## 7. API 사용 예시

```typescript
const pivotGrid = new PureSheet(container, {
  mode: 'pivot',
  data: salesData,
  fields: [
    { key: 'product', header: '제품', dataType: 'string' },
    { key: 'region', header: '지역', dataType: 'string' },
    { key: 'month', header: '월', dataType: 'string' },
    { key: 'quarter', header: '분기', dataType: 'string' },
    { key: 'sales', header: '판매량', dataType: 'number', aggregate: 'sum' },
  ],
  rowFields: ['product', 'region'],
  columnFields: ['quarter', 'month'],
  valueFields: ['sales'],
});

// 피벗 설정에 소계/총합계 추가
await pivotGrid.setPivotConfig({
  rowFields: ['product', 'region'],
  columnFields: ['quarter', 'month'],
  valueFields: [{ field: 'sales', aggregate: 'sum' }],

  // 행 소계/총합계
  showRowSubTotals: true,      // 제품별 소계 행 표시
  showRowGrandTotals: true,    // 하단에 총합계 행 표시

  // 열 소계/총합계
  showColumnSubTotals: true,   // 분기별 소계 컬럼 표시
  showColumnGrandTotals: true, // 우측에 총합계 컬럼 표시
});
```

---

## 8. 레벨별 선택적 소계 (구현됨)

### 8.1 필드명 배열로 소계 레벨 지정

특정 필드에서만 소계를 표시하고 싶을 때 `rowSubTotalFields` 또는 `columnSubTotalFields`를 사용합니다.

```typescript
// rowFields: ['category', 'product', 'region']
// columnFields: ['year', 'quarter', 'month']

await pivotGrid.setPivotConfig({
  rowFields: ['category', 'product', 'region'],
  columnFields: ['year', 'quarter', 'month'],
  valueFields: [{ field: 'sales', aggregate: 'sum' }],

  // 행 소계: category, product 변경 시만 소계 (region은 소계 없음)
  showRowSubTotals: true,
  rowSubTotalFields: ['category', 'product'],

  // 열 소계: year, quarter 변경 시만 소계 (month는 소계 없음)
  showColumnSubTotals: true,
  columnSubTotalFields: ['year', 'quarter'],

  // 총합계
  showRowGrandTotals: true,
  showColumnGrandTotals: true,
});
```

### 8.2 동작 방식

| 옵션 조합 | 동작 |
|-----------|------|
| `showRowSubTotals: true` (rowSubTotalFields 없음) | 마지막 필드 제외 모든 레벨에서 소계 |
| `showRowSubTotals: true, rowSubTotalFields: ['category']` | category 변경 시만 소계 |
| `showRowSubTotals: false` | 소계 없음 |

---

## 9. 향후 확장 고려사항

### 9.1 소계 위치 옵션

```typescript
// 향후 확장: 소계 위치 선택
rowSubTotalsPosition: 'bottom',  // 그룹 하단 (기본값)
rowSubTotalsPosition: 'top',     // 그룹 상단
```

### 9.2 커스텀 집계 함수

```typescript
// 향후 확장: 소계/총합계에 다른 집계 함수 사용
showRowSubTotals: {
  enabled: true,
  aggregates: {
    sales: 'sum',
    profit: 'avg',  // 이익은 평균으로
  }
}
```

---

## 관련 문서

- [피벗 그리드 아키텍처](./008-pivot-grid-architecture.md)
- [필터/정렬 → 피벗 파이프라인](./011-filter-sort-pivot-pipeline.md)
- [Row 클래스 아키텍처](./007-row-class-architecture.md)
- [UI Architecture](../base/ARCHITECTURE-UI.md)
