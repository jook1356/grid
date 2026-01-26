# 23회차: 유연한 컬럼 너비 처리

## 개요

컬럼 너비(width, minWidth, maxWidth)를 숫자뿐만 아니라 CSS 문자열('150px', '20rem', '15%', 'auto')로도 지정할 수 있도록 개선했습니다.

## 왜 이게 필요한가?

기존에는 configAdapter에서 width를 무조건 숫자(픽셀)로 변환했습니다. 이로 인해:
- `'15%'`, `'20rem'`, `'auto'` 등 CSS 단위 사용 불가
- 반응형 레이아웃 구현 어려움
- CSS의 자연스러운 minWidth/maxWidth 제약 활용 불가

## 무엇을 했나?

### 핵심 전략: "헤더가 기준이 된다"

1. 헤더 셀에 인라인 스타일로 width/minWidth/maxWidth 적용
2. 렌더링 후 헤더의 clientWidth를 측정
3. 측정값을 CSS 변수(`--col-컬럼명-width`)에 설정
4. 모든 셀(헤더/데이터)이 CSS 변수를 참조하여 동기화

### 타입 변경

```typescript
// FieldDef, ColumnDef
width?: number | string;     // 150, '150px', '15%', '20rem', 'auto'
minWidth?: number | string;
maxWidth?: number | string;
```

### 변환 유틸리티

```typescript
// cssUtils.ts
function toCSSValue(value: number | string | undefined): string | undefined
function toPixelNumber(value: number | string | undefined): number | undefined
```

## 생성/수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `docs/decisions/019-flexible-column-width-implementation.md` | 설계 결정 문서 |
| `src/types/field.types.ts` | width/minWidth/maxWidth 타입을 `number \| string`으로 확장 |
| `src/types/data.types.ts` | ColumnDef의 width/minWidth/maxWidth 타입 확장 |
| `src/ui/utils/configAdapter.ts` | width 숫자 변환 로직 제거, 값 그대로 전달 |
| `src/ui/utils/cssUtils.ts` | **새 파일** - `toCSSValue()`, `toPixelNumber()` 유틸리티 |
| `src/ui/header/HeaderCell.ts` | 인라인 스타일로 width/minWidth/maxWidth 적용 |
| `src/ui/GridRenderer.ts` | 렌더링 후 clientWidth 측정하여 CSS 변수 설정 |
| `src/ui/interaction/ColumnManager.ts` | width 타입 처리 수정 |
| `src/ui/pivot/PivotHeaderRenderer.ts` | width 타입 처리 수정 |

## 핵심 코드

### HeaderCell - 인라인 스타일 적용

```typescript
private applyWidthStyles(cell: HTMLElement, columnDef: ColumnDef): void {
  const widthValue = toCSSValue(columnDef.width) ?? `${DEFAULT_COLUMN_WIDTH}px`;
  cell.style.width = widthValue;

  const minWidthValue = toCSSValue(columnDef.minWidth);
  if (minWidthValue) {
    cell.style.minWidth = minWidthValue;
  }

  const maxWidthValue = toCSSValue(columnDef.maxWidth);
  if (maxWidthValue) {
    cell.style.maxWidth = maxWidthValue;
  }
}
```

### GridRenderer - clientWidth 측정

```typescript
private measureColumnWidths(): void {
  requestAnimationFrame(() => {
    const headerCells = this.headerElement.querySelectorAll<HTMLElement>('.ps-header-cell');

    headerCells.forEach((cell) => {
      const columnKey = cell.dataset['columnKey'];
      const measuredWidth = cell.clientWidth;

      // ColumnState 업데이트
      const state = this.columnStates.find((c) => c.key === columnKey);
      if (state && measuredWidth > 0) {
        state.width = measuredWidth;
      }

      // CSS 변수 설정
      this.gridContainer.style.setProperty(`--col-${columnKey}-width`, `${measuredWidth}px`);
    });
  });
}
```

## 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [
    { key: 'id', header: 'ID', dataType: 'number', width: 60 },
    { key: 'name', header: '이름', dataType: 'string', width: '150px' },
    { key: 'email', header: '이메일', dataType: 'string', width: '20rem' },
    { key: 'ratio', header: '비율', dataType: 'string', width: '15%' },
    { key: 'status', header: '상태', dataType: 'string', width: 'auto' },
    {
      key: 'description',
      header: '설명',
      dataType: 'string',
      width: 'auto',
      minWidth: 100,
      maxWidth: 400
    },
  ],
  data: [...],
});
```

## 다음 회차 예고

- flex 속성 지원 추가 (남은 공간 비율 분배)
- 컬럼 리사이즈 시 flex 자동 제거 로직
