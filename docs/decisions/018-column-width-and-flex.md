# 018: 컬럼 너비 및 Flex 기능 개선

## 상태
**제안됨** (2026-01-27)

## 컨텍스트

현재 PureSheet의 컬럼 너비 처리에 다음과 같은 제한이 있습니다:

1. **configAdapter에서 숫자로 강제 변환**: `width`를 항상 픽셀 숫자로 파싱
2. **CSS 단위 미지원**: `'15%'`, `'20rem'` 등 CSS 단위 문자열 사용 불가
3. **flex 미지원**: 남은 공간 비율 분배 기능 없음

### 현재 코드 (configAdapter.ts)

```typescript
export function fieldToColumn(field: FieldDef): ColumnDef {
  let width = field.width;
  if (!width && field.style) {
    const widthMatch = field.style.match(/width:\s*(\d+)px/);
    if (widthMatch) {
      width = parseInt(widthMatch[1], 10);
    }
  }
  return {
    ...
    width: width ?? 150,  // 항상 숫자
  };
}
```

---

## 결정

### 1. width/minWidth/maxWidth 타입 확장

`number` 타입에서 `number | string`으로 확장하여 CSS 단위 문자열을 지원합니다.

```typescript
interface FieldDef {
  width?: number | string;    // 150, '150px', '15%', '20rem'
  minWidth?: number | string;
  maxWidth?: number | string;
  flex?: number;              // 새로 추가
}
```

### 2. configAdapter에서 변환 로직 제거

configAdapter는 값을 **그대로 전달**만 하고, 실제 스타일 적용은 렌더링 레이어에서 처리합니다.

```typescript
// Before
width: width ?? 150  // 항상 숫자로 변환

// After
width: field.width   // 그대로 전달 (undefined 가능)
```

### 3. 스타일 적용 전략

#### 3.1 CSS 변수 기반 (기존 유지)

현재 사용 중인 `--col-컬럼명-width` CSS 변수 방식을 유지합니다.

```css
/* GridRenderer에서 설정 */
--col-name-width: 150px;
--col-email-width: 20%;

/* HeaderCell, Row에서 사용 */
cell.style.width = var(--col-name-width, 150px);
```

#### 3.2 초기 스타일 적용

GridRenderer에서 `<style>` 태그를 동적으로 생성하여 컬럼별 스타일을 적용합니다:

```css
.ps-cell[data-column-key="name"],
.ps-header-cell[data-column-key="name"] {
  width: 150px;
  min-width: 100px;
  max-width: 300px;
}

.ps-cell[data-column-key="description"],
.ps-header-cell[data-column-key="description"] {
  flex: 1;
  min-width: 100px;
}
```

#### 3.3 값 변환 규칙

| 입력 | CSS 출력 |
|------|----------|
| `150` (숫자) | `150px` |
| `'150px'` | `150px` |
| `'15%'` | `15%` |
| `'20rem'` | `20rem` |
| `undefined` | (기본값 적용) |

### 4. Flex 동작

#### 4.1 기본 동작

`flex` 속성이 설정된 컬럼은 CSS `flex` 스타일이 적용되어 남은 공간을 비율에 따라 분배받습니다.

```typescript
fields: [
  { key: 'id', width: 60 },              // 고정 60px
  { key: 'description', flex: 1 },        // 남은 공간의 1/3
  { key: 'notes', flex: 2 },              // 남은 공간의 2/3
]
```

#### 4.2 드래그 시 Flex 제거

컬럼 헤더를 드래그하여 리사이즈를 시작하면:

1. **mousedown 시점**에 해당 컬럼의 `clientWidth` 측정
2. 측정된 값을 `--col-컬럼명-width` CSS 변수에 설정
3. 해당 컬럼의 `flex` 스타일 제거
4. 이후 드래그는 고정 너비로 동작

```typescript
// HeaderRenderer.handleResizeStart()
const clientWidth = headerCell.clientWidth;
onColumnResizeStart?.(columnKey, clientWidth);

// GridRenderer.handleColumnResizeStart()
gridContainer.style.setProperty(`--col-${columnKey}-width`, `${clientWidth}px`);
removeColumnFlex(columnKey);  // flex 제거 후 스타일 태그 재생성
```

### 5. 가상화와의 호환

가로 가상화(HorizontalVirtualScroller)는 컬럼의 **실제 렌더링 너비**가 필요합니다.

#### 해결 방안

1. 헤더 렌더링 후 `clientWidth`를 측정하여 `ColumnState.width`에 반영
2. 이 값을 가상화 계산에 사용

```typescript
// GridRenderer.measureColumnWidths()
requestAnimationFrame(() => {
  headerCells.forEach(cell => {
    const columnKey = cell.dataset.columnKey;
    const state = columnStates.find(c => c.key === columnKey);
    if (state) {
      state.width = cell.clientWidth;  // 실제 렌더링된 너비
    }
  });
});
```

---

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/field.types.ts` | `FieldDef`에 flex 추가, width 타입 확장 |
| `src/types/data.types.ts` | `ColumnDef`에 flex 추가, width 타입 확장 |
| `src/ui/utils/configAdapter.ts` | width 숫자 변환 로직 제거, flex 전달 |
| `src/ui/GridRenderer.ts` | 스타일 태그 생성, clientWidth 측정, flex 제거 로직 |
| `src/ui/header/HeaderRenderer.ts` | `onColumnResizeStart` 콜백 추가 |
| `src/ui/header/HeaderCell.ts` | 인라인 width 스타일 제거 (선택적) |
| `src/ui/row/Row.ts` | 인라인 width 스타일 제거 (선택적) |

---

## 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [
    // 고정 픽셀 너비
    { key: 'id', header: 'ID', dataType: 'number', width: 60 },

    // CSS 문자열 너비
    { key: 'name', header: '이름', dataType: 'string', width: '150px' },
    { key: 'ratio', header: '비율', dataType: 'string', width: '15%' },

    // min/max 제약
    {
      key: 'email',
      header: '이메일',
      dataType: 'string',
      width: 200,
      minWidth: 100,
      maxWidth: 400
    },

    // Flex 비율 기반
    { key: 'description', header: '설명', dataType: 'string', flex: 1, minWidth: 100 },
    { key: 'notes', header: '비고', dataType: 'string', flex: 2, minWidth: 150 },
  ],
  data: [...],
});
```

---

## 구현 순서

1. **타입 정의 수정** - FieldDef, ColumnDef 타입 확장
2. **configAdapter 수정** - 변환 로직 제거, 그대로 전달
3. **GridRenderer 수정** - 스타일 태그 생성, clientWidth 측정
4. **HeaderRenderer 수정** - onColumnResizeStart 콜백
5. **인라인 스타일 정리** - HeaderCell, Row에서 제거 (선택적)
6. **예제 페이지 작성** - demo/examples/column-widths.html

---

## 대안 검토

### 대안 1: 모든 값을 픽셀로 정규화

- **장점**: 가상화 계산이 단순해짐
- **단점**: CSS 유연성 상실, 반응형 레이아웃 불가
- **결정**: 기각 - CSS 유연성이 더 중요

### 대안 2: CSS Grid 사용

- **장점**: 브라우저 네이티브 레이아웃
- **단점**: 기존 가상화 로직과 호환성 문제
- **결정**: 기각 - 현재 아키텍처 유지

---

## 관련 문서

- [Config API 재설계](./010-config-api-redesign.md)
- [가로 가상화](./002-horizontal-virtualization.md)
