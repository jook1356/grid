# 15회차: Config API 재설계 - 플랫 구조

## 개요

PureSheet의 초기화 옵션 구조를 재설계했습니다. 기존 `columns` 기반 API를 `fields` 기반의 플랫한 구조로 변경하고, 피벗 그리드와 일반 그리드를 명시적인 모드(`flat` | `pivot`)로 구분하도록 개선했습니다.

### 주요 변경점

| 항목 | Before | After |
|------|--------|-------|
| 컬럼 정의 | `columns: ColumnDef[]` | `fields: FieldDef[]` |
| 컬럼 배치 | 암시적 (columns 순서) | `columns: string[]` 명시 |
| 헤더 라벨 | `label` | `header` |
| 데이터 타입 | `type` | `dataType` |
| 행 높이 | `rowHeight: number` | `rowStyle: string` 또는 `rowHeight: number` |
| 헤더 높이 | `headerHeight: number` | `headerStyle: string` 또는 `headerHeight: number` |
| 그룹핑 | `groupingConfig` | `group` |
| 피벗 | 미지원 | `mode: 'pivot'` + 축 설정 |

---

## 구현 내용

### 1. 새로운 타입 정의 (`src/types/field.types.ts`)

Config API의 핵심 타입들을 정의합니다.

#### 기본 타입

```typescript
// 데이터 타입
type DataType = 'string' | 'number' | 'boolean' | 'date';

// 집계 함수
type AggregateFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

// 선택 모드
type SelectionMode = 'none' | 'cell' | 'row' | 'range' | 'all';

// 테마
type Theme = 'light' | 'dark' | 'auto';

// 그리드 모드
type GridMode = 'flat' | 'pivot';
```

#### FieldDef (필드 정의)

```typescript
interface FieldDef {
  key: string;           // 필드 키 (데이터 객체의 키와 매칭)
  header: string;        // 헤더에 표시할 이름
  dataType: DataType;    // 데이터 타입
  aggregate?: AggregateFunc;  // 집계 함수
  style?: string;        // CSS 스타일
  width?: number;        // 너비 (픽셀)
  minWidth?: number;     // 최소 너비
  maxWidth?: number;     // 최대 너비
  sortable?: boolean;    // 정렬 가능 여부
  filterable?: boolean;  // 필터 가능 여부
  editable?: boolean;    // 편집 가능 여부
  hidden?: boolean;      // 숨김 여부
  formatter?: (value: unknown) => string;  // 셀 값 포맷터
}
```

#### PureSheetConfig

```typescript
// 공통 설정
interface PureSheetConfigBase {
  data?: Row[];
  fields: FieldDef[];
  theme?: Theme;
  rowStyle?: string;
  rowHeight?: number;
  headerStyle?: string;
  headerHeight?: number;
  resizableColumns?: boolean;
  reorderableColumns?: boolean;
  selectionMode?: SelectionMode;
  multiSelect?: boolean;
  editable?: boolean;
  showCheckboxColumn?: boolean;
}

// Flat 모드 설정
interface FlatModeConfig extends PureSheetConfigBase {
  mode?: 'flat';
  columns?: string[];
  pinned?: PinnedConfig;
  group?: GroupConfig;
  rowTemplate?: RowTemplate;
}

// Pivot 모드 설정
interface PivotModeConfig extends PureSheetConfigBase {
  mode: 'pivot';
  rowFields?: string[];
  columnFields: string[];
  valueFields: string[];
}

// 통합 타입
type PureSheetConfig = FlatModeConfig | PivotModeConfig;
```

#### 타입 가드 함수

```typescript
function isFlatMode(config: PureSheetConfig): config is FlatModeConfig {
  return config.mode === undefined || config.mode === 'flat';
}

function isPivotMode(config: PureSheetConfig): config is PivotModeConfig {
  return config.mode === 'pivot';
}
```

### 2. Config Adapter (`src/ui/utils/configAdapter.ts`)

새로운 `PureSheetConfig`를 내부에서 사용하는 형식으로 변환합니다.

#### InternalOptions

```typescript
interface InternalOptions {
  columns: ColumnDef[];
  data?: Record<string, unknown>[];
  rowHeight: number;
  headerHeight: number;
  selectionMode: 'none' | 'row' | 'range' | 'all';
  multiSelect: boolean;
  showCheckboxColumn: boolean;
  editable: boolean;
  resizableColumns: boolean;
  reorderableColumns: boolean;
  theme: 'light' | 'dark' | 'auto';
  groupingConfig?: GroupingConfig;
  rowTemplate?: RowTemplate;
}
```

#### 변환 함수

- `fieldToColumn()`: `FieldDef` → `ColumnDef` 변환
  - `style` 속성에서 `width` 파싱 (예: `width: 200px;` → `200`)
  
- `configToInternalOptions()`: `PureSheetConfig` → `InternalOptions` 변환
  - Flat 모드: `columns` 배열 순서대로 컬럼 재정렬
  - `pinned` 설정을 컬럼의 `frozen` 속성으로 변환
  - `group` 설정을 `groupingConfig`로 변환

- `getGridMode()`: 설정에서 그리드 모드 추출

- `getPivotConfig()`: Pivot 모드 설정을 내부 `PivotConfig`로 변환

### 3. PureSheet 업데이트 (`src/ui/PureSheet.ts`)

#### 새로운 속성

