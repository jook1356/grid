# 019: 유연한 컬럼 너비 처리 구현

## 상태
**구현 완료** (2026-01-27)

## 컨텍스트

018 문서에서 제안된 컬럼 너비 개선을 실제로 구현합니다.

### 현재 문제점

1. **configAdapter에서 숫자로 강제 변환**: `width`를 항상 픽셀 숫자로 파싱
2. **CSS 단위 미지원**: `'15%'`, `'20rem'`, `'auto'` 등 CSS 단위 문자열 사용 불가
3. **일관성 부족**: width 처리가 여러 곳에 분산됨

---

## 결정

### 핵심 전략: "헤더가 기준이 된다"

1. **헤더 셀에만 인라인 스타일로 width/minWidth/maxWidth 적용**
2. **렌더링 후 헤더의 clientWidth를 측정**
3. **측정값을 CSS 변수(`--col-컬럼명-width`)에 설정**
4. **모든 셀(헤더/데이터)이 CSS 변수를 참조하여 동기화**

### 1. 타입 정의 변경

```typescript
// FieldDef, ColumnDef
width?: number | string;     // 150, '150px', '15%', '20rem', 'auto'
minWidth?: number | string;
maxWidth?: number | string;
```

### 2. configAdapter 변경

숫자 변환 로직을 제거하고 값을 그대로 전달:

```typescript
// Before
width: width ?? 150  // 항상 숫자로 변환

// After
width: field.width   // undefined면 기본값은 렌더링에서 처리
minWidth: field.minWidth
maxWidth: field.maxWidth
```

### 3. 값 변환 유틸리티

```typescript
// 숫자면 px 붙이고, 문자열이면 그대로
function toCSSValue(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}
```

### 4. 렌더링 흐름

```
[초기 렌더링]
1. HeaderCell 생성 시 인라인 스타일 적용:
   - style.width = toCSSValue(width) ?? '150px'  (기본값)
   - style.minWidth = toCSSValue(minWidth)
   - style.maxWidth = toCSSValue(maxWidth)

2. requestAnimationFrame 후:
   - 각 헤더 셀의 clientWidth 측정
   - CSS 변수 설정: --col-컬럼명-width: ${clientWidth}px

3. CSS 변수 적용:
   - 헤더 셀: width: var(--col-컬럼명-width, 기본값)
   - 데이터 셀: width: var(--col-컬럼명-width, 기본값)

[리사이즈 시]
- 기존 로직 유지: setColumnWidth()가 CSS 변수 업데이트
```

### 5. 장점

1. **다양한 CSS 단위 지원**: px, rem, em, %, auto 등
2. **CSS의 자연스러운 동작**: minWidth/maxWidth 제약 자동 적용
3. **헤더-데이터 셀 동기화**: 헤더 기준으로 모든 셀 너비 일치
4. **코드 단순화**: configAdapter의 변환 로직 제거

---

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/field.types.ts` | width/minWidth/maxWidth 타입을 `number \| string`으로 확장 |
| `src/types/data.types.ts` | ColumnDef의 width/minWidth/maxWidth 타입 확장 |
| `src/ui/utils/configAdapter.ts` | width 숫자 변환 로직 제거, 값 그대로 전달 |
| `src/ui/utils/cssUtils.ts` | `toCSSValue()` 유틸리티 함수 추가 |
| `src/ui/header/HeaderCell.ts` | 인라인 스타일로 width/minWidth/maxWidth 적용 |
| `src/ui/GridRenderer.ts` | 렌더링 후 clientWidth 측정하여 CSS 변수 설정 |

---

## 사용 예시

```typescript
const grid = new PureSheet(container, {
  fields: [
    // 고정 픽셀 (숫자)
    { key: 'id', header: 'ID', dataType: 'number', width: 60 },

    // 고정 픽셀 (문자열)
    { key: 'name', header: '이름', dataType: 'string', width: '150px' },

    // 상대 단위
    { key: 'email', header: '이메일', dataType: 'string', width: '20rem' },

    // 퍼센트
    { key: 'ratio', header: '비율', dataType: 'string', width: '15%' },

    // auto (내용에 맞춤)
    { key: 'status', header: '상태', dataType: 'string', width: 'auto' },

    // min/max 제약
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

---

## 관련 문서

- [018: 컬럼 너비 및 Flex 기능 개선 (제안)](./018-column-width-and-flex.md)
- [Config API 재설계](./010-config-api-redesign.md)
