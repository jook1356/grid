# 005: Multi-Row 레이아웃 전략

## 상태
**계획됨 (Planned)** - 2차 구현 예정

## 날짜
2026-01-17

## 배경

하나의 데이터 행을 여러 줄(visual rows)로 표시하는 기능이 필요합니다.
컬럼이 많거나, 특정 레이아웃이 필요한 경우 유용합니다.

### 일반 그리드 vs Multi-Row

```
일반 그리드 (1 data row = 1 visual row):
┌────┬─────────┬────────────┬───────────┬────────┬──────────┬──────────┐
│ ID │  Name   │   Email    │   Phone   │  Dept  │  Title   │  Salary  │
├────┼─────────┼────────────┼───────────┼────────┼──────────┼──────────┤
│  1 │  홍길동  │ hong@...   │ 010-1234  │  개발팀 │ 시니어    │ 5,000만  │
└────┴─────────┴────────────┴───────────┴────────┴──────────┴──────────┘

Multi-Row (1 data row = 2 visual rows):
┌────┬─────────┬────────────────────────────────────┬──────────┐
│ ID │  Name   │            Email                   │  Salary  │
│    ├─────────┼───────────┬────────────┬───────────┼──────────┤
│    │  Dept   │   Phone   │   Title    │  Address  │  Bonus   │
├────┼─────────┼───────────────────────────────────┼──────────┤
│  1 │  홍길동  │        hong@example.com            │ 5,000만  │
│    ├─────────┼───────────┬────────────┬───────────┼──────────┤
│    │  개발팀  │ 010-1234  │   시니어    │  서울시   │  500만   │
└────┴─────────┴───────────┴────────────┴───────────┴──────────┘
```

---

## 고려한 옵션

### 옵션 A: 컬럼 정의에 `row` 속성

```typescript
const columns = [
  { key: 'id',    row: 0, colSpan: 1 },
  { key: 'name',  row: 0, colSpan: 1 },
  { key: 'email', row: 0, colSpan: 2 },
  { key: 'salary',row: 0, colSpan: 1 },
  { key: 'dept',  row: 1, colSpan: 1 },
  { key: 'phone', row: 1, colSpan: 1 },
  { key: 'title', row: 1, colSpan: 1 },
  { key: 'addr',  row: 1, colSpan: 1 },
  { key: 'bonus', row: 1, colSpan: 1 },
];
```

**장점:** 간단, 한 곳에서 설정
**단점:** 복잡한 레이아웃 표현 제한

### 옵션 B: 별도 `rowTemplate` ✅ 채택

```typescript
const columns = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  // ...
];

const rowTemplate: RowTemplate = {
  rowCount: 2,
  layout: [
    [
      { key: 'id', colSpan: 1, rowSpan: 2 },
      { key: 'name', colSpan: 1 },
      { key: 'email', colSpan: 2 },
      { key: 'salary', colSpan: 1, rowSpan: 2 },
    ],
    [
      // id는 위에서 rowSpan으로 병합
      { key: 'dept', colSpan: 1 },
      { key: 'phone', colSpan: 1 },
      { key: 'title', colSpan: 1 },
      { key: 'addr', colSpan: 1 },
      // salary는 위에서 rowSpan으로 병합
    ],
  ],
};
```

**장점:** 
- 유연한 레이아웃 (rowSpan, colSpan 모두 지원)
- 컬럼 정의와 레이아웃 분리
- 복잡한 레이아웃 표현 가능

**단점:**
- 설정이 더 복잡
- 두 곳에서 관리 (columns + rowTemplate)

---

## 결정

**옵션 B (별도 rowTemplate)를 채택합니다.**

이유:
1. 더 유연한 레이아웃 지원 (rowSpan + colSpan)
2. 컬럼 정의는 데이터 구조, 레이아웃은 표시 방식으로 관심사 분리
3. 복잡한 레이아웃도 표현 가능
4. 셀 병합 기능과 자연스럽게 통합

---

## 구현 설계

### 인터페이스

```typescript
/**
 * Multi-Row 레이아웃 정의
 */
interface RowTemplate {
  /**
   * 하나의 데이터 행이 차지할 visual row 수
   */
  rowCount: number;
  
  /**
   * 각 visual row의 셀 배치
   * layout[0] = 첫 번째 줄, layout[1] = 두 번째 줄, ...
   */
  layout: RowLayoutItem[][];
}

/**
 * 레이아웃 내 셀 정의
 */
interface RowLayoutItem {
  /**
   * 컬럼 키 (columns에 정의된 key와 매핑)
   */
  key: string;
  
  /**
   * 가로로 차지할 칸 수
   * @default 1
   */
  colSpan?: number;
  
  /**
   * 세로로 차지할 줄 수 (Multi-Row 내에서)
   * @default 1
   */
  rowSpan?: number;
  
  /**
   * 너비 (픽셀 또는 비율)
   */
  width?: number | string;
}
```

### 사용 예시

#### 기본 사용 (rowTemplate 없음 = 일반 그리드)

