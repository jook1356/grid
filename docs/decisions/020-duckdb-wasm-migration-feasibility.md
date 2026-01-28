# 020. DuckDB-Wasm 마이그레이션 타당성 조사

## 상태
**검토 중** (2026-01-28)

## 배경 (Context)

현재 PureSheet Grid는 **Arquero 기반 메인 스레드 처리** 아키텍처를 사용합니다 (009 문서 참조).

```
현재 아키텍처:
┌──────────────────────────────────────┐
│           Main Thread                │
│  ┌──────────────────────────────┐    │
│  │         GridCore             │    │
│  │  ┌────────┐ ┌─────────────┐  │    │
│  │  │DataStore│ │ArqueroProcessor│ │    │
│  │  └────────┘ └─────────────┘  │    │
│  │  ┌────────────┐              │    │
│  │  │IndexManager│              │    │
│  │  └────────────┘              │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

009 문서에서 Worker를 제거한 이유:
- **직렬화 비용이 연산 비용보다 큼** (100만 건 기준 300-1000ms 블로킹)
- JS 객체 → Worker 전송 시 구조화된 복제(Structured Clone)가 메인 스레드에서 발생
- Worker의 목적(UI 블로킹 방지)이 직렬화로 인해 무의미해짐

---

## 제안: DuckDB-Wasm + Web Worker + Arrow

### 핵심 아이디어

DuckDB-Wasm은 **Apache Arrow 포맷을 네이티브로 지원**합니다. Arrow는 **Transferable 객체**로 전송 가능하여 **Zero-copy 전송**이 가능합니다.

```
제안 아키텍처:
┌─────────────────┐    Transferable    ┌─────────────────┐
│   Main Thread   │    (Zero-copy)     │   Web Worker    │
│  ┌───────────┐  │  ──────────────→   │  ┌───────────┐  │
│  │ GridCore  │  │  Arrow IPC Buffer  │  │  DuckDB   │  │
│  │ DataStore │  │  ←──────────────   │  │   WASM    │  │
│  └───────────┘  │  Arrow IPC Buffer  │  └───────────┘  │
└─────────────────┘                    └─────────────────┘
```

### 기존 Worker 문제와의 차이점

| 항목 | Arquero + Worker (009) | DuckDB + Worker (제안) |
|------|----------------------|---------------------|
| 데이터 포맷 | JS Object | Apache Arrow |
| 전송 방식 | Structured Clone | Transferable (Zero-copy) |
| 직렬화 비용 | 300-1000ms | **~0ms** |
| 연산 성능 | 중간 | **5-10배 빠름** |
| 피벗 지원 | JS 수동 구현 | **SQL PIVOT 문법** |

---

## WASM 안정성 (Memory64)

### 과거의 "2GB 문제"

과거 WASM이 "가끔 죽는다"는 문제의 주요 원인:
- **32비트 메모리 주소 체계**: 이론적 최대 4GB
- **브라우저의 보수적 태도**: 실제로는 1-2GB에서 강제 종료
- **JS와의 차이**: JS는 GC로 버티지만, WASM은 메모리 범위 초과 시 즉시 `RuntimeError: memory access out of bounds`

### WASM 3.0 (Memory64) - 해결됨

**2025-2026년 현재, 주요 브라우저들이 Memory64를 지원합니다.**

| 항목 | 32-bit WASM | Memory64 (64-bit) |
|------|-------------|-------------------|
| 주소 공간 | 4GB (실제 2GB) | 이론상 16 exabytes, **실제 ~15GB** |
| Chrome | 지원 | **133+ 지원** |
| Firefox | 지원 | **134+ 지원** |
| Safari | 지원 | ⚠️ **아직 구현 단계** |
| DuckDB-Wasm | 32-bit 빌드 | **Memory64 전용 빌드 제공** |

### ⚠️ Memory64 성능 트레이드오프

**중요: Memory64는 10-100% 성능 저하가 발생할 수 있습니다.**

| 모드 | 장점 | 단점 | 권장 상황 |
|------|------|------|----------|
| **32-bit** | 빠름 (bounds check 최적화) | 4GB 제한 | 데이터 < 4GB |
| **64-bit** | 메모리 제한 해제 | 10-100% 느림 | 데이터 > 4GB |

성능 저하 원인:
- 64-bit 포인터로 인한 **bounds checking 오버헤드**
- 메모리 접근 시 추가 검증 필요

### ⚠️ 빌드 선택은 앱 초기화 시점에 결정됨

**중요: Memory32/64는 런타임에 전환할 수 없습니다.**

WASM 메모리 모델은 모듈 컴파일 시점에 결정되므로, DuckDB-Wasm은 **별도의 빌드 파일**을 제공합니다:

```
DuckDB-Wasm 빌드 구조:
├── duckdb-eh.wasm           (32-bit, ~10MB)
├── duckdb-eh-memory64.wasm  (64-bit, ~10MB)  ← 별도 파일
├── duckdb-mvp.wasm          (32-bit, 구형 브라우저용)
└── ...
```

**따라서 앱 설계 시 다음을 결정해야 합니다:**

| 전략 | 설명 | 권장 상황 |
|------|------|----------|
| **32-bit 고정** | 항상 32-bit 빌드 로드 | 데이터 < 4GB 확실 |
| **64-bit 고정** | 항상 64-bit 빌드 로드 | 대용량 처리 필수 |
| **조건부 선택** | 앱 시작 시 빌드 선택 | 유연한 대응 필요 |

### 권장 전략: 앱 초기화 시 빌드 선택

```typescript
import * as duckdb from '@duckdb/duckdb-wasm';

