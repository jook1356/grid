# 010: Config API 재설계 - 플랫 구조

## 상태
**승인됨** (2026-01-21)

## 컨텍스트

PureSheet의 초기화 옵션 구조를 재설계합니다. 기존 구조에서 피벗 그리드 지원을 추가하면서, API를 더 직관적이고 사용하기 쉽게 개선합니다.

### 설계 원칙

1. **플랫한 구조**: 깊은 중첩 대신 플랫하게
2. **AG Grid 스타일**: 검증된 API 패턴 참조
3. **모드 기반 분기**: `mode: 'flat' | 'pivot'`으로 명시적 구분
4. **필드 정의 분리**: `fields`에서 메타데이터 정의, 레이아웃에서 참조

---

## 최종 구조

### Flat 모드 (일반 그리드)

```typescript
const grid = new PureSheet(container, {
  // 모드 (기본값: 'flat')
  mode: 'flat',
  
  // 데이터
  data: [
    { month: '1월', sales: 100, profit: 30, cost: 70 },
    { month: '2월', sales: 150, profit: 50, cost: 100 },
  ],
  
  // 필드 정의 (메타데이터)
  fields: [
    { key: 'month', header: '월', dataType: 'string', style: 'width: 200px;' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum', style: 'width: 150px;' },
    { key: 'profit', header: '수익', dataType: 'number', aggregate: 'sum', style: 'flex: 1;' },
    { key: 'cost', header: '비용', dataType: 'number', aggregate: 'sum', style: 'width: 150px;' },
  ],
  
  // 컬럼 배치 (fields의 key 참조)
  columns: ['month', 'sales', 'profit', 'cost'],
  
  // 컬럼 고정
  pinned: {
    left: ['month'],
    right: [],
  },
  
  // 그룹핑
  group: {
    columns: ['month'],
    subtotals: ['sales', 'profit'],
  },
  
  // UI 옵션
  theme: 'light',
  rowStyle: 'height: 36px;',
  headerStyle: 'height: 48px;',
  resizableColumns: true,
  reorderableColumns: true,
  selectionMode: 'row',
  multiSelect: true,
  editable: false,
});
```

### Pivot 모드 (피벗 그리드)

```typescript
const pivotGrid = new PureSheet(container, {
  // 모드
  mode: 'pivot',
  
  // 데이터
  data: [
    { month: '1월', product: 'A', sales: 100, profit: 30 },
    { month: '1월', product: 'B', sales: 150, profit: 50 },
    { month: '2월', product: 'A', sales: 200, profit: 60 },
  ],
  
  // 필드 정의
  fields: [
    { key: 'month', header: '월', dataType: 'string' },
    { key: 'product', header: '제품', dataType: 'string' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum' },
    { key: 'profit', header: '수익', dataType: 'number', aggregate: 'sum' },
  ],
  
  // 피벗 축 설정
  rowFields: ['product'],           // 행 축
  columnFields: ['month'],          // 열 축 (피벗되는 필드)
  valueFields: ['sales', 'profit'], // 값 필드
  
  // UI 옵션 (공통)
  theme: 'light',
  rowStyle: 'height: 36px;',
  resizableColumns: true,
});
```

---

## 타입 정의

```typescript
// 데이터 타입
type DataType = 'string' | 'number' | 'boolean' | 'date';

// 집계 함수
type AggregateFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

// 필드 정의
interface FieldDef {
  /** 필드 키 (데이터 객체의 키와 매칭) */
  key: string;
  
  /** 헤더에 표시할 이름 */
  header: string;
  
  /** 데이터 타입 */
  dataType: DataType;
  
  /** 집계 함수 (그룹핑/피벗 시 사용) */
  aggregate?: AggregateFunc;
  
  /** 스타일 (CSS 문자열) */
  style?: string;
  
  /** 정렬 가능 여부 */
  sortable?: boolean;
  
  /** 필터 가능 여부 */
  filterable?: boolean;
  
  /** 편집 가능 여부 */
  editable?: boolean;
}

// 선택 모드
type SelectionMode = 'none' | 'cell' | 'row' | 'range';

// 테마
type Theme = 'light' | 'dark' | 'auto';

// PureSheet 설정
interface PureSheetConfig {
  // === 공통 ===
  /** 그리드 모드 @default 'flat' */
  mode?: 'flat' | 'pivot';
  
  /** 데이터 */
  data?: Row[];
  
  /** 필드 정의 */
  fields: FieldDef[];
  
  // === UI 옵션 (공통) ===
  /** 테마 @default 'light' */
  theme?: Theme;
  
  /** 행 스타일 */
  rowStyle?: string;
  
  /** 헤더 스타일 */
  headerStyle?: string;
  
  /** 컬럼 리사이즈 가능 @default true */
  resizableColumns?: boolean;
  
  /** 컬럼 재정렬 가능 @default true */
  reorderableColumns?: boolean;
  
  /** 선택 모드 @default 'row' */
  selectionMode?: SelectionMode;
  
  /** 다중 선택 @default true */
  multiSelect?: boolean;
  
  /** 편집 가능 @default false */
  editable?: boolean;
  
  // === Flat 모드 전용 ===
  /** 표시할 컬럼 목록 (fields의 key 참조) */
  columns?: string[];
  
  /** 고정 컬럼 */
  pinned?: {
    left?: string[];
    right?: string[];
  };
  
  /** 그룹핑 설정 */
  group?: {
    /** 그룹핑 기준 컬럼 */
    columns: string[];
    /** 소계 표시할 컬럼 (fields의 aggregate 함수 사용) */
    subtotals?: string[];
  };
  
  // === Pivot 모드 전용 ===
  /** 행 축 필드 */
  rowFields?: string[];
  
  /** 열 축 필드 (피벗되는 필드) */
  columnFields?: string[];
  
  /** 값 필드 */
  valueFields?: string[];
}
```

