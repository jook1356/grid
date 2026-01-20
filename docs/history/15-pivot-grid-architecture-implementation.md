# 15. 피봇 그리드 아키텍처 구현

## 개요

피봇 그리드를 지원하기 위한 핵심 아키텍처를 구현했습니다. Row 클래스 리팩토링, ViewDataManager 도입, 그리고 데이터 변환 파이프라인을 구축했습니다.

## 구현 내용

### Phase 1: Row 리팩토링

Row 클래스에서 렌더링 로직을 분리하여 순수 데이터/상태 객체로 만들었습니다.

#### 1.1 RowRenderer 클래스 생성

렌더링 로직을 담당하는 새로운 클래스를 생성했습니다.

```typescript
// src/ui/row/RowRenderer.ts
export class RowRenderer {
  render(row: Row, container: HTMLElement, context: RowRenderContext): void {
    switch (row.variant) {
      case 'group-header':
        this.renderGroupHeader(row, container, context);
        break;
      case 'subtotal':
      case 'grandtotal':
        this.renderAggregate(row, container, context);
        break;
      case 'data':
      default:
        this.renderData(row, container, context);
    }
  }
}
```

#### 1.2 Row 클래스 리팩토링

Row 클래스를 순수 데이터 객체로 변경했습니다.

```typescript
// 설계 원칙
// - Row = What (무엇을 렌더링할 것인가 - 데이터)
// - RowRenderer = How (어떻게 렌더링할 것인가 - 렌더링 로직)
```

#### 1.3 BodyRenderer 수정

RowRenderer를 사용하도록 BodyRenderer를 수정했습니다.

```typescript
// 변경 전
row.render(rowElement, context);

// 변경 후
this.rowRenderer.render(row, rowElement, context);
```

### Phase 2: ViewDataManager 도입

뷰 설정을 중앙에서 관리하는 ViewDataManager를 구현했습니다.

#### 2.1 ViewConfig 타입 정의

일반/피봇 그리드를 통합하는 설정 인터페이스를 정의했습니다.

```typescript
// src/core/ViewConfig.ts
interface ViewConfig {
  rowFields: string[];      // 행 필드
  columnFields: string[];   // 열 필드 (피봇용)
  valueFields: ValueField[]; // 값/집계 필드
  sorts: SortState[];
  filters: FilterState[];
}

// columnFields가 비어있으면 일반 그리드
// columnFields가 있으면 피봇 그리드
```

#### 2.2 ViewDataManager 클래스

뷰 설정 관리자를 구현했습니다.

```typescript
// src/core/ViewDataManager.ts
class ViewDataManager {
  // 저장: 뷰 설정
  private mode: ViewMode = 'normal';
  private pinnedLeftColumnKeys: string[] = [];
  private pinnedRightColumnKeys: string[] = [];
  private pinnedTopRowIds: (string | number)[] = [];
  private pinnedBottomRowIds: (string | number)[] = [];
  
  // 저장: 피봇 결과 (피봇 모드만)
  private pivotedData: RowData[] | null = null;
  private pivotedColumns: ColumnDef[] | null = null;
  
  // 핵심 API
  setNormalMode(): void;
  setPivotMode(config: PivotConfig, result: PivotResult): void;
  getColumnLayout(): { left, center, right };
}
```

#### 2.3 GridCore 연동

GridCore에 ViewDataManager를 연동했습니다.

```typescript
// src/core/GridCore.ts
export class GridCore {
  private readonly viewDataManager: ViewDataManager;
  
  get viewManager(): ViewDataManager {
    return this.viewDataManager;
  }
}
```

### Phase 3: 파이프라인 아키텍처

데이터 변환 파이프라인을 구축했습니다.

#### 3.1 Transformer 인터페이스

파이프라인의 기본 단위인 Transformer 인터페이스를 정의했습니다.

```typescript
// src/processor/pipeline/Transformer.ts
interface Transformer {
  readonly name: string;
  readonly phase: PipelinePhase;
  readonly runInWorker: boolean;
  transform(ctx: TransformContext): TransformContext | Promise<TransformContext>;
}

enum PipelinePhase {
  PRE_TRANSFORM = 1,  // 필터
  SORT = 2,           // 정렬
  TRANSFORM = 3,      // 피봇/그룹화
  POST_TRANSFORM = 4, // 후처리
  MATERIALIZE = 5,    // Row 생성
}
```

#### 3.2 DataPipeline 클래스

Transformer들을 관리하고 실행하는 파이프라인을 구현했습니다.

```typescript
// src/processor/pipeline/DataPipeline.ts
class DataPipeline {
  addTransformer(transformer: Transformer): this;
  async execute(data: RowData[], columns: ColumnDef[]): Promise<PipelineResult>;
  buildFromConfig(config: ViewConfig, factory: TransformerFactory): this;
}
```

#### 3.3 기본 Transformers 구현

