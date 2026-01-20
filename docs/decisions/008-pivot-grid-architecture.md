# 008. 피봇 그리드 아키텍처 및 ViewDataManager 도입

## 1. 배경 및 동기

### 현재 상태

현재 그리드는 일반 테이블 형태만 지원합니다:
- `DataStore`: 원본 데이터 저장
- `IndexManager`: 정렬/필터 결과 인덱스 저장
- `GroupManager`: 그룹 헤더 포함 VirtualRow[] 생성
- `BodyRenderer.virtualRows`: DOM 렌더링에 사용되는 최종 데이터

### 문제점

1. **피봇 지원 불가** - 데이터 구조 변환(행↔열) 기능 없음
2. **단일 접근점 부재** - 일반/피봇 모드에 따라 데이터 흐름이 달라질 예정
3. **Row 클래스 혼합 책임** - Row가 데이터와 렌더링을 모두 담당
4. **고정 정보 분산** - 컬럼/행 고정 정보가 여러 곳에 흩어져 있음

### 목표

1. **피봇 그리드 지원** - 데이터 피봇팅 및 동적 컬럼 생성
2. **ViewDataManager** - DOM 렌더링을 위한 단일 접근점
3. **파이프라인 아키텍처** - 유연한 데이터 변환 체인
4. **통합 모델** - 일반 그리드를 피봇이 없는 특수 케이스로 취급
5. **Row 리팩토링** - 데이터/렌더링 분리

---

## 2. 핵심 설계 결정

### 2.1 ViewDataManager - 뷰 설정 관리자

ViewDataManager는 **"데이터 저장소"가 아니라 "뷰 설정 관리자"**입니다.
모든 데이터를 저장하는 게 아니라, 뷰 설정을 관리하고 필요한 데이터를 **조합하여 제공**합니다.

```
[일반 모드]
DataStore (원본) → IndexManager (인덱스) → ViewDataManager (조합) → BodyRenderer
                                               ↑
                                          GroupManager 로직 사용

[피봇 모드]  
DataStore → ArqueroProcessor(피봇) → ViewDataManager (피봇 결과 저장) → BodyRenderer
```

#### 핵심 개념: 필터/정렬 vs 피봇의 결과 차이

```
[필터/정렬 결과]
- 반환: Uint32Array (인덱스만!)
- Row 데이터: DataStore에 원본 유지
- 렌더링 시: indices로 DataStore 참조
- 새 데이터 생성: ❌

예시:
  원본: [A, B, C, D, E]
  필터/정렬 결과: [2, 0, 4, 1, 3]  ← 인덱스만
  렌더링: DataStore[2]=C, DataStore[0]=A, ...


[피봇 결과]
- 반환: 완전히 새로운 Row[] + ColumnDef[]
- Row 데이터: DataStore에 없음! (구조 자체가 다름)
- 렌더링 시: 피봇 결과 직접 사용
- 새 데이터 생성: ✅

예시:
  원본: | dept | year | quarter | sales |
        | A    | 2023 | Q1      | 100   |
        | A    | 2023 | Q2      | 150   |
  
  피봇 결과: | dept | 2023_Q1 | 2023_Q2 |  ← 구조 변환!
            | A    | 100     | 150     |
```

#### 저장하는 것 vs 저장하지 않는 것

| 항목 | 저장 | 이유 |
|------|------|------|
| `mode` | ✅ | 뷰 모드 상태 |
| `pinnedLeftColumnKeys` | ✅ | 사용자 설정, 경량 |
| `pinnedRightColumnKeys` | ✅ | 사용자 설정, 경량 |
| `pinnedTopRowIds` | ✅ | 사용자 설정, 경량 |
| `pinnedBottomRowIds` | ✅ | 사용자 설정, 경량 |
| `pivotedData` | ✅ (피봇 모드만) | DataStore에 없는 새 데이터 |
| `pivotedColumns` | ✅ (피봇 모드만) | 동적 생성된 컬럼 |
| **scrollableRows** | ❌ | DataStore + IndexManager에서 참조 |
| **scrollableColumns** | ❌ | 원본 columns - pinned로 계산 |

#### ViewDataManager 인터페이스

