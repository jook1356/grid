# 25회차: 엔진 추상화 아키텍처 (Engine Abstraction Architecture)

## 개요

Arquero와 DuckDB-Wasm 두 엔진을 지원하는 추상화 레이어를 구현했습니다. 사용자는 `engine`과 `useWorker` 옵션으로 4가지 조합 중 최적의 구성을 선택할 수 있습니다.

## 왜 이게 필요한가?

### 배경 (020 문서 벤치마크 결과)

| 작업 | Arquero | DuckDB-Wasm | 승자 |
|------|---------|-------------|------|
| 필터 | 55ms | 522ms | Arquero |
| 피벗 | 785ms | 1,356ms | Arquero |
| 그룹 집계 | 1,020ms | 225ms | DuckDB |
| 복합 쿼리 | 640ms | 165ms | DuckDB |

**결론**: 각 엔진이 잘하는 영역이 다름. 사용 패턴에 따라 최적의 엔진이 달라짐.

### 4가지 조합

| engine | useWorker | 실행 방식 | 특징 |
|--------|-----------|----------|------|
| `'aq'` | `false` | Main + Arquero | 기본값, 가장 단순 |
| `'aq'` | `true` | Worker + Arquero | UI 블로킹 방지 |
| `'db'` | `false` | Main + DuckDB | 테스트/디버깅용 |
| `'db'` | `true` | Worker + DuckDB | 대량 데이터 + 복잡 집계 |

## 무엇을 했나?

### Phase 1: 엔진 추상화

#### 1-1. IEngine 인터페이스 정의

```typescript
// src/processor/engines/IEngine.ts
export type EngineType = 'aq' | 'db';

export interface IEngine {
  loadData(data: Row[]): Promise<void>;
  loadArrowIPC?(ipcBytes: Uint8Array): Promise<void>;
  filter(filters: FilterState[]): Promise<ProcessorResult>;
  sort(sorts: SortState[]): Promise<ProcessorResult>;
  query(options: QueryOptions): Promise<ProcessorResult>;
  aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]>;
  pivot(config: PivotConfig): Promise<PivotResult>;
  getRows(indices: number[]): Promise<Row[]>;
  getAllRows(): Promise<Row[]>;
  getUniqueValues(columnKey: string): Promise<CellValue[]>;
  getRowCount(): number;
  getColumnKeys(): string[];
  cleanup(): Promise<void>;
}
```

#### 1-2. ArqueroEngine 구현

기존 ArqueroProcessor와 PivotProcessor의 핵심 로직을 추출하여 IEngine을 구현:
- 필터/정렬: Arquero의 filter/orderby 사용
- 집계: groupby + rollup 사용
- 피벗: 피벗 + 부분합 + 총합계 지원 (기존 PivotProcessor 로직)

#### 1-3. DuckDBEngine 구현

SQL 기반으로 IEngine을 구현:
- 필터/정렬: SQL WHERE/ORDER BY
- 집계: GROUP BY
- 피벗: GROUPING SETS를 사용한 효율적인 부분합

```typescript
// GROUPING SETS 예시
SELECT
  region,
  product,
  SUM(amount) as total
FROM data
GROUP BY GROUPING SETS (
  (region, product),  -- 상세
  (region),           -- 지역별 소계
  ()                  -- 총계
)
```

### Phase 2: 프로세서 리팩토링

#### 2-1. MainThreadProcessor

메인 스레드에서 엔진을 직접 실행하는 프로세서:

```typescript
export class MainThreadProcessor implements IDataProcessor {
  private engine: IEngine | null = null;

  constructor(engineType: EngineType = 'aq') {
    this.engineType = engineType;
  }

  async initialize(data: Row[]): Promise<void> {
    this.engine = await this.createEngine();
    await this.engine.loadData(data);
  }

  private async createEngine(): Promise<IEngine> {
    if (this.engineType === 'db') {
      // 동적 임포트로 Tree-shaking 지원
      const { DuckDBEngine } = await import('./engines/DuckDBEngine');
      return new DuckDBEngine();
    }
    return new ArqueroEngine();
  }
}
```

#### 2-2. WorkerProcessor

Web Worker로 작업을 위임하는 브릿지:

```typescript
export class WorkerProcessor implements IDataProcessor {
  private worker: Worker;
  private pendingRequests: Map<string, PromiseHandlers>;

  constructor(engineType: EngineType = 'aq') {
    this.worker = new Worker(
      new URL('./processorWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.sendMessage('INIT', { engineType });
  }

  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    const result = await this.sendMessage('FILTER', { filters });
    // Uint32Array 복원 (Transferable)
    return {
      ...result,
      indices: new Uint32Array(result.indices),
    };
  }
}
```

