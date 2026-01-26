# 24회차: 컬럼 Flex 지원 및 ResizeObserver 성능 최적화

## 개요

컬럼에 `flex` 속성을 추가하여 남은 공간을 비율로 분배할 수 있게 하고, ResizeObserver를 통합하여 성능을 최적화했습니다.

## 왜 이게 필요한가?

### Flex 속성 필요성
- 그리드 너비에 맞춰 컬럼이 자동으로 늘어나야 하는 경우
- 여러 컬럼이 남은 공간을 비율로 나눠 가져야 하는 경우
- AG Grid 등 다른 그리드 라이브러리와의 API 호환성

### 성능 최적화 필요성
기존 구현의 문제점:
1. **ResizeObserver 과다 생성**: flex 컬럼마다 개별 인스턴스 생성
2. **불필요한 인라인 스타일**: 셀마다 4개의 스타일 설정
3. **비효율적 DOM 쿼리**: `find()` 반복 호출로 O(n²) 복잡도

## 무엇을 했나?

### 1단계: Flex 속성 지원 (기능 추가)

```typescript
// FieldDef, ColumnDef
flex?: number;  // 남은 공간을 비율로 분배
```

동작 방식:
- 헤더 셀에 `style.flex = 값` 적용
- 데이터 셀은 헤더 너비를 CSS 변수로 참조
- 드래그 리사이즈 시 `flex` 자동 제거 (고정 픽셀로 전환)

### 2단계: ResizeObserver 통합 (성능 최적화)

**Before**: N개 flex 컬럼 → N개 ResizeObserver
**After**: 모든 헤더 셀 → 1개 ResizeObserver

```typescript
// HeaderRenderer.ts
private headerResizeObserver: ResizeObserver | null = null;

private setupHeaderResizeObserver(): void {
  this.headerResizeObserver = new ResizeObserver((entries) => {
    requestAnimationFrame(() => {
      for (const entry of entries) {
        const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? ...);

        // 변경 없으면 스킵 (성능 최적화)
        if (state && state.width === width) continue;

        // CSS 변수 및 상태 업데이트
        gridContainer.style.setProperty(`--col-${columnKey}-width`, `${width}px`);
      }
    });
  });
}
```

### 3단계: 인라인 스타일 최소화

**Before** (셀당 4개 스타일):
```typescript
cell.style.width = `var(--col-${key}-width, ...)`;
cell.style.minWidth = `var(--col-${key}-min-width, auto)`;
cell.style.maxWidth = `var(--col-${key}-max-width, none)`;
cell.style.flex = '';
```

**After** (셀당 1개 스타일):
```typescript
cell.style.width = `var(--col-${key}-width, ...)`;
// minWidth/maxWidth/flex는 헤더에서 계산 후 CSS 변수에 반영됨
```

### 4단계: DOM 쿼리 최적화

**measureColumnWidths()**: `find()` → Map 조회로 O(n²) → O(n)
**setColumnWidth()**: bodyCells 순회 제거

## 생성/수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/field.types.ts` | `flex?: number` 속성 추가 |
| `src/types/data.types.ts` | `flex?: number` 속성 추가 |
| `src/ui/header/HeaderCell.ts` | ResizeObserver 코드 제거, `applyWidthStyles()`에 flex 추가 |
| `src/ui/header/HeaderRenderer.ts` | 단일 `headerResizeObserver` 추가, 모든 헤더 셀 관찰 |
| `src/ui/GridRenderer.ts` | `measureColumnWidths()` Map 최적화, bodyCells 순회 제거 |
| `src/ui/row/Row.ts` | 불필요한 인라인 스타일 제거 (minWidth, maxWidth, flex) |

## 성능 개선 결과

| 항목 | Before | After |
|------|--------|-------|
| ResizeObserver 인스턴스 | N개 (flex 컬럼 수) | **1개** |
| 셀당 인라인 스타일 | 4개 | **1개** |
| setColumnWidth DOM 쿼리 | O(보이는 행 수) | **O(1)** |
| measureColumnWidths 복잡도 | O(n²) | **O(n)** |

### ResizeObserver 성능 특성

| 시나리오 | 콜백 호출 | 오버헤드 |
|---------|----------|---------|
| 페이지 로드 | 1회 | 낮음 |
| 창 리사이즈 | 가변 컬럼만 | **매우 낮음** |
| 스크롤 | 0회 | **없음** |
| 데이터 로드 | 0회 | **없음** |

## 핵심 코드

### HeaderRenderer - 단일 ResizeObserver

```typescript
private setupHeaderResizeObserver(): void {
  this.headerResizeObserver = new ResizeObserver((entries) => {
    requestAnimationFrame(() => {
      for (const entry of entries) {
        const columnKey = (entry.target as HTMLElement).dataset['columnKey'];
        const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? ...);

        // 변경 없으면 스킵
        const state = this.columns.find((c) => c.key === columnKey);
        if (state && state.width === width) continue;

        // 업데이트
        gridContainer.style.setProperty(`--col-${columnKey}-width`, `${width}px`);
        if (state) state.width = width;

        this.onHeaderCellResize?.(columnKey, width);
      }
    });
  });
}
```

### HeaderCell - Flex 스타일 적용

```typescript
private applyWidthStyles(cell: HTMLElement, columnDef: ColumnDef): void {
  const widthValue = toCSSValue(columnDef.width) ?? `${DEFAULT_COLUMN_WIDTH}px`;
  cell.style.width = widthValue;

  if (columnDef.minWidth) cell.style.minWidth = toCSSValue(columnDef.minWidth)!;
  if (columnDef.maxWidth) cell.style.maxWidth = toCSSValue(columnDef.maxWidth)!;

  // flex: 남은 공간 비율 분배
  if (columnDef.flex !== undefined) {
    cell.style.flex = String(columnDef.flex);
  }
}
```

## 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [
    { key: 'id', header: 'ID', dataType: 'number', width: 60 },
    { key: 'name', header: '이름', dataType: 'string', flex: 1 },  // 남은 공간 1/3
    { key: 'email', header: '이메일', dataType: 'string', flex: 2 }, // 남은 공간 2/3
    { key: 'status', header: '상태', dataType: 'string', width: '15%' },
  ],
  data: [...],
});
```

## 지원되는 너비 단위

| 단위 | 예시 | 동적 감시 |
|------|------|----------|
| px (숫자) | `width: 150` | ✅ (변경 없으면 스킵) |
| px (문자열) | `width: '150px'` | ✅ |
| % | `width: '20%'` | ✅ |
| rem, em | `width: '10rem'` | ✅ |
| auto | `width: 'auto'` | ✅ |
| flex | `flex: 1` | ✅ |

## 다음 회차 예고

- 컬럼 자동 너비 (autoSizeColumn) 기능
- 더블클릭으로 컬럼 너비 자동 조절