```typescript
class ViewDataManager {
  // ===== 저장: 뷰 설정 =====
  private mode: 'normal' | 'pivot' = 'normal';
  private pinnedLeftColumnKeys: string[] = [];
  private pinnedRightColumnKeys: string[] = [];
  private pinnedTopRowIds: (string | number)[] = [];
  private pinnedBottomRowIds: (string | number)[] = [];
  
  // ===== 저장: 피봇 결과 (피봇 모드만) =====
  private pivotedData: Row[] | null = null;
  private pivotedColumns: ColumnDef[] | null = null;
  
  // ===== 참조: 기존 모듈 (저장 X) =====
  constructor(
    private gridCore: GridCore,      // DataStore + IndexManager 접근
    private groupManager: GroupManager
  ) {}
  
  // ===== API =====
  getMode(): 'normal' | 'pivot';
  getPinnedLeftColumnKeys(): string[];
  getPinnedRightColumnKeys(): string[];
  getPinnedTopRowIds(): (string | number)[];
  getPinnedBottomRowIds(): (string | number)[];
  
  // 피봇 결과 (피봇 모드에서만 유효)
  getPivotedData(): Row[] | null;
  getPivotedColumns(): ColumnDef[] | null;
  
  // 피봇 모드 설정 시 자동으로 rowFields를 좌측 고정
  setMode(mode: 'pivot', config: PivotConfig): void {
    this.mode = mode;
    this.pinnedLeftColumnKeys = config.rowFields;
  }
}
```

#### BodyRenderer에서의 사용

```typescript
class BodyRenderer {
  private getScrollableRows(): VirtualRow[] {
    const mode = this.viewDataManager.getMode();
    
    if (mode === 'pivot') {
      // 피봇 모드: ViewDataManager에서 피봇 결과 사용
      const pivotedData = this.viewDataManager.getPivotedData()!;
      return this.convertToVirtualRows(pivotedData);
    } else {
      // 일반 모드: 기존 흐름 (GridCore → DataStore + IndexManager)
      // scrollableRows를 저장하지 않고 기존 모듈 활용
      const data = this.gridCore.getAllData();
      return this.groupManager.flattenWithGroups(data);
    }
  }
  
  private getColumnLayout(): ColumnLayout {
    const mode = this.viewDataManager.getMode();
    const allColumns = mode === 'pivot'
      ? this.viewDataManager.getPivotedColumns()!
      : this.gridCore.getColumns();
    
    const leftKeys = this.viewDataManager.getPinnedLeftColumnKeys();
    const rightKeys = this.viewDataManager.getPinnedRightColumnKeys();
    
    return {
      left: allColumns.filter(c => leftKeys.includes(c.key)),
      center: allColumns.filter(c => !leftKeys.includes(c.key) && !rightKeys.includes(c.key)),
      right: allColumns.filter(c => rightKeys.includes(c.key)),
    };
  }
}
```

#### 왜 scrollableRows를 저장하지 않는가?

```
100만 행 시나리오:

[저장하면]
- ViewDataManager: 100만 Row 참조 (중복)
- DataStore: 100만 원본 데이터
- IndexManager: 100만 인덱스
= 메모리 낭비, 동기화 복잡

[저장 안 하면 (현재 설계)]
- DataStore: 100만 원본 데이터 (단일 원본)
- IndexManager: 100만 인덱스 (Uint32Array, ~4MB)
- ViewDataManager: pinned IDs만 (수십 개)
= 효율적, 동기화 불필요

일반 모드: DataStore + IndexManager 활용 (기존 흐름)
피봇 모드: 피봇 결과만 저장 (불가피하게 새 데이터)
```

### 2.2 파이프라인 아키텍처

데이터가 일련의 **변환기(Transformer)**를 통과하는 방식입니다.
아래에 통합 모델을 소개하고 있지만, 지정된 피봇 설정이 없으면 로직적으로는 피봇 변환기를 거치지 않도록 합니다.

```
[일반 모드 파이프라인]
Raw → FilterTransformer → SortTransformer → GroupTransformer → MaterializeTransformer

[피봇 모드 파이프라인]
Raw → FilterTransformer → SortTransformer → PivotTransformer → MaterializeTransformer
```

> **Filter → Sort 순서 이유**: 필터를 먼저 적용하면 데이터 양이 줄어들어 정렬 성능이 향상됩니다.
> (100만 행 전체 정렬 vs 필터 후 10만 행 정렬)

