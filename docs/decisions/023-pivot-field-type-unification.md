# 023. 피벗 필드 타입 통일 및 일반/피벗 모드 분리

## 상태
- **제안됨**: 2026-01-28
- **상태**: 계획 수립

## 배경

현재 피벗 설정에서 `valueFields`는 `(PivotValueField | string)[]` 타입을 사용하고 있어,
코드 전반에 걸쳐 `typeof vf === 'string'` 체크가 필요합니다. 이로 인해:

1. 타입 안전성 저하
2. 코드 복잡도 증가
3. 일관성 없는 API

또한 피벗 모드에서 `fields` 설정과 `rowFields/columnFields/valueFields` 설정이 중복되어 혼란을 야기합니다.

## 결정

### 1. 모드별 필드 설정 완전 분리

| 모드 | 필드 설정 |
|------|----------|
| 일반 (flat) | `fields: FieldDef[]` |
| 피벗 (pivot) | `rowFields`, `columnFields`, `valueFields` (객체 배열) |

피벗 모드에서는 `fields` 설정을 참조하지 않습니다.

### 2. 피벗 필드 타입 정의

```typescript
/**
 * 피벗 필드 기본 인터페이스
 */
interface PivotFieldBase {
  /** 필드 키 (데이터 객체의 키와 매칭) */
  field: string;

  /** 헤더에 표시할 이름 (미지정 시 field 사용) */
  header?: string;
}

/**
 * 행 축 필드 (rowFields)
 */
interface PivotRowField extends PivotFieldBase {
  /** 정렬 방향 */
  sort?: 'asc' | 'desc';
}

/**
 * 열 축 필드 (columnFields)
 */
interface PivotColumnField extends PivotFieldBase {
  /** 정렬 방향 */
  sort?: 'asc' | 'desc';
}

/**
 * 값 필드 (valueFields)
 */
interface PivotValueField extends PivotFieldBase {
  /** 집계 함수 (필수) */
  aggregate: AggregateFunc;

  /** 값 포맷터 */
  formatter?: (value: CellValue) => string;
}
```

### 3. PivotConfig 변경

**Before:**
```typescript
interface PivotConfig {
  rowFields: string[];
  columnFields: string[];
  valueFields: (PivotValueField | string)[];
  // ...
}
```

**After:**
```typescript
interface PivotConfig {
  rowFields: PivotRowField[];
  columnFields: PivotColumnField[];
  valueFields: PivotValueField[];
  // ...
}
```

### 4. PivotModeConfig 변경

**Before:**
```typescript
interface PivotModeConfig extends PureSheetConfigBase {
  mode: 'pivot';
  rowFields?: string[];
  columnFields: string[];
  valueFields: string[];
}
```

**After:**
```typescript
interface PivotModeConfig extends Omit<PureSheetConfigBase, 'fields'> {
  mode: 'pivot';
  rowFields: PivotRowField[];
  columnFields: PivotColumnField[];
  valueFields: PivotValueField[];
}
```

- `fields` 속성 제거 (Omit 사용)
- 모든 필드가 객체 배열로 통일

## 구현 계획

### Phase 1: 타입 정의 변경
1. `src/types/pivot.types.ts`
   - `PivotFieldBase`, `PivotRowField`, `PivotColumnField` 인터페이스 추가
   - `PivotValueField`에서 `aggregate` 필수로 변경
   - `PivotConfig`에서 모든 필드를 객체 배열로 변경
   - `NormalizedPivotConfig` 제거 (더 이상 필요 없음)

2. `src/types/field.types.ts`
   - `PivotModeConfig`에서 `fields` 제거
   - 필드 타입을 객체 배열로 변경

### Phase 2: 엔진 코드 수정
1. `src/processor/PivotProcessor.ts`
   - `typeof vf === 'string'` 체크 모두 제거
   - 직접 `vf.field`, `vf.aggregate` 접근

2. `src/processor/engines/ArqueroEngine.ts`
   - 동일한 패턴 제거

3. `src/processor/engines/DuckDBEngine.ts`
   - 동일한 패턴 제거

### Phase 3: UI 코드 수정
1. `src/ui/PureSheet.ts`
   - 피벗 모드에서 `fields` 대신 피벗 필드 설정 직접 사용
   - `typeof vf === 'string'` 체크 제거

2. `src/ui/utils/configAdapter.ts`
   - 필요시 피벗 설정 변환 로직 수정

### Phase 4: 테스트 및 정리
1. 타입 체크 실행 및 에러 수정
2. 기존 테스트 업데이트
3. 사용하지 않는 코드 제거

## 영향 범위

### 수정 대상 파일
- `src/types/pivot.types.ts`
- `src/types/field.types.ts`
- `src/processor/PivotProcessor.ts`
- `src/processor/engines/ArqueroEngine.ts`
- `src/processor/engines/DuckDBEngine.ts`
- `src/processor/processorWorker.ts`
- `src/ui/PureSheet.ts`
- `src/ui/utils/configAdapter.ts`

### API 변경 (Breaking Change)
- 피벗 모드 사용 시 `rowFields`, `columnFields`, `valueFields`를 객체 배열로 전달해야 함
- 피벗 모드에서 `fields` 설정은 무시됨

## 마이그레이션 예시

**Before:**
```typescript
const config: PureSheetConfig = {
  mode: 'pivot',
  fields: [
    { key: 'category', header: '카테고리', dataType: 'string' },
    { key: 'product', header: '제품', dataType: 'string' },
    { key: 'year', header: '연도', dataType: 'string' },
    { key: 'sales', header: '매출', dataType: 'number', aggregate: 'sum' },
  ],
  rowFields: ['category', 'product'],
  columnFields: ['year'],
  valueFields: ['sales'],
};
```

**After:**
```typescript
const config: PureSheetConfig = {
  mode: 'pivot',
  rowFields: [
    { field: 'category', header: '카테고리' },
    { field: 'product', header: '제품' },
  ],
  columnFields: [
    { field: 'year', header: '연도' },
  ],
  valueFields: [
    { field: 'sales', header: '매출', aggregate: 'sum' },
  ],
};
```

## 이점

1. **타입 안전성**: `string | object` 유니온 타입 제거로 타입 체크 강화
2. **코드 단순화**: `typeof vf === 'string'` 체크 코드 전면 제거
3. **명확한 책임 분리**: 일반 모드와 피벗 모드의 설정이 완전히 분리
4. **일관된 API**: 모든 피벗 필드가 동일한 패턴으로 정의
5. **확장성**: 각 필드 타입에 독립적인 옵션 추가 가능

## 참고

- [008-pivot-grid-architecture.md](./008-pivot-grid-architecture.md) - 피벗 그리드 아키텍처
- [010-config-api-redesign.md](./010-config-api-redesign.md) - Config API 설계
- [017-pivot-subtotals-grandtotals.md](./017-pivot-subtotals-grandtotals.md) - 피벗 소계/총합계
