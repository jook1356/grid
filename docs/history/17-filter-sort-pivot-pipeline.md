# 17. 필터/정렬 → 피벗 통합 파이프라인

## 개요

이번 회차에서는 **필터 → 정렬 → 피벗** 순서로 데이터 처리가 통합되도록 파이프라인을 구현했습니다.

### 문제 상황

기존에는:
- 필터/정렬과 피벗이 **별개로** 동작
- 피벗 모드에서 필터/정렬 적용 시 **반영되지 않음**
- 정렬이 피벗 결과의 행/열 순서에 영향을 주지 않음

### 해결 방향

통합된 데이터 처리 파이프라인 구축:

```
원본 데이터 → 필터 적용 → 정렬 적용 → 피벗 연산 → 렌더링
                ↓             ↓            ↓
           데이터 축소   순서 결정   집계 + 구조 변환
```

---

## 구현 내용

### 1. 데이터 처리 파이프라인 통합

#### 처리 순서
| 단계 | 연산 | 설명 |
|------|------|------|
| 1 | **필터** | 조건에 맞는 데이터만 추출 |
| 2 | **정렬** | 데이터 순서 결정 |
| 3 | **피벗** | 집계 및 구조 변환 (선택) |

#### 핵심 원칙
- 필터/정렬은 피벗 사용 여부와 **무관하게 공통 적용**
- 피벗은 필터/정렬된 데이터 위에 **추가 연산**
- 중복 처리 방지 (GridCore가 한 번만 계산)

### 2. 정렬이 피벗에 미치는 영향

정렬 대상에 따라 피벗 결과가 달라집니다:

| 정렬 대상 | 영향 받는 부분 | 예시 |
|----------|---------------|------|
| **rowFields** | 행 순서 | `product 내림차순` → Z~A |
| **columnFields** | 컬럼 헤더 순서 | `month 내림차순` → 12월~1월 |
| **valueFields** | 집계값 기준 행 순서 | `sales 내림차순` → 매출 높은 순 |

#### 다중 컬럼 필드 계층 구조

`columnFields = ['year', 'month']` 일 때:

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

---

## 수정된 파일

### 핵심 파일

#### `src/ui/PureSheet.ts`

**변경 내용:**
1. `sort()`, `filter()` 메서드에서 피벗 모드일 때 `applyPivot()` 재호출
2. `applyPivot()`에서 viewState의 필터/정렬 상태를 확인하여 적용
3. sorts를 PivotConfig에 전달

```typescript
// sort() 메서드
async sort(sorts: SortState[]): Promise<void> {
  await this.gridCore.sort(sorts);
  
  // 피벗 모드면 정렬 반영을 위해 피벗 재적용
  if (this.pivotConfig) {
    await this.applyPivot();
  }
  
  this.gridRenderer.render();
}

// applyPivot() 메서드
private async applyPivot(): Promise<void> {
  // ...
  const viewState = this.gridCore.getViewState();
  
  // sorts를 PivotConfig에 전달
  const pivotConfigWithSorts = {
    ...this.pivotConfig,
    sorts: viewState.sorts,
  };
  this.pivotResult = await this.pivotProcessor.pivot(pivotConfigWithSorts);
  // ...
}
```

#### `src/processor/PivotProcessor.ts`

**변경 내용:**
1. `extractUniqueValues()`에 sorts 파라미터 추가 → 컬럼 헤더 순서 결정
2. `transformToPivotStructure()`에서 sorts를 사용한 행 정렬
3. `sumValuesForColumn()` 헬퍼 추가 → valueFields 기준 정렬 지원

```typescript
// 유니크 값 추출 시 정렬 방향 반영
private extractUniqueValues(
  table: Table,
  columnFields: string[],
  sorts?: SortState[]
): Record<string, CellValue[]> {
  // ...
  const sortConfig = sorts?.find(s => s.columnKey === field);
  const direction = sortConfig?.direction ?? 'asc';
  
  values.sort((a, b) => {
    // 정렬 방향에 따라 오름차순/내림차순 적용
    return direction === 'desc' ? -comparison : comparison;
  });
}

// 피벗 결과 정렬
if (config.sorts && config.sorts.length > 0) {
  result.sort((a, b) => {
    // rowHeaders 또는 values 기준 정렬
  });
}
```

#### `src/core/GridCore.ts`

**변경 내용:**
1. `getVisibleData()` 메서드 추가 → 필터/정렬 적용된 데이터 반환
2. `getProcessor()` 메서드 추가 → 프로세서 인스턴스 접근

```typescript
getVisibleData(): Row[] {
  const allData = this.dataStore.getData();
  const visibleIndices = this.indexManager.getVisibleIndices();
  return Array.from(visibleIndices)
    .map(i => allData[i])
    .filter((row): row is Row => row !== undefined);
}

getProcessor(): ArqueroProcessor {
  return this.processor;
}
```