#### 단계(Phase) 개념

```typescript
enum PipelinePhase {
  PRE_TRANSFORM = 1,   // 원본 데이터 필터/정렬
  TRANSFORM = 2,       // 피봇, 그룹화 등 구조 변경
  POST_TRANSFORM = 3,  // 결과 필터/정렬
  MATERIALIZE = 4      // Row 인스턴스 생성
}

interface Transformer {
  readonly phase: PipelinePhase;
  readonly runInWorker: boolean;
  transform(ctx: TransformContext): TransformContext | Promise<TransformContext>;
}
```

#### 하이브리드 실행

```typescript
class DataPipeline {
  async execute(data: Row[]): Promise<ViewLayout> {
    let ctx = { data, indices: null };
    
    // Worker에서 무거운 처리 (Filter, Sort, Pivot)
    const workerTransformers = this.transformers.filter(t => t.runInWorker);
    if (workerTransformers.length > 0) {
      ctx = await this.workerBridge.runPipeline(workerTransformers, ctx);
    }
    
    // 메인 스레드에서 경량 처리 (Materialize)
    const mainTransformers = this.transformers.filter(t => !t.runInWorker);
    for (const transformer of mainTransformers) {
      ctx = transformer.transform(ctx);
    }
    
    return ctx.viewLayout;
  }
}
```

### 2.3 통합 설정 모델

ViewConfig로 일반/피봇 그리드를 **하나의 설정 인터페이스**로 관리합니다.
단, 실제 파이프라인은 **피봇 설정 유무에 따라 분기**됩니다.

```typescript
interface ViewConfig {
  // 피봇 설정 (비어있으면 일반 그리드)
  rowFields: string[];      // 행으로 사용할 필드
  columnFields: string[];   // 열로 사용할 필드 (피봇)
  valueFields: ValueField[]; // 값/집계 필드
  
  // 공통 설정
  sorts: SortState[];
  filters: FilterState[];
}

// 일반 그리드 설정
const normalConfig: ViewConfig = {
  rowFields: ['id', 'name', 'age', 'department'],
  columnFields: [],  // 비어있음 → PivotTransformer 스킵
  valueFields: [],
  sorts: [],
  filters: []
};

// 피봇 그리드 설정
const pivotConfig: ViewConfig = {
  rowFields: ['department'],
  columnFields: ['year', 'quarter'],  // 있음 → PivotTransformer 실행
  valueFields: [{ field: 'sales', aggregate: 'sum' }],
  sorts: [],
  filters: []
};
```

#### 파이프라인 분기 로직

```typescript
class DataPipeline {
  buildTransformers(config: ViewConfig): Transformer[] {
    const transformers: Transformer[] = [
      new FilterTransformer(config.filters),
      new SortTransformer(config.sorts),
    ];
    
    // columnFields가 있을 때만 PivotTransformer 추가
    if (config.columnFields.length > 0) {
      transformers.push(new PivotTransformer(config));
    } else {
      // 일반 모드: 그룹화만 적용
      transformers.push(new GroupTransformer(config));
    }
    
    transformers.push(new MaterializeTransformer());
    return transformers;
  }
}
```

> **핵심**: 설정은 통합, 실행은 분기
> - `columnFields: []` → 일반 그리드 파이프라인 (PivotTransformer 스킵)
> - `columnFields: [...]` → 피봇 그리드 파이프라인 (PivotTransformer 실행)

### 2.4 Row 클래스 리팩토링 - 데이터/렌더링 분리

기존 Row 클래스에서 렌더링 로직을 분리하여 **순수 데이터/상태 객체**로 변경합니다.

#### 변경 전

```typescript
// Row = 데이터 + 렌더링 (혼합)
class Row {
  private variant: RowVariant;
  private data: Record<string, unknown>;
  
  render(container: HTMLElement, context: RowRenderContext): void { ... }
  renderGroupHeader(container: HTMLElement, context: RowRenderContext): void { ... }
  renderData(container: HTMLElement, context: RowRenderContext): void { ... }
}
```

#### 변경 후