- **FilterTransformer**: 조건에 맞는 행의 인덱스 필터링
- **SortTransformer**: 인덱스 배열 정렬
- **GroupTransformer**: 데이터 그룹화 및 계층 구조 생성

## 파일 구조

```
src/
├── core/
│   ├── ViewConfig.ts         ← NEW (뷰 설정 타입)
│   ├── ViewDataManager.ts    ← NEW (뷰 설정 관리자)
│   └── GridCore.ts           ← MODIFIED (ViewDataManager 연동)
│
├── processor/
│   ├── pipeline/             ← NEW
│   │   ├── index.ts
│   │   ├── Transformer.ts    (타입/인터페이스)
│   │   ├── DataPipeline.ts   (파이프라인 관리)
│   │   ├── FilterTransformer.ts
│   │   ├── SortTransformer.ts
│   │   └── GroupTransformer.ts
│   └── index.ts              ← MODIFIED (pipeline export)
│
└── ui/
    └── row/
        ├── Row.ts            ← MODIFIED (순수 데이터 객체)
        ├── RowRenderer.ts    ← NEW (렌더링 전담)
        └── index.ts          ← MODIFIED (RowRenderer export)
```

## 핵심 개념

### 관심사 분리

```
Row = What (무엇을 렌더링할 것인가 - 데이터)
RowRenderer = How (어떻게 렌더링할 것인가 - 렌더링 로직)
ViewDataManager = Where (어디에 렌더링할 것인가 - 위치/레이아웃)
```

### 필터/정렬 vs 피봇

| 연산 | 결과물 | 저장 위치 | 데이터 참조 |
|------|--------|----------|------------|
| 필터/정렬 | Uint32Array (인덱스) | IndexManager | DataStore 원본 참조 |
| 피봇 | 새로운 Row[] | ViewDataManager | 직접 사용 (원본에 없음) |

### 파이프라인 순서

```
[일반 모드]
Raw → FilterTransformer → SortTransformer → GroupTransformer → MaterializeTransformer

[피봇 모드]
Raw → FilterTransformer → SortTransformer → PivotTransformer → MaterializeTransformer
```

> Filter → Sort 순서: 필터를 먼저 적용하면 데이터 양이 줄어들어 정렬 성능이 향상됩니다.

### Phase 4: PivotTransformer 구현

Arquero의 pivot 기능을 활용한 피봇 변환기를 구현했습니다.

#### 4.1 PivotTransformer 클래스

Wide 포맷의 피봇 결과를 생성하는 변환기입니다.

```typescript
// src/processor/pipeline/PivotTransformer.ts
export class PivotTransformer implements Transformer {
  readonly phase = PipelinePhase.TRANSFORM;
  readonly runInWorker = true;
  
  private config: PivotConfig;
  
  transform(ctx: TransformContext): TransformContext {
    // 피봇 설정이 있으면 실행
    const pivotResult = this.executePivot(ctx.data, ctx.indices);
    result.pivotResult = pivotResult;
    result.columns = pivotResult.columns;
    return result;
  }
}

interface PivotConfig {
  rowFields: string[];     // 행으로 유지될 필드
  columnFields: string[];  // 열로 펼쳐질 필드
  valueFields: ValueFieldConfig[]; // 값/집계 필드
}
```

#### 4.2 ArqueroProcessor.pivot() 추가

Worker에서 실행될 실제 피봇 로직을 ArqueroProcessor에 추가했습니다.

```typescript
// src/processor/ArqueroProcessor.ts
async pivot(options: PivotOptions): Promise<PivotResult> {
  // 1. 필터 적용
  // 2. 동적 컬럼 값 수집
  // 3. 그룹화 + 조건부 집계 실행
  // 4. 결과를 Row[]로 변환
  // 5. 컬럼 정의 생성
  return { rows, columns, generatedValueColumnKeys };
}
```

#### 4.3 Worker/WorkerBridge 확장

PIVOT 메시지 타입과 API를 추가했습니다.

```typescript
// types/processor.types.ts
export type WorkerRequestType = 
  | 'INITIALIZE' | 'SORT' | 'FILTER' | 'QUERY' | 'AGGREGATE'
  | 'PIVOT'  // NEW
  | 'DESTROY';

// WorkerBridge.ts
async pivot(options: PivotOptions): Promise<PivotResult> {
  return this.send<PivotResult>('PIVOT', options);
}
```

### Phase 5: MaterializeTransformer 구현

파이프라인의 마지막 단계로, 중간 결과를 렌더링 가능한 Row[]로 변환합니다.

#### 5.1 MaterializeTransformer 클래스

