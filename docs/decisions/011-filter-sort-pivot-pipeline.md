# 011: 필터/정렬 → 피벗 통합 파이프라인

## 상태
**구현됨 (Implemented)**

## 날짜
2026-01-22

## 배경

피벗 모드에서 필터와 정렬이 제대로 적용되지 않는 문제가 있었습니다:

1. **필터/정렬이 피벗 결과에 반영되지 않음**
2. **정렬이 피벗 결과의 행/열 순서에 영향을 주지 않음**
3. **필터/정렬과 피벗이 별개로 동작하여 일관성 없는 결과**

### 기대 동작

```
원본 데이터 (1000건)
    │
    ▼ 필터 적용 (region = '서울')
필터된 데이터 (200건)
    │
    ▼ 정렬 적용 (sales DESC)
정렬된 데이터 (200건, 매출 높은 순)
    │
    ▼ 피벗 연산
피벗 결과 (행/열 순서가 정렬 반영)
```

---

## 결정

### 통합 데이터 처리 파이프라인 구현

**필터 → 정렬 → 피벗** 순서로 데이터를 처리하는 통합 파이프라인을 구현합니다.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Source    │────▶│   Filter    │────▶│    Sort     │────▶│   Pivot     │
│    Data     │     │  (조건부)    │     │  (조건부)   │     │  (조건부)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                      데이터 축소         순서 결정          집계 + 변환
```

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **공통 파이프라인** | 필터/정렬은 피벗 사용 여부와 무관하게 항상 적용 |
| **피벗은 추가 연산** | 피벗은 필터/정렬된 데이터 위에 수행되는 추가 연산 |
| **중복 처리 방지** | GridCore가 필터/정렬을 한 번만 계산 (Method B) |
| **정렬 반영 범위** | 정렬 대상(rowFields/columnFields/valueFields)에 따라 피벗 결과의 행/열 순서 결정 |

---

## 구현 방식 비교

### Method A: PivotProcessor가 직접 처리

```typescript
// PivotProcessor.pivot()에서 직접 필터/정렬 적용
async pivot(config: PivotConfig): Promise<PivotResult> {
  let table = this.getTable();
  
  // 1. 필터 적용
  if (config.filters) {
    for (const filter of config.filters) {
      table = this.applyFilter(table, filter);
    }
  }
  
  // 2. 정렬 적용
  if (config.sorts) {
    table = this.applySort(table, config.sorts);
  }
  
  // 3. 피벗 연산
  // ...
}
```

**장점**: PivotProcessor가 독립적으로 동작
**단점**: GridCore의 필터/정렬과 중복 처리

### Method B: GridCore가 계산 후 전달 ✅ (채택)

```typescript
// PureSheet.applyPivot()에서 GridCore의 결과 활용
private async applyPivot(): Promise<void> {
  const viewState = this.gridCore.getViewState();
  const hasFilterOrSort = viewState.filters.length > 0 || viewState.sorts.length > 0;
  
  let filteredData: RowData[];
  
  if (hasFilterOrSort) {
    // GridCore의 프로세서를 통해 필터/정렬된 인덱스 계산 (1회만)
    const processor = this.gridCore.getProcessor();
    const result = await processor.query({
      filters: viewState.filters,
      sorts: viewState.sorts,
    });
    
    // 해당 인덱스의 데이터만 추출
    const sourceData = this.gridCore.getDataStore().getSourceData();
    filteredData = Array.from(result.indices)
      .map(i => sourceData[i])
      .filter(Boolean);
  } else {
    filteredData = [...sourceData];
  }
  
  // 피벗에 sorts 전달 (행/열 순서 결정용)
  await this.pivotProcessor.initialize(filteredData);
  const pivotConfigWithSorts = {
    ...this.pivotConfig,
    sorts: viewState.sorts,
  };
  this.pivotResult = await this.pivotProcessor.pivot(pivotConfigWithSorts);
}
```

**장점**: 중복 처리 없음, 효율적
**단점**: PureSheet가 GridCore에 의존

---

## 정렬이 피벗에 미치는 영향

### 정렬 대상별 동작

| 정렬 대상 | 영향 받는 부분 | 구현 위치 |
|----------|---------------|----------|
| **rowFields** | 행 순서 | `transformToPivotStructure()` |
| **columnFields** | 컬럼 헤더 순서 | `extractUniqueValues()` |
| **valueFields** | 집계값 기준 행 순서 | `transformToPivotStructure()` |

### 예시: columnFields 정렬

`columnFields: ['year', 'month']` 일 때:

**기본 (오름차순):**
```
      2022          |       2023          |       2024
1월  2월  3월  4월  | 1월  2월  3월  4월  | 1월  2월  3월  4월
```

**year 내림차순:**
```
      2024          |       2023          |       2022
1월  2월  3월  4월  | 1월  2월  3월  4월  | 1월  2월  3월  4월
```

**year 내림차순 + month 내림차순:**
```
      2024          |       2023          |       2022