---

## 기존 구조와의 비교

### Before (기존)

```typescript
new PureSheet(container, {
  columns: [
    { key: 'month', type: 'string', label: '월', width: 200 },
    { key: 'sales', type: 'number', label: '매출', width: 150 },
  ],
  data: [...],
  rowHeight: 36,
  headerHeight: 40,
  theme: 'light',
  groupingConfig: {
    columns: ['month'],
    showSubtotals: true,
  },
});
```

### After (새로운 구조)

```typescript
new PureSheet(container, {
  mode: 'flat',
  fields: [
    { key: 'month', header: '월', dataType: 'string', style: 'width: 200px;' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum', style: 'width: 150px;' },
  ],
  data: [...],
  columns: ['month', 'sales'],
  rowStyle: 'height: 36px;',
  headerStyle: 'height: 40px;',
  theme: 'light',
  group: {
    columns: ['month'],
    subtotals: ['sales'],
  },
});
```

---

## 변경점 요약

| 항목 | Before | After |
|------|--------|-------|
| 컬럼 정의 | `columns: ColumnDef[]` | `fields: FieldDef[]` |
| 컬럼 배치 | 암시적 (columns 순서) | `columns: string[]` 명시 |
| 헤더 라벨 | `label` | `header` |
| 데이터 타입 | `type` | `dataType` |
| 행 높이 | `rowHeight: number` | `rowStyle: string` |
| 헤더 높이 | `headerHeight: number` | `headerStyle: string` |
| 그룹핑 | `groupingConfig` | `group` |
| 피벗 | 미지원 | `mode: 'pivot'` + 축 설정 |

---

## 동적 API

설정은 초기화 후에도 동적으로 변경 가능합니다:

```typescript
const grid = new PureSheet(container, config);

// 정렬
await grid.sort([{ columnKey: 'sales', direction: 'desc' }]);

// 필터
await grid.filter([{ columnKey: 'month', operator: 'eq', value: '1월' }]);

// 컬럼 고정 변경
grid.pinColumn('profit', 'left');
grid.unpinColumn('month');

// 컬럼 순서 변경
grid.reorderColumn('sales', 0);

// 그룹핑 변경
grid.setGrouping({ columns: ['product'], subtotals: ['sales'] });

// 모드 전환 (런타임)
grid.setMode('pivot');
grid.setPivotConfig({
  rowFields: ['product'],
  columnFields: ['month'],
  valueFields: ['sales'],
});

// 테마 변경
grid.setTheme('dark');
```

---

## 마이그레이션 가이드

### 기존 코드

```typescript
const grid = new PureSheet(container, {
  columns: [
    { key: 'name', type: 'string', label: '이름', width: 200 },
    { key: 'age', type: 'number', label: '나이' },
  ],
  data: myData,
  rowHeight: 36,
});
```

### 새로운 코드

```typescript
const grid = new PureSheet(container, {
  mode: 'flat',  // 명시적 모드 (선택)
  fields: [
    { key: 'name', header: '이름', dataType: 'string', style: 'width: 200px;' },
    { key: 'age', header: '나이', dataType: 'number' },
  ],
  data: myData,
  columns: ['name', 'age'],
  rowStyle: 'height: 36px;',
});
```

### 변환 규칙

1. `columns` → `fields` (이름 변경)
2. `label` → `header`
3. `type` → `dataType`
4. `width: 200` → `style: 'width: 200px;'`
5. `rowHeight: 36` → `rowStyle: 'height: 36px;'`
6. 컬럼 순서는 `columns: [...]`로 명시

---

## 관련 문서

- [피벗 그리드 아키텍처](./008-pivot-grid-architecture.md)
- [Worker 제거 결정](./009-remove-worker-architecture.md)
- [UI 아키텍처](../base/ARCHITECTURE-UI.md)