```typescript
// src/processor/pipeline/MaterializeTransformer.ts
export class MaterializeTransformer implements Transformer {
  readonly phase = PipelinePhase.MATERIALIZE;
  readonly runInWorker = false; // 메인 스레드에서 실행 (DOM 관련)
  
  transform(ctx: TransformContext): TransformContext {
    let materializedRows: MaterializedRow[];
    
    if (ctx.pivotResult) {
      // 피봇 결과 → Row[]
      materializedRows = this.materializePivotResult(ctx.pivotResult.rows);
    } else if (ctx.groupInfo) {
      // 그룹화된 데이터 → 그룹 헤더 + 데이터 행
      materializedRows = this.materializeGroupedData(ctx.data, ctx.groupInfo.groups);
    } else if (ctx.indices) {
      // 인덱스 → Row[]
      materializedRows = this.materializeIndices(ctx.data, ctx.indices);
    } else {
      // 전체 데이터 → Row[]
      materializedRows = this.materializeAllData(ctx.data);
    }
    
    result.metadata = { materializedRows };
    return result;
  }
}

interface MaterializedRow {
  row: Row;          // Row 인스턴스
  dataIndex?: number; // 원본 인덱스
  groupPath?: string[]; // 그룹 경로
  level?: number;     // 그룹 레벨
}
```

### Phase 6: CachedPipeline 구현

단계별 캐싱으로 변경된 부분만 재계산하는 파이프라인입니다.

```typescript
// src/processor/pipeline/CachedPipeline.ts
export class CachedPipeline {
  private cache = new Map<PipelinePhase, CacheEntry>();
  private currentHashes: ConfigHash;
  
  async execute(config: ViewConfig, factory: TransformerFactory): Promise<PipelineResult> {
    // 1. 설정 해시 계산
    const newHashes = this.computeConfigHashes(config);
    
    // 2. 무효화 시작 지점 결정
    const invalidFromPhase = this.determineInvalidationPoint(newHashes);
    
    // 3. 캐시된 컨텍스트에서 시작하거나 처음부터 시작
    ctx = this.getStartContext(invalidFromPhase);
    
    // 4. 필요한 단계만 실행
    for (const transformer of transformers) {
      if (transformer.phase >= invalidFromPhase) {
        ctx = transformer.transform(ctx);
        this.cachePhase(transformer.phase, ctx);
      }
    }
    
    return { context: ctx };
  }
}
```

#### 캐싱 전략

| 변경 | 무효화 시작 | 캐시 유지 |
|------|------------|----------|
| 필터 변경 | PRE_TRANSFORM | 없음 |
| 정렬 변경 | SORT | 필터 결과 |
| 피봇/그룹 변경 | TRANSFORM | 필터 + 정렬 결과 |
| 데이터 변경 | 전체 | 없음 |

## 파일 구조 (최종)

```
src/
├── core/
│   ├── ViewConfig.ts         ← Phase 2
│   ├── ViewDataManager.ts    ← Phase 2
│   └── GridCore.ts           ← MODIFIED
│
├── processor/
│   ├── ArqueroProcessor.ts   ← MODIFIED (pivot 추가)
│   ├── WorkerBridge.ts       ← MODIFIED (pivot API)
│   ├── worker.ts             ← MODIFIED (PIVOT 핸들러)
│   ├── pipeline/             ← Phase 3-6
│   │   ├── index.ts
│   │   ├── Transformer.ts
│   │   ├── DataPipeline.ts
│   │   ├── FilterTransformer.ts
│   │   ├── SortTransformer.ts
│   │   ├── GroupTransformer.ts
│   │   ├── PivotTransformer.ts      ← Phase 4
│   │   ├── MaterializeTransformer.ts ← Phase 5
│   │   └── CachedPipeline.ts        ← Phase 6
│   └── index.ts
│
├── types/
│   └── processor.types.ts    ← MODIFIED ('PIVOT' 추가)
│
└── ui/
    └── row/
        ├── Row.ts            ← Phase 1
        ├── RowRenderer.ts    ← Phase 1
        └── index.ts
```

## 핵심 개념 정리

### Long Format vs Wide Format

```
// Long Format (차트용 집계)
| dept | year | quarter | sales |
| A    | 2023 | Q1      | 100   |
| A    | 2023 | Q2      | 150   |

// Wide Format (피봇 그리드용) ← 우리가 만드는 것
| dept | 2023_Q1_sales | 2023_Q2_sales |
| A    | 100           | 150           |
```

### 파이프라인 실행 흐름

```
[일반 모드]
Raw → Filter → Sort → Group → Materialize → Row[]

[피봇 모드]
Raw → Filter → Sort → Pivot → Materialize → Row[]
                        ↓
              새로운 컬럼 정의도 생성
```

## 관련 문서

- [008-pivot-grid-architecture.md](../decisions/008-pivot-grid-architecture.md) - 설계 문서
- [ARCHITECTURE-CORE.md](../base/ARCHITECTURE-CORE.md) - Core 아키텍처
- [ARCHITECTURE-UI.md](../base/ARCHITECTURE-UI.md) - UI 아키텍처