```typescript
// Row = 순수 데이터/상태 객체
class Row {
  readonly variant: RowVariant;
  readonly data: Record<string, unknown>;
  readonly structural: boolean;
  readonly meta: RowMeta;
  
  // 렌더링 로직 없음
  getData(): Record<string, unknown>;
  getVariant(): RowVariant;
  isStructural(): boolean;
}

// RowRenderer = 렌더링 전담
class RowRenderer {
  render(row: Row, container: HTMLElement, context: RowRenderContext): void {
    switch (row.variant) {
      case 'data':
        this.renderDataRow(row, container, context);
        break;
      case 'group-header':
        this.renderGroupHeader(row, container, context);
        break;
      // ...
    }
  }
}
```

#### 장점

| 항목 | 설명 |
|------|------|
| ViewDataManager 저장 | Row가 순수 데이터이므로 저장 가능 |
| 관심사 분리 | Row = What, ViewDataManager = Where, RowRenderer = How |
| 테스트 용이성 | Row/Renderer 독립 테스트 가능 |
| 렌더링 전략 교체 | RowRenderer만 교체하여 Canvas 렌더링 등 지원 가능 |

### 2.5 컬럼/행 고정 정보 관리

피봇 그리드에서는 **rowFields가 자동으로 좌측 고정 컬럼**이 됩니다.

#### 고정 정보는 ID/Key로 저장

```typescript
// ❌ Row 인스턴스나 ColumnDef 전체 저장
pinnedTopRows: Row[];           // 무거움, 동기화 문제
pinnedLeftColumns: ColumnDef[]; // 중복

// ✅ ID/Key만 저장, 필요시 조회
pinnedTopRowIds: (string | number)[];
pinnedLeftColumnKeys: string[];

// 사용 시 변환
getPinnedTopRows(): Row[] {
  return this.pinnedTopRowIds.map(id => this.gridCore.getRowById(id));
}

getLeftColumns(): ColumnDef[] {
  const allColumns = this.getColumns();
  return allColumns.filter(c => this.pinnedLeftColumnKeys.includes(c.key));
}
```

#### 피봇 모드에서 자동 좌측 고정

```typescript
class ViewDataManager {
  setMode(mode: 'pivot', config: PivotConfig): void {
    this.mode = mode;
    
    // rowFields는 피봇 테이블의 "행 헤더"가 됨
    // 자동으로 좌측 고정으로 설정
    this.pinnedLeftColumnKeys = config.rowFields;
    
    // 피봇 결과 저장
    this.pivotedData = config.pivotedData;
    this.pivotedColumns = config.generatedColumns;
  }
}

// 예시
// rowFields: ['department', 'region']
// → 자동으로 department, region 컬럼이 좌측 고정
```

---

## 3. 성능 예측

### 3.1 Filter/Sort → Pivot 파이프라인

```
┌──────────────┬─────────────┬─────────────┬─────────────┐
│   데이터 크기  │  필터/정렬   │    피봇     │    총합     │
├──────────────┼─────────────┼─────────────┼─────────────┤
│   10만 행    │  50-200ms   │  100-300ms  │  150-500ms  │
│   50만 행    │  200-800ms  │  300-800ms  │  500ms-1.5s │
│  100만 행    │  500-2000ms │  500-1500ms │   1-3.5s    │
└──────────────┴─────────────┴─────────────┴─────────────┘

* Worker에서 실행되므로 UI 블로킹 없음
* 필터로 데이터가 줄어들면 피봇 시간도 비례 감소
```

### 3.2 인덱스 기반 피봇

```typescript
// Worker 내부 처리
async function pivotWithIndices(
  fullData: Row[],              // Worker가 이미 보유
  filteredIndices: Uint32Array, // Transferable (복사 비용 0)
  pivotConfig: PivotConfig
): Promise<PivotedData> {
  // 1. 인덱스로 서브셋 추출 (빠름)
  const subset = extractByIndices(fullData, filteredIndices);
  
  // 2. 서브셋만 피봇 (데이터 양에 비례)
  return arquero.pivot(subset, pivotConfig);
}
```

### 3.3 캐싱 전략

```typescript
class CachedPipeline {
  private cache = new Map<string, TransformContext>();

  // 단계별 캐싱으로 변경된 부분만 재계산
  // - 필터만 변경: 필터 재실행 → 피봇 재실행
  // - 피봇 설정만 변경: 필터 캐시 사용 → 피봇만 재실행
  // - 정렬만 변경: 피봇 결과에 정렬만 적용 (가장 빠름)
}
```