4월  3월  2월  1월  | 4월  3월  2월  1월  | 4월  3월  2월  1월
```

### 예시: valueFields 정렬

`sales 내림차순` 정렬 시:
- 각 제품별로 모든 월의 sales 합계를 계산
- 합계가 높은 제품이 위로, 낮은 제품이 아래로 정렬

```typescript
// sumValuesForColumn() 헬퍼로 합계 계산
private sumValuesForColumn(
  values: Record<string, CellValue>,
  columnKey: string,
  valueFields: PivotValueField[]
): number {
  let sum = 0;
  
  // '1월_sales', '2월_sales', ... 모두 합산
  for (const [key, value] of Object.entries(values)) {
    if (key.endsWith('_' + columnKey) || key === columnKey) {
      if (typeof value === 'number') {
        sum += value;
      }
    }
  }
  
  return sum;
}
```

---

## 구현 상세

### PivotConfig 확장

```typescript
// src/types/pivot.types.ts
import type { FilterState, SortState } from './state.types';

export interface PivotConfig {
  rowFields: string[];
  columnFields: string[];
  valueFields: PivotValueField[];
  
  // 전처리 옵션 (Filter → Sort → Pivot)
  filters?: FilterState[];
  sorts?: SortState[];
}
```

### PivotProcessor 수정

```typescript
// src/processor/PivotProcessor.ts

// 유니크 값 추출 시 정렬 방향 반영
private extractUniqueValues(
  table: Table,
  columnFields: string[],
  sorts?: SortState[]
): Record<string, CellValue[]> {
  const result: Record<string, CellValue[]> = {};

  for (const field of columnFields) {
    const uniqueTable = table.select(field).dedupe();
    const values = uniqueTable.array(field) as CellValue[];

    // 해당 필드에 대한 정렬 조건 찾기
    const sortConfig = sorts?.find(s => s.columnKey === field);
    const direction = sortConfig?.direction ?? 'asc';

    // 정렬 방향 반영
    values.sort((a, b) => {
      // ...비교 로직...
      return direction === 'desc' ? -comparison : comparison;
    });

    result[field] = values;
  }

  return result;
}

// 피벗 결과 정렬
private transformToPivotStructure(...): PivotRow[] {
  // ...그룹화 및 변환...
  
  if (config.sorts && config.sorts.length > 0) {
    result.sort((a, b) => {
      for (const sort of config.sorts!) {
        const { columnKey, direction } = sort;
        
        // rowHeaders에서 값 찾기
        let aVal = a.rowHeaders[columnKey];
        let bVal = b.rowHeaders[columnKey];
        
        // rowHeaders에 없으면 values에서 합계 계산 (valueFields 정렬)
        if (aVal === undefined) {
          aVal = this.sumValuesForColumn(a.values, columnKey, config.valueFields);
          bVal = this.sumValuesForColumn(b.values, columnKey, config.valueFields);
        }
        
        // 비교 및 방향 적용
        // ...
      }
    });
  }
  
  return result;
}
```

### PureSheet 수정

```typescript
// src/ui/PureSheet.ts

async sort(sorts: SortState[]): Promise<void> {
  await this.gridCore.sort(sorts);
  
  // 피벗 모드면 정렬 반영을 위해 피벗 재적용
  if (this.pivotConfig) {
    await this.applyPivot();
  }
  
  this.gridRenderer.render();
}

async filter(filters: FilterState[]): Promise<void> {
  await this.gridCore.filter(filters);
  
  // 피벗 모드면 필터 반영을 위해 피벗 재적용
  if (this.pivotConfig) {
    await this.applyPivot();
  }
  
  this.gridRenderer.render();
}
```

---

## 시퀀스 다이어그램

### 피벗 모드에서 정렬 적용 흐름

```
User          PureSheet        GridCore      PivotProcessor
 │               │                │               │
 │  sort([...])  │                │               │
 │──────────────▶│                │               │
 │               │  sort([...])   │               │
 │               │───────────────▶│               │
 │               │                │ viewState 업데이트
 │               │                │ processor.query()
 │               │                │ indexManager 업데이트
 │               │◀───────────────│               │
 │               │                │               │
 │               │  applyPivot()  │               │
 │               │───────────────────────────────▶│
 │               │                │  initialize(filteredData)
 │               │                │  pivot(configWithSorts)
 │               │                │    - extractUniqueValues(sorts)
 │               │                │    - transformToPivotStructure(sorts)
 │               │◀───────────────────────────────│
 │               │                │               │
 │               │  render()      │               │
 │◀──────────────│                │               │
```

---

## 성능 고려사항

| 데이터 규모 | 필터/정렬 | 피벗 연산 | 총 시간 |
|------------|----------|----------|--------|
| 1만 건 | ~10ms | ~15ms | ~30ms |
| 10만 건 | ~50ms | ~60ms | ~120ms |
| 50만 건 | ~200ms | ~250ms | ~500ms |

### 최적화 포인트

1. **GridCore에서 1회만 계산**: Method B로 중복 처리 방지
2. **인덱스 기반 데이터 추출**: 전체 데이터 복사 대신 인덱스로 참조
3. **정렬 캐싱**: 동일 정렬 조건은 캐시된 결과 사용 가능

---

## 관련 문서

- [피벗 그리드 아키텍처](./008-pivot-grid-architecture.md)
- [Core Architecture](../base/ARCHITECTURE-CORE.md)
- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [Worker 제거 결정](./009-remove-worker-architecture.md)