// 빌드 번들 정의
const DUCKDB_BUNDLES = {
  // 32-bit 빌드 (성능 우선, 4GB 제한)
  eh: {
    mainModule: '/duckdb-eh.wasm',
    mainWorker: '/duckdb-browser-eh.worker.js',
  },
  // 64-bit 빌드 (메모리 우선, 10-100% 느림)
  eh_memory64: {
    mainModule: '/duckdb-eh-memory64.wasm',
    mainWorker: '/duckdb-browser-eh.worker.js',
  },
};

// Memory64 지원 여부 확인
function isMemory64Supported(): boolean {
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 2, index: 'i64' } as any);
    return true;
  } catch {
    return false;  // Safari 등
  }
}

// 앱 초기화 시 빌드 선택 (한 번만 실행)
async function initDuckDB(config: { useMemory64: boolean }) {
  const { useMemory64 } = config;

  // Memory64 요청했지만 미지원인 경우
  if (useMemory64 && !isMemory64Supported()) {
    console.warn('Memory64 not supported. Falling back to 32-bit.');
    // 사용자에게 경고: "4GB 이상 데이터는 처리할 수 없습니다"
  }

  const bundle = useMemory64 && isMemory64Supported()
    ? DUCKDB_BUNDLES.eh_memory64
    : DUCKDB_BUNDLES.eh;

  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule);

  return db;
}

// 사용 예시
const db = await initDuckDB({
  useMemory64: false,  // 500만 건 × 10컬럼 ≈ 1.3GB → 32-bit로 충분
});
```

### 런타임 전환이 필요한 경우

만약 사용 중 4GB를 초과해야 하는 상황이 발생하면:

```typescript
class DuckDBManager {
  private db: duckdb.AsyncDuckDB | null = null;
  private useMemory64: boolean;