---

## 4. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Core Layer                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │   DataStore     │  │  IndexManager   │  │  ArqueroProcessor   │ │
│  │  (원본 Row[])    │  │ (Uint32Array)   │  │  (Worker 처리)      │ │
│  │                 │  │                 │  │  - Filter/Sort      │ │
│  │  저장: 원본 데이터 │  │ 저장: 인덱스만   │  │  - Pivot (새 데이터)│ │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘ │
│           │                    │                      │            │
│           └────────────────────┼──────────────────────┘            │
│                                │                                    │
│                                ▼                                    │
│              ┌─────────────────────────────────────┐               │
│              │       ViewDataManager               │               │
│              │  ┌───────────────────────────────┐ │               │
│              │  │ 저장 (State)                   │ │               │
│              │  │  - mode: 'normal' | 'pivot'   │ │               │
│              │  │  - pinnedLeftColumnKeys[]     │ │               │
│              │  │  - pinnedRightColumnKeys[]    │ │               │
│              │  │  - pinnedTopRowIds[]          │ │               │
│              │  │  - pinnedBottomRowIds[]       │ │               │
│              │  │  - pivotedData (피봇 모드만)   │ │               │
│              │  │  - pivotedColumns (피봇 모드만)│ │               │
│              │  └───────────────────────────────┘ │               │
│              │  ┌───────────────────────────────┐ │               │
│              │  │ 저장하지 않음 (참조/계산)       │ │               │
│              │  │  - scrollableRows (참조)      │ │               │
│              │  │  - scrollableColumns (계산)   │ │               │
│              │  └───────────────────────────────┘ │               │
│              └─────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BodyRenderer                                 │
│                                                                     │
│   [일반 모드]                      [피봇 모드]                        │
│   GridCore.getAllData()           ViewDataManager.getPivotedData() │
│         ↓                                ↓                          │
│   GroupManager.flattenWithGroups()  convertToVirtualRows()         │
│         ↓                                ↓                          │
│         └────────────┬───────────────────┘                          │
│                      ▼                                              │
│              ┌─────────────────┐                                    │
│              │   RowRenderer   │                                    │
│              │  - render()     │                                    │
│              │  - renderData() │                                    │
│              │  - renderGroup()│                                    │
│              └─────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 데이터 흐름 요약

| 모드 | 데이터 소스 | IndexManager 역할 | ViewDataManager 역할 |
|------|------------|------------------|---------------------|
| 일반 | DataStore 원본 | 필터/정렬 인덱스 제공 | 고정 설정만 관리 |
| 피봇 | ViewDataManager.pivotedData | 사용 안 함 (피봇은 새 데이터) | 피봇 결과 + 고정 설정 관리 |

---

## 5. 파일 구조

```
src/
├── core/
│   ├── DataStore.ts          (원본 데이터 - 변경 없음)
│   ├── IndexManager.ts       (인덱스 - 변경 없음)
│   ├── ViewDataManager.ts    ← NEW (단일 접근점)
│   ├── ViewConfig.ts         ← NEW (통합 뷰 설정)
│   └── GridCore.ts           (ViewDataManager 연동)
│
├── processor/
│   ├── ArqueroProcessor.ts   (피봇 로직 추가)
│   ├── pipeline/             ← NEW
│   │   ├── DataPipeline.ts
│   │   ├── Transformer.ts
│   │   ├── FilterTransformer.ts
│   │   ├── SortTransformer.ts
│   │   ├── PivotTransformer.ts
│   │   ├── GroupTransformer.ts
│   │   └── MaterializeTransformer.ts
│   └── worker.ts             (파이프라인 지원)
│
├── model/                    ← NEW (데이터 모델)
│   └── Row.ts                (순수 데이터 객체)
│
└── ui/
    ├── row/
    │   ├── RowRenderer.ts    ← NEW (렌더링 분리)
    │   └── types.ts
    └── body/
        └── BodyRenderer.ts   (ViewDataManager 사용)
```

---

## 6. 구현 계획

### Phase 1: Row 리팩토링

1. `Row` 클래스에서 렌더링 로직 분리
2. `RowRenderer` 클래스 생성
3. `BodyRenderer`에서 `RowRenderer` 사용하도록 수정