```typescript
class PureSheet {
  private gridMode: 'flat' | 'pivot';
  private originalConfig: PureSheetConfig;
  private pivotProcessor: PivotProcessor | null = null;
  private pivotConfig: PivotConfig | null = null;
  private pivotResult: PivotResult | null = null;
}
```

#### 새로운 API

```typescript
// 그리드 모드 관련
getMode(): 'flat' | 'pivot';
setMode(mode: 'flat' | 'pivot'): Promise<void>;

// 필드 정의 조회
getFields(): FieldDef[] | null;

// 피벗 설정
setPivotConfig(config: PivotConfig): Promise<void>;
getPivotConfig(): PivotConfig | null;
getPivotResult(): PivotResult | null;
```

### 4. GridRenderer 업데이트 (`src/ui/GridRenderer.ts`)

- `InternalOptions` 타입 사용
- 피벗/플랫 헤더 전환 메서드:
  - `switchToPivotHeader(pivotResult)`: `HeaderRenderer` → `PivotHeaderRenderer`
  - `switchToFlatHeader()`: `PivotHeaderRenderer` → `HeaderRenderer`
- `getHeaderMode()`: 현재 헤더 모드 반환

### 5. Types 모듈 업데이트 (`src/types/index.ts`)

새로운 타입들을 export:

```typescript
export type {
  DataType,
  AggregateFunc,
  SelectionMode,
  Theme,
  GridMode,
  FieldDef,
  GroupConfig,
  PinnedConfig,
  PureSheetConfigBase,
  FlatModeConfig,
  PivotModeConfig,
  PureSheetConfig,
  RowTemplateCell,
  RowTemplate as FieldRowTemplate,
} from './field.types';

export { isFlatMode, isPivotMode } from './field.types';
```

---

## 사용 예시

### Flat 모드 (일반 그리드)

```typescript
const grid = new PureSheet(container, {
  mode: 'flat',  // 기본값이므로 생략 가능
  fields: [
    { key: 'month', header: '월', dataType: 'string', style: 'width: 200px;' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum' },
    { key: 'profit', header: '수익', dataType: 'number', aggregate: 'sum' },
  ],
  data: [...],
  columns: ['month', 'sales', 'profit'],
  pinned: {
    left: ['month'],
  },
  group: {
    columns: ['month'],
    subtotals: ['sales', 'profit'],
  },
  theme: 'light',
  rowHeight: 36,
});
```

### Pivot 모드 (피벗 그리드)

```typescript
const pivotGrid = new PureSheet(container, {
  mode: 'pivot',
  fields: [
    { key: 'month', header: '월', dataType: 'string' },
    { key: 'product', header: '제품', dataType: 'string' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum' },
  ],
  data: [...],
  rowFields: ['product'],
  columnFields: ['month'],
  valueFields: ['sales'],
});
```

### 런타임 모드 전환

```typescript
const grid = new PureSheet(container, flatConfig);

// 피벗 모드로 전환
await grid.setMode('pivot');
await grid.setPivotConfig({
  rowFields: ['product'],
  columnFields: ['month'],
  valueFields: [{ field: 'sales', aggregate: 'sum', header: '매출' }],
});

// 다시 플랫 모드로
await grid.setMode('flat');
```

---

## 생성/수정된 파일

### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/types/field.types.ts` | 새로운 Config API 타입 정의 |
| `src/ui/utils/configAdapter.ts` | Config 변환 어댑터 |

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/index.ts` | 새 타입 export 추가 |
| `src/ui/PureSheet.ts` | PureSheetConfig 지원, 피벗 모드 API 추가 |
| `src/ui/GridRenderer.ts` | InternalOptions 사용, 피벗 헤더 전환 |
| `src/ui/header/index.ts` | SortState re-export 정리 |
| `src/ui/style/default.css` | 셀 선택 스타일 변수 추가 |

---

## 핵심 설계 결정

### 1. 플랫한 구조

깊은 중첩 대신 최상위 레벨에 설정을 배치:

```typescript
// ❌ 기존 (중첩)
{
  groupingConfig: { columns: ['a'], showSubtotals: true }
}

// ✅ 새 구조 (플랫)
{
  group: { columns: ['a'], subtotals: ['b'] }
}
```

### 2. 필드/컬럼 분리

- `fields`: 데이터 메타데이터 정의 (타입, 집계 함수 등)
- `columns`: 표시할 컬럼 순서 (fields의 key 참조)

이 분리로 같은 필드를 여러 위치에 표시하거나, 특정 필드만 숨기는 것이 쉬워졌습니다.

### 3. 명시적 모드 분기

`mode: 'flat' | 'pivot'`으로 그리드 유형을 명시적으로 지정:

- **Flat 모드**: 일반 그리드, 그룹핑, Multi-Row 지원
- **Pivot 모드**: 피벗 테이블, 행/열/값 축 설정

### 4. AG Grid 스타일 API

검증된 API 패턴을 참조하여 친숙한 사용 경험 제공:

- `pinned.left`, `pinned.right` 컬럼 고정
- `selectionMode`: 'none' | 'cell' | 'row' | 'range'
- `resizableColumns`, `reorderableColumns` 옵션

---

## 관련 문서

- [설계 결정: Config API 재설계](../decisions/010-config-api-redesign.md)
- [피벗 그리드 아키텍처](../decisions/008-pivot-grid-architecture.md)

---

## 다음 회차 예고

- 런타임 설정 변경 API 확장
- 필터 UI 컴포넌트
- 컨텍스트 메뉴 지원
