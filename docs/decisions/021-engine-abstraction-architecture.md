# 021. 엔진 추상화 아키텍처 (Engine Abstraction Architecture)

## 상태
**구현됨** (2026-01-28)

## 배경 (Context)

020 문서에서 DuckDB-Wasm 마이그레이션 타당성을 조사한 결과:

| 작업 | Arquero | DuckDB-Wasm | 승자 |
|------|---------|-------------|------|
| 필터 | 55ms | 522ms | Arquero |
| 피벗 | 785ms | 1,356ms | Arquero |
| 그룹 집계 | 1,020ms | 225ms | DuckDB |
| 복합 쿼리 | 640ms | 165ms | DuckDB |

**결론**: 각 엔진이 잘하는 영역이 다름. 사용 패턴에 따라 최적의 엔진이 달라짐.

---

## 결정 (Decision)

### 1. 엔진 선택 옵션 (`engine`)

```typescript
const sheet = new PureSheet(container, {
  engine: 'aq',  // 'aq' (Arquero) | 'db' (DuckDB-Wasm)
});
```

| 값 | 엔진 | 권장 사용 케이스 |
|----|------|-----------------|
| `'aq'` | Arquero | 필터/정렬 위주, 번들 사이즈 민감 |
| `'db'` | DuckDB-Wasm | 복잡 집계 반복, 서버가 Arrow 제공 |

### 2. Worker 사용 옵션 (`useWorker`)

```typescript
const sheet = new PureSheet(container, {
  engine: 'aq',
  useWorker: true,  // true | false (기본값: false)
});
```

| 값 | 동작 | 권장 사용 케이스 |
|----|------|-----------------|
| `false` | 메인 스레드에서 실행 | 소량 데이터, 간단한 연산 |
| `true` | Web Worker에서 실행 | 대량 데이터, UI 블로킹 방지 |

### 3. 4가지 조합

| engine | useWorker | 실행 방식 | 특징 |
|--------|-----------|----------|------|
| `'aq'` | `false` | Main + Arquero | 기본값, 가장 단순 |
| `'aq'` | `true` | Worker + Arquero | UI 블로킹 방지 |
| `'db'` | `false` | Main + DuckDB | 테스트/디버깅용 |
| `'db'` | `true` | Worker + DuckDB | 대량 데이터 + 복잡 집계 |

---

## 모듈 구조

### 디렉토리 구조

```
src/processor/
├── engines/                      # 순수 엔진 로직 (Worker/Main 공용)
│   ├── IEngine.ts                # 공통 인터페이스
│   ├── ArqueroEngine.ts          # Arquero 구현
│   └── DuckDBEngine.ts           # DuckDB 구현
│
├── MainThreadProcessor.ts        # Main 스레드에서 엔진 직접 실행
├── WorkerProcessor.ts            # Worker 경유 실행 (브릿지)
├── processorWorker.ts            # Worker 스크립트
└── ProcessorFactory.ts           # 팩토리
```

### 핵심 인터페이스

```typescript
// engines/IEngine.ts
export interface IEngine {
  // 데이터 로드
  loadData(data: Row[]): Promise<void>;

  // Arrow IPC로 로드 (DuckDB 최적화용)
  loadArrowIPC?(ipcBytes: Uint8Array): Promise<void>;

  // 필터
  filter(conditions: FilterCondition[]): Promise<Row[]>;

  // 정렬
  sort(sortKeys: SortKey[]): Promise<Row[]>;

  // 피벗 + 부분합
  pivot(config: PivotConfig): Promise<PivotResult>;

  // 정리
  cleanup(): Promise<void>;
}
```

### 엔진 구현 예시