  async reinitializeWith64Bit(): Promise<void> {
    if (this.useMemory64) return;  // 이미 64-bit

    // 1. 기존 인스턴스 정리
    await this.db?.terminate();

    // 2. 64-bit 빌드로 재초기화
    this.db = await initDuckDB({ useMemory64: true });
    this.useMemory64 = true;

    // 3. 데이터 재로드 필요!
    // → 테이블 데이터가 모두 사라짐
    console.warn('DuckDB reinitialized. All data must be reloaded.');
  }
}
```

**주의**: 재초기화 시 **모든 테이블 데이터가 사라집니다**. 따라서 앱 설계 시 예상 데이터 규모를 미리 파악하여 적절한 빌드를 선택하는 것이 중요합니다.

---

## 메모리 점유량 예측

### 1,000만 건 (그리드 2개 × 500만 건), 10개 컬럼 기준

| 구분 | 메모리 점유 (예상) | 상세 설명 |
|------|------------------|----------|
| 엔진 기본 점유 (Base) | ~100MB | DuckDB-Wasm 인스턴스 및 워커 구동 비용 |
| 데이터 적재 (Storage) | ~400MB - 600MB | 1,000만 건 적재 시 (컬럼 10개, 압축 적용) |
| 필터/정렬 작업 (Active) | +200MB - 400MB | 정렬용 인덱스 및 임시 버퍼 공간 |
| 피봇팅 작업 (Peak) | +400MB - 800MB | 해시 테이블 생성 및 그룹화 연산 |
| **최종 예상 합계** | **약 1.1GB - 1.9GB** | 데스크톱 브라우저 안정권 |

### 컬럼 수에 따른 메모리 변화 (1,000만 건 기준)

| 컬럼 수 | 저장 메모리 | 연산 피크 | 합계 | 평가 |
|--------|-----------|----------|------|------|
| 5개 | ~300MB | +300MB | ~0.7GB | 매우 쾌적 |
| 10개 | ~600MB | +600MB | ~1.3GB | 일반적 |
| 20개 | ~1.2GB | +800MB | ~2.1GB | 주의 필요 |
| 50개 | ~3.0GB | +1.5GB | ~4.5GB | Memory64 필수 |

### 메모리 결정 요소

1. **최고 효율**: 고정 숫자(날짜, 금액, ID), 중복 많은 문자열(지역명, 부서명) → 80-90% 압축
2. **최악 효율**: 중복 없는 긴 고유 문자열(설명글, 주소, 해시값) → 압축 안됨

---

## 성능 벤치마크 (외부 자료)

### DuckDB-Wasm vs Arquero 비교

[timlrx/browser-data-processing-benchmarks](https://github.com/timlrx/browser-data-processing-benchmarks) 기준 (100만 건):

| 테스트 | Arquero | DuckDB-Wasm | 비율 |
|--------|---------|-------------|------|
| 데이터 로드 | 2.866s | 4.309s | 0.67x (느림) |
| 집계 쿼리 | 0.067s | **0.014s** | **4.8x 빠름** |
| 그룹화 쿼리 | 1.05s | **0.163s** | **6.4x 빠름** |

### TPC-H 벤치마크 (DuckDB 공식)

- DuckDB-Wasm이 Arquero보다 **10-100배 빠름** (TPC-H SF-0.01 ~ SF-1)

---

## 아키텍처 설계

### 권장: 전역 단일 워커 (Singleton Pattern)

**그리드당 인스턴스 생성이 위험한 이유:**
- DuckDB-Wasm은 가벼운 JS 라이브러리가 아닌 **C++로 만든 데이터베이스 통째**
- 엔진 기본 점유량 (~50-100MB)이 그리드 개수만큼 배수로 증가
- 여러 WASM 인스턴스가 메모리 경쟁 → 브라우저가 "불안정한 탭"으로 판단하여 강제 종료

```
권장 아키텍처: 전역 단일 워커 + 가상 테이블 관리

┌─────────────────────────────────────────────────────────┐
│                      Main Thread                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Grid A    │  │   Grid B    │  │   Grid C    │     │
│  │  (500만건)  │  │  (500만건)  │  │  (100만건)  │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          │                              │
│                   ┌──────▼──────┐                       │
│                   │ WorkerBridge │                      │
│                   │  (Singleton) │                      │
│                   └──────┬──────┘                       │
└──────────────────────────┼──────────────────────────────┘
                           │ Arrow IPC (Transferable)
┌──────────────────────────┼──────────────────────────────┐
│                   Web Worker                            │
│                   ┌──────▼──────┐                       │
│                   │ DuckDB-Wasm │                       │
│                   │  (단일 인스턴스)                    │
│                   └─────────────┘                       │
│                          │                              │
│    ┌─────────────────────┼─────────────────────┐       │
│    │                     │                     │        │
│    ▼                     ▼                     ▼        │
│ table_grid_A       table_grid_B         table_grid_C   │
│ (500만 건)         (500만 건)           (100만 건)      │
└─────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

1. **App Level**: 앱 시작 시 단 하나의 웹 워커와 DuckDB-Wasm 실행
2. **Grid Level**: 각 그리드는 전역 DuckDB에 "내 데이터 처리해줘" 요청만 전송
3. **Data Management**: 테이블 이름에 ID 부여 (`table_grid_A`, `table_grid_B`)
4. **Cleanup**: 그리드 unmount 시 `DROP TABLE IF EXISTS table_grid_A` 실행

### 인스턴스 접근 패턴

**전역 싱글톤 + 옵셔널 주입** 방식을 권장합니다.