```typescript
const sheet = new PureSheet(container, {
  columns: [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
  ],
  data,
});
// → 1 data row = 1 visual row
```

#### Multi-Row 사용

```typescript
const sheet = new PureSheet(container, {
  columns: [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    { key: 'dept', header: 'Department' },
    { key: 'title', header: 'Title' },
    { key: 'salary', header: 'Salary' },
    { key: 'bonus', header: 'Bonus' },
  ],
  rowTemplate: {
    rowCount: 2,
    layout: [
      // 첫 번째 줄
      [
        { key: 'id', rowSpan: 2 },      // 2줄에 걸침
        { key: 'name' },
        { key: 'email', colSpan: 2 },   // 2칸 차지
        { key: 'salary', rowSpan: 2 },  // 2줄에 걸침
      ],
      // 두 번째 줄
      [
        // id는 rowSpan으로 위에서 병합됨
        { key: 'dept' },
        { key: 'phone' },
        { key: 'title' },
        // salary는 rowSpan으로 위에서 병합됨
      ],
    ],
  },
  data,
});
```

#### 결과

```
┌────┬─────────┬────────────────────────┬──────────┐
│    │  Name   │         Email          │          │
│ ID ├─────────┼───────────┬────────────┤  Salary  │
│    │  Dept   │   Phone   │   Title    │          │
├────┼─────────┼───────────────────────┼──────────┤
│  1 │  홍길동  │     hong@example.com   │ 5,000만  │
│    ├─────────┼───────────┬────────────┤          │
│    │  개발팀  │ 010-1234  │   시니어    │          │
├────┼─────────┼───────────────────────┼──────────┤
│  2 │  김철수  │      kim@example.com   │ 3,500만  │
│    ├─────────┼───────────┬────────────┤          │
│    │  기획팀  │ 010-5678  │   주니어    │          │
└────┴─────────┴───────────┴────────────┴──────────┘
```

### API

```typescript
// rowTemplate 설정/변경
sheet.setRowTemplate(template: RowTemplate | null);

// rowTemplate 조회
const template = sheet.getRowTemplate();

// rowTemplate 해제 (일반 그리드로)
sheet.clearRowTemplate();
```

### 헤더 렌더링

Multi-Row일 때 헤더도 레이아웃에 맞게 렌더링:

```typescript
class HeaderRenderer {
  render(): void {
    if (this.rowTemplate) {
      // Multi-Row 헤더 (layout에 따라 여러 줄)
      this.renderMultiRowHeader();
    } else {
      // 일반 헤더 (한 줄)
      this.renderSingleRowHeader();
    }
  }
  
  private renderMultiRowHeader(): void {
    for (const row of this.rowTemplate.layout) {
      const headerRow = document.createElement('div');
      headerRow.className = 'ps-header-row';
      
      for (const item of row) {
        const column = this.getColumn(item.key);
        const cell = this.createHeaderCell(column, item);
        headerRow.appendChild(cell);
      }
      
      this.headerContainer.appendChild(headerRow);
    }
  }
}
```

### 가상화 통합

```typescript
class VirtualScroller {
  /**
   * Multi-Row일 때 visual row 높이 계산
   */
  private getDataRowHeight(): number {
    if (this.rowTemplate) {
      // rowTemplate.rowCount × 단일 행 높이
      return this.rowTemplate.rowCount * this.estimatedRowHeight;
    }
    return this.estimatedRowHeight;
  }
  
  /**
   * visual row index → data row index 변환
   */
  private toDataRowIndex(visualIndex: number): number {
    if (this.rowTemplate) {
      return Math.floor(visualIndex / this.rowTemplate.rowCount);
    }
    return visualIndex;
  }
}
```

---

## 셀 병합과의 관계

| 기능 | 범위 | 설명 |
|------|------|------|
| **Multi-Row rowSpan** | 하나의 데이터 행 내 | rowTemplate 내에서의 세로 병합 |
| **셀 병합 rowSpan** | 여러 데이터 행에 걸침 | 데이터 행을 넘어서는 세로 병합 |

```
Multi-Row rowSpan (rowTemplate 내):     셀 병합 rowSpan (데이터 행 넘어서):
┌────┬─────────┐                        ┌────┬─────────┐
│    │  Name   │ ← 데이터 행 1           │    │  사과   │ ← 데이터 행 1
│ ID ├─────────┤                        │과일├─────────┤
│    │  Dept   │                        │    │  바나나 │ ← 데이터 행 2
├────┼─────────┤                        │    ├─────────┤
│    │  Name   │ ← 데이터 행 2           │    │  오렌지 │ ← 데이터 행 3
│ ID ├─────────┤                        ├────┼─────────┤
│    │  Dept   │                        │채소│  당근   │ ← 데이터 행 4
└────┴─────────┘                        └────┴─────────┘
```

---

## 구현 순서

2차 구현에서 다른 고급 기능과 함께 구현:

1. 셀 병합
2. 행 그룹화
3. **Multi-Row 레이아웃**
4. 프레임워크 래퍼

---

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [셀 병합 및 행 그룹화 전략](./004-cell-merge-and-row-grouping.md)