```typescript
// engines/ArqueroEngine.ts
import * as aq from 'arquero';
import type { IEngine } from './IEngine';

export class ArqueroEngine implements IEngine {
  private table: ColumnTable | null = null;

  async loadData(data: Row[]): Promise<void> {
    this.table = aq.from(data);
  }

  async filter(conditions: FilterCondition[]): Promise<Row[]> {
    if (!this.table) throw new Error('Data not loaded');

    let result = this.table;
    for (const cond of conditions) {
      result = result.filter(`d => d.${cond.field} ${cond.op} ${cond.value}`);
    }
    return result.objects();
  }

  async pivot(config: PivotConfig): Promise<PivotResult> {
    // Arquero 피벗 로직
  }

  async cleanup(): Promise<void> {
    this.table = null;
  }
}

// engines/DuckDBEngine.ts
import * as duckdb from '@duckdb/duckdb-wasm';
import type { IEngine } from './IEngine';

export class DuckDBEngine implements IEngine {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;

  async loadData(data: Row[]): Promise<void> {
    // JS 배열 → Arrow 변환 → DuckDB 로드
  }

  async loadArrowIPC(ipcBytes: Uint8Array): Promise<void> {
    // Arrow IPC 직접 로드 (최적화)
    await this.conn?.insertArrowFromIPCStream(ipcBytes, { name: 'data' });
  }

  async filter(conditions: FilterCondition[]): Promise<Row[]> {
    const where = conditions
      .map(c => `${c.field} ${c.op} ${c.value}`)
      .join(' AND ');

    const result = await this.conn?.query(`
      SELECT * FROM data WHERE ${where}
    `);
    return result?.toArray().map(r => r.toJSON()) ?? [];
  }

  async pivot(config: PivotConfig): Promise<PivotResult> {
    // GROUPING SETS를 사용한 효율적인 피벗 + 부분합
    const result = await this.conn?.query(`
      SELECT ...
      FROM data
      GROUP BY GROUPING SETS (
        (${config.rowFields.join(', ')}, ${config.colFields.join(', ')}),
        (${config.rowFields.join(', ')}),
        (${config.colFields.join(', ')}),
        ()
      )
    `);
    // 결과 변환
  }

  async cleanup(): Promise<void> {
    await this.conn?.close();
    await this.db?.terminate();
  }
}
```

### 프로세서 구현

```typescript
// MainThreadProcessor.ts
export class MainThreadProcessor implements IDataProcessor {
  private engine: IEngine;

  constructor(engineType: 'aq' | 'db') {
    this.engine = engineType === 'aq'
      ? new ArqueroEngine()
      : new DuckDBEngine();
  }

  async loadData(data: Row[]): Promise<void> {
    return this.engine.loadData(data);
  }

  async filter(conditions: FilterCondition[]): Promise<Row[]> {
    return this.engine.filter(conditions);
  }

  // ... 나머지 메서드
}

// WorkerProcessor.ts
export class WorkerProcessor implements IDataProcessor {
  private worker: Worker;
  private pendingRequests: Map<string, { resolve: Function; reject: Function }>;

  constructor(engineType: 'aq' | 'db') {
    this.worker = new Worker(
      new URL('./processorWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.pendingRequests = new Map();

    this.worker.onmessage = this.handleMessage.bind(this);
    this.sendMessage('INIT', { engineType });
  }

  private sendMessage(type: string, payload: any): Promise<any> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async filter(conditions: FilterCondition[]): Promise<Row[]> {
    return this.sendMessage('FILTER', { conditions });
  }

  // ... 나머지 메서드
}

// processorWorker.ts
import { ArqueroEngine } from './engines/ArqueroEngine';
import { DuckDBEngine } from './engines/DuckDBEngine';
import type { IEngine } from './engines/IEngine';

let engine: IEngine;

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  try {
    let result;

    switch (type) {
      case 'INIT':
        engine = payload.engineType === 'aq'
          ? new ArqueroEngine()
          : new DuckDBEngine();
        result = { success: true };
        break;

      case 'LOAD_DATA':
        await engine.loadData(payload.data);
        result = { success: true };
        break;

      case 'FILTER':
        result = await engine.filter(payload.conditions);
        break;

      case 'PIVOT':
        result = await engine.pivot(payload.config);
        break;

      case 'CLEANUP':
        await engine.cleanup();
        result = { success: true };
        break;
    }

    self.postMessage({ id, type: 'SUCCESS', result });
  } catch (error) {
    self.postMessage({ id, type: 'ERROR', error: (error as Error).message });
  }
};
```

### 팩토리

```typescript
// ProcessorFactory.ts
import { MainThreadProcessor } from './MainThreadProcessor';
import { WorkerProcessor } from './WorkerProcessor';
import type { IDataProcessor } from './IDataProcessor';

export interface ProcessorOptions {
  engine: 'aq' | 'db';
  useWorker: boolean;
}

export function createProcessor(options: ProcessorOptions): IDataProcessor {
  const { engine, useWorker } = options;

  if (useWorker) {
    return new WorkerProcessor(engine);
  } else {
    return new MainThreadProcessor(engine);
  }
}

// 기본값
export const DEFAULT_PROCESSOR_OPTIONS: ProcessorOptions = {
  engine: 'aq',
  useWorker: false,
};
```