#### `src/processor/ArqueroProcessor.ts`

**변경 내용:**
- `applyFilter()` 메서드를 `protected`로 변경 → PivotProcessor에서 상속 사용

#### `src/ui/body/BodyRenderer.ts`

**변경 내용:**
- `updateVirtualRows()`에서 `getAllData()` → `getVisibleData()` 변경
- 그룹핑 모드에서도 필터/정렬이 적용되도록 수정

### 타입 정의

#### `src/types/pivot.types.ts`

```typescript
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

### 데모 예제

#### `demo/examples/grouping.html`

- 필터/정렬 UI 툴바 추가
- `applyFilter()`, `clearFilter()`, `applySort()` 함수 구현

#### `demo/examples/pivot.html`

- 필터/정렬 UI 툴바 추가
- 필터/정렬 상태 표시
- 정렬 시 컬럼/행 순서 변경 확인 가능

---

## 아키텍처 다이어그램

### 데이터 흐름

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Source    │────▶│   Filter    │────▶│    Sort     │────▶│   Render    │
│    Data     │     │  (조건부)   │     │  (조건부)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼ (피벗 모드)
                                        ┌─────────────┐
                                        │    Pivot    │
                                        │  (집계/변환) │
                                        └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   Render    │
                                        │ (피벗 헤더) │
                                        └─────────────┘
```

### 모듈 간 상호작용

```
┌─────────────────────────────────────────────────────────────────┐
│                         PureSheet (UI API)                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────┐                 │
│  │ sort()  │  │filter() │  │ setPivotConfig()│                 │
│  └────┬────┘  └────┬────┘  └────────┬────────┘                 │
│       │            │                │                           │
│       ▼            ▼                ▼                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    applyPivot()                          │   │
│  │  1. viewState에서 filters/sorts 확인                     │   │
│  │  2. processor.query()로 필터/정렬된 인덱스 계산          │   │
│  │  3. 해당 인덱스의 데이터로 피벗 연산                     │   │
│  │  4. sorts를 PivotConfig에 전달 (헤더 순서 결정)          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PivotProcessor                             │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │extractUniqueValues│  │transformToPivot │                    │
│  │  (sorts 반영)     │  │  Structure      │                    │
│  │  → 컬럼 헤더 순서 │  │  (sorts 반영)   │                    │
│  │                   │  │  → 행 순서      │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 핵심 개념

### 1. 왜 피벗 전에 필터/정렬이 필요한가?

피벗은 데이터를 **집계**하는 연산입니다:
- **필터**: 집계 대상 데이터를 제한 (예: 2024년 데이터만 피벗)
- **정렬**: 피벗 결과의 행/열 순서 결정

### 2. 정렬이 피벗 결과에 미치는 영향

| 정렬 적용 시점 | 영향 |
|---------------|------|
| 유니크 값 추출 시 | **컬럼 헤더 순서** 결정 |
| 피벗 결과 변환 시 | **행 순서** 결정 |

### 3. Method B 선택 이유

두 가지 접근법을 비교:

| 방법 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A** | PivotProcessor가 직접 필터/정렬 | 독립적 | 중복 처리 |
| **B** ✅ | GridCore가 계산 후 전달 | 효율적 | 의존성 |

**Method B 선택**: GridCore가 필터/정렬을 한 번만 계산하고, 그 결과를 PivotProcessor에 전달

---

## 테스트 방법

### 그룹핑 예제 (`demo/examples/grouping.html`)

1. 필터 적용: `product` 필드에 "노트북" 입력 → 해당 제품만 표시
2. 정렬 적용: `sales` 컬럼 내림차순 → 매출 높은 순 정렬
3. 필터 해제 (X 버튼) → 전체 데이터 복원

### 피벗 예제 (`demo/examples/pivot.html`)

1. **필터 테스트**:
   - `region` 필드에 "서울" 입력
   - 서울 지역 데이터만 피벗 결과에 반영 확인

2. **정렬 테스트 (행)**:
   - `product` 컬럼 내림차순
   - 행 헤더 순서 변경 확인 (Z → A)

3. **정렬 테스트 (컬럼)**:
   - `month` 컬럼 내림차순
   - 컬럼 헤더 순서 변경 확인 (12월 → 1월)

4. **정렬 테스트 (집계값)**:
   - `sales` 컬럼 내림차순
   - 매출 합계 높은 제품이 위로 정렬

---

## 다음 회차 예고

- 피벗 모드에서 소계/총계 행 추가
- 피벗 헤더 클릭 시 정렬 토글 UI
- 피벗 결과 내보내기 (CSV/Excel)