### Phase 2: ViewDataManager 도입

1. `ViewDataManager` 클래스 생성
2. 컬럼/행 고정 로직 이동
3. `BodyRenderer`에서 `ViewDataManager.getViewLayout()` 사용

### Phase 3: 파이프라인 구축

1. `Transformer` 인터페이스 정의
2. 기존 로직을 Transformer로 분리
3. `DataPipeline` 클래스 구현

### Phase 4: 피봇 지원

1. `PivotTransformer` 구현
2. `ArqueroProcessor`에 피봇 로직 추가
3. 동적 컬럼 생성 지원

### Phase 5: 통합 및 최적화

1. 캐싱 전략 구현
2. 성능 테스트 및 최적화
3. API 문서화

---

## 7. 고려사항

### 7.1 파이프라인 순서 의존성

```typescript
// 순서에 따라 결과가 달라지는 예
Filter → Pivot  // 필터된 데이터를 피봇
Pivot → Filter  // 피봇 결과를 필터 (의미 다름!)

// Phase로 명시적 순서 보장
```

### 7.2 컬럼 정의 변경

피봇은 컬럼 구조를 변경합니다. Context에 컬럼 정의를 포함하여 하위 Transformer가 인지할 수 있게 합니다.

```typescript
interface TransformContext {
  data: Row[];
  indices: Uint32Array | null;
  columns: ColumnDef[];  // 현재 단계의 컬럼 정의
  columnMapping?: Map<string, string[]>;  // 원본 → 변환 후 매핑
}
```

### 7.3 Worker 통합

무거운 처리(Filter, Sort, Pivot)는 Worker에서, 경량 처리(Materialize)는 메인 스레드에서 실행합니다.

---

## 8. 관련 문서

- [007. Row 클래스 아키텍처](./007-row-class-architecture.md)
- [Core 아키텍처](../base/ARCHITECTURE-CORE.md)
- [UI 아키텍처](../base/ARCHITECTURE-UI.md)

---

## 9. 결론

### 핵심 설계 원칙

#### ViewDataManager = "뷰 설정 관리자" (데이터 저장소 ❌)

```
저장: 뷰 설정 (mode, pinned 정보, 피봇 결과)
저장하지 않음: scrollableRows, scrollableColumns (기존 모듈 활용)
```

#### 필터/정렬 vs 피봇의 본질적 차이

| 연산 | 결과물 | 저장 위치 | 데이터 참조 |
|------|--------|----------|------------|
| 필터/정렬 | Uint32Array (인덱스) | IndexManager | DataStore 원본 참조 |
| 피봇 | 새로운 Row[] | ViewDataManager | 직접 사용 (원본에 없음) |

### 핵심 변경사항

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| 뷰 설정 관리 | 분산 | **ViewDataManager 통합** |
| 데이터 변환 | 고정된 흐름 | **파이프라인 (유연한 조합)** |
| 뷰 모델 | 일반 그리드만 | **통합 모델 (일반 = 피봇 없음)** |
| Row 클래스 | 데이터 + 렌더링 | **순수 데이터 (렌더링 분리)** |
| 피봇 결과 저장 | 없음 | **ViewDataManager (피봇 모드만)** |

### 장점

1. **메모리 효율** - scrollable 데이터 중복 저장 없음 (100만 행도 문제 없음)
2. **동기화 단순** - DataStore가 원본 유지, 인덱스만 관리
3. **확장성** - 피봇, 새로운 변환 타입 쉽게 추가
4. **기존 아키텍처 보존** - DataStore, IndexManager 역할 유지
5. **유연성** - 파이프라인으로 다양한 변환 조합
6. **성능** - Worker + 인덱스 기반으로 대용량 데이터 처리
7. **테스트** - 모듈별 독립 테스트 가능

### ViewDataManager의 역할 정리

```
역할인 것:
✅ 뷰 모드 관리 (normal/pivot)
✅ 컬럼/행 고정 정보 중앙 관리
✅ 피봇 결과 저장 (피봇 모드에서만)
✅ 피봇 시 rowFields → 자동 좌측 고정

역할이 아닌 것:
❌ 원본 데이터 저장 (DataStore 역할)
❌ 인덱스 관리 (IndexManager 역할)
❌ scrollableRows/Columns 저장 (기존 모듈에서 참조)
```
