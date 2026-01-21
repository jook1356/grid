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

## 다음 단계

1. **PivotTransformer 구현**: Arquero를 활용한 피봇 로직
2. **MaterializeTransformer 구현**: Row 인스턴스 생성
3. **Worker 통합**: 파이프라인의 Worker 실행 지원
4. **캐싱 전략**: 단계별 결과 캐싱으로 성능 최적화

## 관련 문서

- [008-pivot-grid-architecture.md](../decisions/008-pivot-grid-architecture.md) - 설계 문서
- [ARCHITECTURE-CORE.md](../base/ARCHITECTURE-CORE.md) - Core 아키텍처
- [ARCHITECTURE-UI.md](../base/ARCHITECTURE-UI.md) - UI 아키텍처