```typescript
// src/services/DuckDBService.ts
class DuckDBService {
  private static instance: DuckDBService | null = null;
  private db: AsyncDuckDB | null = null;

  static getInstance(): DuckDBService {
    if (!DuckDBService.instance) {
      DuckDBService.instance = new DuckDBService();
    }
    return DuckDBService.instance;
  }

  async getDB(): Promise<AsyncDuckDB> {
    if (!this.db) {
      this.db = await this.initialize();
    }
    return this.db;
  }
}

// 그리드에서 사용
class GridCore {
  private duckdb: DuckDBService;

  constructor(options: GridOptions) {
    // 외부 주입이 있으면 사용, 없으면 전역 싱글톤
    this.duckdb = options.duckdbService ?? DuckDBService.getInstance();
  }

  async loadData(data: Row[]): Promise<void> {
    const db = await this.duckdb.getDB();
    await db.query(`CREATE TABLE ${this.tableId} AS ...`);
  }
}
```

**장점:**
- 기본적으로 전역 싱글톤 사용 (설정 없이 동작)
- 테스트 시 Mock 주입 가능
- 여러 그리드가 하나의 DuckDB 인스턴스 공유

---

## 안정성 확보 전략

### 1. Worker 부활 로직 (Phoenix Pattern)

```typescript
// 메인 스레드
class DuckDBWorkerBridge {
  private worker: Worker | null = null;
  private restartCount = 0;
  private maxRestarts = 3;

  async initialize(): Promise<void> {
    this.worker = new Worker('/duckdb.worker.js');

    // 워커 에러 감지
    this.worker.onerror = (error) => {
      console.error('Worker crashed:', error);
      this.handleWorkerCrash();
    };

    // 워커 메시지 에러 감지
    this.worker.onmessageerror = (error) => {
      console.error('Worker message error:', error);
      this.handleWorkerCrash();
    };
  }

  private async handleWorkerCrash(): Promise<void> {
    if (this.restartCount >= this.maxRestarts) {
      throw new Error('DuckDB Worker crashed too many times');
    }

    this.restartCount++;
    console.log(`Restarting worker (attempt ${this.restartCount}/${this.maxRestarts})`);

    // 워커 종료 및 재시작
    this.worker?.terminate();
    await this.initialize();

    // 사용자에게 알림
    this.emit('workerRestarted', { attempt: this.restartCount });
  }
}
```

### 2. 메모리 제한 설정 (Memory Capping)

```typescript
// Worker 내부
const db = await duckdb.AsyncDuckDB.create({
  // 최대 메모리 제한 (브라우저가 죽이기 전에 DuckDB가 에러 던지도록)
  maximumMemory: 2 * 1024 * 1024 * 1024, // 2GB
});

// 메모리 사용량 모니터링
async function checkMemoryUsage(): Promise<number> {
  const result = await db.query(`
    SELECT
      memory_usage_bytes / 1024 / 1024 as memory_mb
    FROM duckdb_memory()
  `);
  return result.get(0).memory_mb;
}
```

### 3. 연결 및 문(Statement) 관리

```typescript
// 반드시 conn.close() 호출
async function executeQuery(sql: string): Promise<Arrow.Table> {
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result;
  } finally {
    await conn.close(); // 메모리 누수 방지
  }
}

// 오래 걸리는 쿼리는 취소 기능 제공
async function executeWithTimeout(sql: string, timeoutMs: number): Promise<Arrow.Table> {
  const conn = await db.connect();
  const timeoutId = setTimeout(() => conn.cancelSent(), timeoutMs);

  try {
    const result = await conn.query(sql);
    clearTimeout(timeoutId);
    return result;
  } finally {
    await conn.close();
  }
}
```

### 4. 쿼리 제한 (Query Guard)

```typescript
// 연산 큐로 순차적 처리 (메모리 피크 중첩 방지)
class QueryQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  async enqueue<T>(queryFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await queryFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await task();
    }
    this.processing = false;
  }
}
```

---

## 최적화 전략

### 1. Projection Pushdown (필요한 컬럼만 SELECT)

```typescript
// ❌ 비효율적: 모든 컬럼 로드
const result = await db.query(`SELECT * FROM sales`);

// ✅ 효율적: 피봇에 필요한 컬럼만
const result = await db.query(`
  SELECT region, product, amount
  FROM sales
`);

// 사용자가 숨긴 컬럼은 제외
function buildSelectClause(visibleColumns: string[]): string {
  return visibleColumns.join(', ');
}
```

### 2. 데이터 타입 최적화

```typescript
// 문자열이지만 실제로 숫자인 경우 캐스팅 (메모리 4-5배 효율)
await db.query(`
  CREATE TABLE sales AS
  SELECT
    CAST(id AS INTEGER) as id,
    CAST(amount AS DOUBLE) as amount,
    region,  -- 카테고리성 문자열은 자동 딕셔너리 압축
    product
  FROM raw_data
`);
```

### 3. 스트리밍 처리 (청크 단위)