---

## PureSheet 통합

```typescript
// PureSheet.ts
import { createProcessor, DEFAULT_PROCESSOR_OPTIONS } from './processor/ProcessorFactory';

export interface PureSheetOptions {
  // 기존 옵션들
  columns: ColumnDefinition[];
  rowHeight?: number;
  // ...

  // 새로운 옵션
  engine?: 'aq' | 'db';
  useWorker?: boolean;
}

export class PureSheet {
  private processor: IDataProcessor;

  constructor(container: HTMLElement, options: PureSheetOptions) {
    // 프로세서 생성
    this.processor = createProcessor({
      engine: options.engine ?? DEFAULT_PROCESSOR_OPTIONS.engine,
      useWorker: options.useWorker ?? DEFAULT_PROCESSOR_OPTIONS.useWorker,
    });

    // ... 나머지 초기화
  }
}
```

---

## 마이그레이션 가이드

### 기존 사용자 (변경 없음)

```typescript
// 기존 코드 그대로 동작 (기본값: engine='aq', useWorker=false)
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

---

## 권장 설정 가이드

| 데이터 규모 | 주요 작업 | 권장 설정 |
|------------|----------|----------|
| < 10만 건 | 필터/정렬 | `engine: 'aq', useWorker: false` |
| 10-100만 건 | 필터/정렬 | `engine: 'aq', useWorker: true` |
| 10-100만 건 | 피벗+부분합 반복 | `engine: 'db', useWorker: true` |
| > 100만 건 | 모든 작업 | `engine: 'db', useWorker: true` |
| 서버가 Arrow 제공 | 모든 작업 | `engine: 'db', useWorker: true` |

---

## 번들 사이즈 고려

| 설정 | 추가 번들 사이즈 |
|------|-----------------|
| `engine: 'aq'` | ~150KB (Arquero) |
| `engine: 'db'` | ~3.5MB (DuckDB-Wasm) |

**Tree-shaking 지원**: 사용하지 않는 엔진은 번들에서 제외

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      // DuckDB를 사용하지 않으면 자동으로 제외됨
    }
  }
});
```

---

## 테스트 전략

```typescript
// 엔진 단위 테스트
describe('ArqueroEngine', () => {
  it('should filter data correctly', async () => {
    const engine = new ArqueroEngine();
    await engine.loadData(testData);
    const result = await engine.filter([{ field: 'amount', op: '>', value: 100 }]);
    expect(result.length).toBe(expectedCount);
  });
});

describe('DuckDBEngine', () => {
  it('should filter data correctly', async () => {
    const engine = new DuckDBEngine();
    await engine.loadData(testData);
    const result = await engine.filter([{ field: 'amount', op: '>', value: 100 }]);
    expect(result.length).toBe(expectedCount);
  });
});

// 동일한 테스트를 두 엔진에 적용 (일관성 검증)
describe.each(['aq', 'db'] as const)('Engine: %s', (engineType) => {
  it('should produce same filter results', async () => {
    const processor = createProcessor({ engine: engineType, useWorker: false });
    // ...
  });
});
```

---

## 구현 단계

### Phase 1: 엔진 추상화
1. `IEngine` 인터페이스 정의
2. `ArqueroEngine` 구현 (기존 로직 추출)
3. `DuckDBEngine` 구현

### Phase 2: 프로세서 리팩토링
1. `MainThreadProcessor` 구현
2. `WorkerProcessor` 구현
3. `processorWorker.ts` 구현
4. `ProcessorFactory` 구현

### Phase 3: PureSheet 통합
1. `engine`, `useWorker` 옵션 추가
2. 기본값 설정 (`'aq'`, `false`)
3. 문서화

### Phase 4: 테스트 및 벤치마크
1. 엔진 단위 테스트
2. 통합 테스트
3. 성능 벤치마크 페이지 업데이트

---

## 관련 문서

- [009. Worker 아키텍처 제거](./009-remove-worker-architecture.md) - Worker 제거 배경
- [020. DuckDB-Wasm 마이그레이션 타당성](./020-duckdb-wasm-migration-feasibility.md) - 벤치마크 결과