#### 2-3. processorWorker.ts

Worker 스크립트:

```typescript
let engine: IEngine | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = e.data;

  switch (type) {
    case 'INIT':
      engine = await createEngine(payload.engineType);
      break;
    case 'FILTER':
      const result = await engine!.filter(payload.filters);
      // Transferable로 전송 (복사 없이)
      self.postMessage({ id, type: 'SUCCESS', result }, [result.indices.buffer]);
      break;
    // ...
  }
};
```

#### 2-4. ProcessorFactory

팩토리 함수:

```typescript
export function createProcessor(options: ProcessorOptions = {}): IDataProcessor {
  const engine = options.engine ?? 'aq';
  const useWorker = options.useWorker ?? false;

  if (useWorker) {
    return new WorkerProcessor(engine);
  }
  return new MainThreadProcessor(engine);
}
```

### Phase 3: PureSheet 통합

#### 옵션 추가

```typescript
// src/types/field.types.ts
export interface PureSheetConfigBase {
  // ... 기존 옵션들
  engine?: EngineType;     // 'aq' | 'db'
  useWorker?: boolean;     // default: false
}
```

#### GridCore 수정

```typescript
// src/core/GridCore.ts
constructor(options: GridCoreOptions) {
  this.processor = createProcessor({
    engine: options.engine,
    useWorker: options.useWorker,
  });
}
```

### Phase 4: 테스트

28개 테스트 작성 및 통과:
- ArqueroEngine 단위 테스트 (22개)
  - 초기화, 필터, 정렬, query, 집계, 데이터 조회, cleanup
- ProcessorFactory 테스트 (2개)
- ArqueroEngine 기본 동작 테스트 (4개)

```bash
 ✓ tests/processor/engines/ArqueroEngine.test.ts (22 tests)
 ✓ tests/processor/engines/engine-consistency.test.ts (6 tests)
 Test Files  2 passed
 Tests       28 passed | 2 skipped
```

## 디렉토리 구조

```
src/processor/
├── engines/
│   ├── IEngine.ts              # 공통 인터페이스
│   ├── ArqueroEngine.ts        # Arquero 구현 (~1100줄)
│   ├── DuckDBEngine.ts         # DuckDB 구현 (~600줄)
│   └── index.ts                # 내보내기
│
├── MainThreadProcessor.ts      # Main 스레드 실행
├── WorkerProcessor.ts          # Worker 경유 실행
├── processorWorker.ts          # Worker 스크립트
├── ProcessorFactory.ts         # 팩토리
└── index.ts                    # 통합 내보내기

tests/processor/engines/
├── ArqueroEngine.test.ts       # 엔진 단위 테스트
└── engine-consistency.test.ts  # 일관성 + 팩토리 테스트
```

## 사용법

### 기본 사용 (변경 없음)

```typescript
// 기본값: engine='aq', useWorker=false
const sheet = new PureSheet(container, {
  columns: [...],
});
```

### Worker 활성화

```typescript
const sheet = new PureSheet(container, {
  columns: [...],
  useWorker: true,  // UI 블로킹 방지
});
```

### DuckDB 엔진 사용

```typescript
const sheet = new PureSheet(container, {
  columns: [...],
  engine: 'db',
  useWorker: true,  // DuckDB는 Worker 권장
});
```

## 권장 설정 가이드

| 데이터 규모 | 주요 작업 | 권장 설정 |
|------------|----------|----------|
| < 10만 건 | 필터/정렬 | `engine: 'aq', useWorker: false` |
| 10-100만 건 | 필터/정렬 | `engine: 'aq', useWorker: true` |
| 10-100만 건 | 피벗+부분합 반복 | `engine: 'db', useWorker: true` |
| > 100만 건 | 모든 작업 | `engine: 'db', useWorker: true` |
| 서버가 Arrow 제공 | 모든 작업 | `engine: 'db', useWorker: true` |

## 번들 사이즈

| 설정 | 추가 번들 사이즈 |
|------|-----------------|
| `engine: 'aq'` | ~150KB (Arquero) |
| `engine: 'db'` | ~3.5MB (DuckDB-Wasm) |

**Tree-shaking**: DuckDB를 사용하지 않으면 동적 임포트로 인해 번들에서 자동 제외

## 향후 개선 사항

1. DuckDB의 Arrow IPC 직접 로드 최적화 (`loadArrowIPC`)
2. 실제 환경에서의 벤치마크 페이지 업데이트
3. 엔진 간 일관성 테스트 확장 (DuckDB 테스트 환경 구성)