```typescript
// ❌ 500만 건 한번에 가져오기
const all = await db.query(`SELECT * FROM large_table`);

// ✅ 청크 단위로 스트리밍
async function* streamResults(sql: string, chunkSize: number = 10000) {
  const conn = await db.connect();
  try {
    let offset = 0;
    while (true) {
      const chunk = await conn.query(`
        ${sql} LIMIT ${chunkSize} OFFSET ${offset}
      `);
      if (chunk.numRows === 0) break;
      yield chunk;
      offset += chunkSize;
    }
  } finally {
    await conn.close();
  }
}

// 가상 스크롤러가 필요한 범위만 요청
async function getVisibleRows(startRow: number, endRow: number): Promise<Arrow.Table> {
  const limit = endRow - startRow;
  return await db.query(`
    SELECT * FROM filtered_data
    LIMIT ${limit} OFFSET ${startRow}
  `);
}
```

### 4. Arrow 바이너리 직접 전송

```typescript
// ❌ JSON 변환 (메모리 낭비)
const jsonData = arrowTable.toArray().map(row => row.toJSON());
postMessage({ type: 'result', data: jsonData });

// ✅ Arrow IPC 바이너리 직접 전송 (Zero-copy)
const ipcBuffer = arrowTable.serialize();
postMessage({ type: 'result', data: ipcBuffer }, [ipcBuffer.buffer]);
```

---

## 파일 구조 설계

```
src/processor/
├── index.ts                    # 엔트리 (IDataProcessor export)
├── DuckDBProcessor.ts          # DuckDB 기반 프로세서 (NEW)
├── DuckDBWorkerBridge.ts       # Worker 통신 래퍼 (NEW)
├── duckdb.worker.ts            # Worker 스크립트 (NEW)
├── QueryQueue.ts               # 순차 처리 큐 (NEW)
├── ArqueroProcessor.ts         # 기존 (폴백용 유지)
└── PivotProcessor.ts           # 삭제 예정 (SQL PIVOT으로 대체)

src/types/
├── processor.types.ts          # 기존 타입 + DuckDB 확장
└── duckdb.types.ts             # DuckDB 전용 타입 (NEW)
```

---

## 구현 단계 (상세)

### Phase 1: 기반 구축 (1주)

**목표**: DuckDB-Wasm + Worker 환경 설정 및 기본 동작 확인

| 작업 | 세부 내용 | 산출물 |
|------|----------|--------|
| DuckDB-Wasm 설치 | `@duckdb/duckdb-wasm` 패키지 추가 | package.json |
| Worker 설정 | Vite worker 설정, Memory64 빌드 | vite.config.ts |
| WorkerBridge 구현 | 메시지 기반 통신 래퍼 | DuckDBWorkerBridge.ts |
| Phoenix Pattern | Worker 크래시 감지 및 자동 복구 | 에러 핸들링 로직 |
| 기본 벤치마크 | 100만 건 로드/쿼리 성능 측정 | 벤치마크 결과 |

### Phase 2: Processor 교체 (2주)

**목표**: ArqueroProcessor와 동일한 인터페이스로 DuckDBProcessor 구현

| 작업 | 세부 내용 | 산출물 |
|------|----------|--------|
| IDataProcessor 구현 | sort, filter, query, aggregate | DuckDBProcessor.ts |
| Arrow 변환 레이어 | JS Object ↔ Arrow Table 변환 | ArrowConverter.ts |
| QueryQueue 구현 | 순차 처리로 메모리 피크 방지 | QueryQueue.ts |
| 메모리 모니터링 | 사용량 추적 및 경고 | MemoryMonitor.ts |
| 기존 테스트 통과 | ArqueroProcessor 테스트 케이스 재사용 | 테스트 결과 |

### Phase 3: 피벗 마이그레이션 (2주)

**목표**: 1248줄 PivotProcessor를 SQL PIVOT으로 대체

| 작업 | 세부 내용 | 산출물 |
|------|----------|--------|
| SQL PIVOT 구현 | 기본 피벗 쿼리 생성 | PivotQueryBuilder.ts |
| 소계/총합계 | GROUPING SETS 또는 UNION ALL | 소계 SQL |
| 헤더 트리 생성 | 피벗 결과에서 헤더 구조 추출 | HeaderTreeBuilder.ts |
| 기존 API 호환 | PivotResult 인터페이스 유지 | 타입 호환 |
| 성능 비교 | Arquero vs DuckDB 피벗 벤치마크 | 벤치마크 결과 |

**SQL PIVOT 예시:**
```sql
-- 기본 피벗
PIVOT sales ON month USING sum(amount) GROUP BY product;

-- 소계 포함 (GROUPING SETS)
SELECT
  COALESCE(product, 'TOTAL') as product,
  month,
  SUM(amount) as amount
FROM sales
GROUP BY GROUPING SETS (
  (product, month),
  (product),
  ()
);
```

### Phase 4: 레이지 로딩 (1주)

**목표**: 대용량 데이터의 점진적 로딩 지원

| 작업 | 세부 내용 | 산출물 |
|------|----------|--------|
| 청크 로딩 | 데이터를 분할하여 점진적 로드 | ChunkLoader.ts |
| 가상 스크롤 연동 | 보이는 범위만 쿼리 | OFFSET/LIMIT 쿼리 |
| Parquet 지원 (선택) | HTTP Range Request | Parquet 로더 |
| 로딩 상태 UI | 진행률 표시 | 프로그레스 콜백 |

---

## 테이블 생명주기 관리

### 그리드 마운트 시

```typescript
// 그리드 A가 마운트될 때
async function onGridMount(gridId: string, data: Row[]): Promise<void> {
  const tableName = `table_${gridId}`;

  // Arrow로 변환하여 Worker에 전송
  const arrowBuffer = convertToArrow(data);

  await workerBridge.send({
    type: 'CREATE_TABLE',
    payload: {
      tableName,
      data: arrowBuffer,
    }
  }, [arrowBuffer.buffer]);
}
```

### 그리드 언마운트 시

```typescript
// 그리드 A가 언마운트될 때
async function onGridUnmount(gridId: string): Promise<void> {
  const tableName = `table_${gridId}`;

  // 테이블 삭제 (메모리 해제)
  await workerBridge.send({
    type: 'DROP_TABLE',
    payload: { tableName }
  });
}
```

### Worker 내부

```typescript
// duckdb.worker.ts
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'CREATE_TABLE':
      await db.query(`
        DROP TABLE IF EXISTS ${payload.tableName}
      `);
      await db.registerFileBuffer(
        `${payload.tableName}.arrow`,
        payload.data
      );
      await db.query(`
        CREATE TABLE ${payload.tableName} AS
        SELECT * FROM '${payload.tableName}.arrow'
      `);
      break;

    case 'DROP_TABLE':
      await db.query(`
        DROP TABLE IF EXISTS ${payload.tableName}
      `);
      break;
  }
};
```

---

## 결론

### 기술적 타당성: **높음**

1. **Memory64로 2GB 제한 해결**: 1,000만 건 처리 가능
2. **Arrow Zero-copy로 직렬화 비용 제거**: 009 문서의 Worker 제거 이유 해소
3. **5-10배 성능 향상**: 분석 쿼리에서 유의미한 개선
4. **SQL PIVOT으로 복잡도 감소**: 1248줄 → SQL 몇 줄

### 주의 사항

1. **번들 사이즈**: ~3.5MB (필요 시 CDN 분리 로드)
2. **초기 로드 시간**: WASM 초기화 오버헤드
3. **메모리 관리 필수**: 테이블 클린업, 쿼리 제한, 모니터링
4. **Memory64 성능 트레이드오프**: 4GB 이상 필요시에만 64-bit 사용 (10-100% 느림)
5. **Safari 지원 제한**: Memory64 미지원, 4GB 초과 시 폴백 필요

### 다음 단계

1. **PoC 진행**: 실제 데이터로 500만 건 벤치마크
2. **메모리 프로파일링**: `Performance.memory` API로 피크 측정
3. **최종 결정**: PoC 결과에 따라 마이그레이션 착수

---

## 참고 자료

- [DuckDB-Wasm GitHub](https://github.com/duckdb/duckdb-wasm)
- [DuckDB PIVOT Documentation](https://duckdb.org/docs/stable/sql/statements/pivot)
- [DuckDB-Wasm vs X Benchmark](https://shell.duckdb.org/versus)
- [Browser Data Processing Benchmarks](https://github.com/timlrx/browser-data-processing-benchmarks)
- [DuckDB-Wasm: Fast Analytical Processing for the Web (VLDB Paper)](https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf)
- [WebAssembly Memory64 Proposal](https://github.com/WebAssembly/memory64)
- [WebAssembly 3.0 변화 정리](https://qkrdkwl9090.tistory.com/15) - Memory64 성능 트레이드오프, 브라우저 지원 현황
