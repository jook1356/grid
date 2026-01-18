# 007. 데이터 로딩 API 다양화

## 상태
제안됨 (Proposed)

## 배경

### 현재 상황
```typescript
// 현재 API - 객체 배열만 지원
await gridCore.loadData(data: Row[]);
```

현재 `loadData`는 객체 배열만 받습니다. 내부적으로 Web Worker(`ArqueroProcessor`)로 전송하여 처리합니다.

### 문제점
대량 데이터(100만+ 행) 로드 시 **메인 스레드 블로킹**이 발생합니다.

```
사용자 코드 (메인 스레드)
    ↓ loadData(data)
GridCore (메인 스레드)
    ↓ WorkerBridge.postMessage(data)  ← ⚠️ Structured Clone (복제)
ArqueroProcessor (워커)
```

`postMessage()`의 **Structured Clone Algorithm**은:
- 모든 객체를 직렬화/역직렬화
- 대량 데이터 시 수백 ms ~ 수 초 소요
- 이 과정이 **메인 스레드를 블로킹**

---

## 제안: 다양한 데이터 로딩 방식 지원

### 1. 기본 API (현재, 유지)
```typescript
// 가장 간단한 사용법 - 소량 데이터에 적합
await gridCore.loadData(data: Row[]);
```
- **장점**: 사용하기 쉬움, 별도 설정 불필요
- **단점**: 대량 데이터 시 메인 스레드 블로킹
- **적합**: 10만 행 이하

---

### 2. Transferable ArrayBuffer
```typescript
// 바이너리 데이터 직접 전달 - 복제 비용 거의 0
await gridCore.loadDataFromBuffer(buffer: ArrayBuffer, schema: ColumnSchema[]);
```

**작동 원리:**
```
사용자 코드
    ↓ ArrayBuffer 생성
GridCore
    ↓ postMessage(buffer, [buffer])  ← Transfer (소유권 이전, 복제 없음!)
ArqueroProcessor
    ↓ ArrayBuffer 디코딩
```

**장점:**
- 복제 비용 **O(1)** - 버퍼 크기와 무관
- 가장 빠른 전송 방식

**단점:**
- 사용자가 데이터를 ArrayBuffer로 인코딩해야 함
- 스키마(컬럼 타입) 정보 별도 전달 필요

**적합한 상황:**
- 서버에서 바이너리 형식으로 데이터 수신
- 다른 워커에서 데이터 생성
- 100만+ 행 대량 데이터

---

### 3. Apache Arrow 포맷
```typescript
// Arrow IPC 포맷 - 컬럼 기반 바이너리
await gridCore.loadDataFromArrow(arrowBuffer: ArrayBuffer);
```

**Apache Arrow란?**
- 컬럼 기반 메모리 포맷의 표준
- 언어/플랫폼 간 호환 (Python pandas, R, Spark 등)
- Arquero가 네이티브 지원

**작동 원리:**
```
사용자 코드 / 서버
    ↓ Arrow IPC 포맷 데이터
GridCore
    ↓ postMessage(buffer, [buffer])  ← Transfer
ArqueroProcessor
    ↓ aq.fromArrow(buffer)  ← 직접 로드 (파싱 최소화)
```

**장점:**
- Transfer + 파싱 최소화 = **최고 성능**
- 스키마 정보 포함 (별도 전달 불필요)
- 서버-클라이언트 간 표준 포맷
- 타입 안전성 (숫자/문자열/날짜 등 명확)

**단점:**
- Arrow 라이브러리 의존성 추가 (~200KB gzipped)
- 서버 측에서도 Arrow 지원 필요

**적합한 상황:**
- 서버가 Arrow 포맷 지원
- Python/R 데이터 분석 환경과 연동
- 최고 성능 필요

---

### 4. 워커 직접 연결 (MessageChannel)
```typescript
// 다른 워커와 직접 통신 - 메인 스레드 우회
const channel = new MessageChannel();
gridCore.connectDataSource(channel.port1);
myDataWorker.postMessage({ port: channel.port2 }, [channel.port2]);
```

**작동 원리:**
```
사용자 워커 (데이터 생성)
    ↓ MessageChannel.port
    ↓ ─────────────────────────→ ArqueroProcessor (직접 연결)
    
메인 스레드는 연결 설정만, 데이터는 거치지 않음
```

**장점:**
- 메인 스레드 **완전히 우회**
- 대량 데이터도 UI 블로킹 없음

**단점:**
- 구현 복잡도 높음
- 사용자가 워커 관리 필요
- 에러 핸들링 복잡

**적합한 상황:**
- 실시간 데이터 스트림 (WebSocket → 워커 → 그리드)
- 복잡한 데이터 파이프라인

---

### 5. 스트리밍 API
```typescript
// 청크 단위 로드 - UI 반응성 유지
await gridCore.loadDataStream(
  asyncIterable: AsyncIterable<Row[]>,
  options?: { chunkSize?: number; onProgress?: (percent: number) => void }
);

// 사용 예시
async function* fetchDataChunks() {
  for (let page = 0; page < totalPages; page++) {
    const chunk = await fetch(`/api/data?page=${page}`);
    yield await chunk.json();
  }
}

await gridCore.loadDataStream(fetchDataChunks(), {
  onProgress: (p) => console.log(`${p}% 로드됨`)
});
```

**작동 원리:**
```
AsyncIterable
    ↓ chunk 1 (10만 건)
GridCore → 워커 (처리) → UI 업데이트
    ↓ chunk 2 (10만 건)
GridCore → 워커 (처리) → UI 업데이트
    ...
```

**장점:**
- 청크 사이에 **UI 업데이트 기회**
- 프로그레스 표시 가능
- 서버 페이지네이션과 자연스럽게 연동
- 메모리 효율적 (전체 데이터를 한 번에 메모리에 올리지 않음)

**단점:**
- 전체 로드 시간은 비슷하거나 약간 길어질 수 있음
- 정렬/필터링은 전체 데이터 로드 후 가능

**적합한 상황:**
- 서버에서 페이지네이션으로 데이터 제공
- 점진적 로딩 UX
- 메모리 제한 환경

---

### 6. URL 직접 로드
```typescript
// URL에서 직접 로드 - 워커에서 fetch
await gridCore.loadDataFromURL(url: string, options?: {
  format: 'json' | 'csv' | 'arrow';
  headers?: Record<string, string>;
});
```

**작동 원리:**
```
GridCore (메인 스레드)
    ↓ URL만 전달
ArqueroProcessor (워커)
    ↓ fetch(url)  ← 워커에서 직접 다운로드
    ↓ 파싱 및 처리
```

**장점:**
- 메인 스레드에서 데이터 핸들링 **완전히 제거**
- 네트워크 → 워커 → 처리가 한 곳에서
- CSV 등 다양한 포맷 지원 가능 (Arquero 활용)

**단점:**
- CORS 설정 필요
- 인증 헤더 등 복잡한 요청 처리
- 오프라인 데이터 불가

**적합한 상황:**
- REST API에서 데이터 로드
- CSV/JSON 파일 직접 로드
- 간단한 데이터 소스

---

## API 요약

| API | 복제 비용 | UI 블로킹 | 사용 난이도 | 권장 데이터 크기 |
|-----|----------|----------|------------|----------------|
| `loadData(Row[])` | O(n) | 있음 | ⭐ 쉬움 | ~10만 행 |
| `loadDataFromBuffer()` | O(1) | 없음 | ⭐⭐ 중간 | 100만+ 행 |
| `loadDataFromArrow()` | O(1) | 없음 | ⭐⭐ 중간 | 100만+ 행 |
| `connectDataSource()` | O(1) | 없음 | ⭐⭐⭐ 복잡 | 실시간 스트림 |
| `loadDataStream()` | O(n) | 최소화 | ⭐⭐ 중간 | 대량 + UX 중요 |
| `loadDataFromURL()` | 없음 | 없음 | ⭐ 쉬움 | 모든 크기 |

---

## 구현 우선순위

### Phase 1 (단기)
1. **`loadDataStream()`** - 청크 분할로 UI 반응성 개선
2. **`loadDataFromURL()`** - 워커에서 직접 fetch

### Phase 2 (중기)
3. **`loadDataFromArrow()`** - Arrow 포맷 지원
4. **`loadDataFromBuffer()`** - 커스텀 바이너리 지원

### Phase 3 (장기)
5. **`connectDataSource()`** - 워커 직접 연결

---

## 내부 구현 고려사항

### WorkerBridge 확장
```typescript
interface WorkerBridge {
  // 현재
  postMessage(data: unknown): Promise<unknown>;
  
  // 추가
  postTransferable(data: unknown, transferables: Transferable[]): Promise<unknown>;
  connectPort(port: MessagePort): void;
}
```

### ArqueroProcessor 확장
```typescript
// 메시지 타입 추가
type ProcessorMessage =
  | { type: 'loadData'; data: Row[] }
  | { type: 'loadBuffer'; buffer: ArrayBuffer; schema: ColumnSchema[] }
  | { type: 'loadArrow'; buffer: ArrayBuffer }
  | { type: 'loadURL'; url: string; format: string }
  | { type: 'loadChunk'; chunk: Row[]; isLast: boolean };
```

---

## 결론

다양한 데이터 로딩 방식을 지원하여:
1. **소량 데이터**: 간단한 API (`loadData`)
2. **대량 데이터**: 최적화된 API (`Arrow`, `Buffer`)
3. **UX 중요**: 스트리밍 API (`loadDataStream`)
4. **서버 연동**: URL 직접 로드 (`loadDataFromURL`)

사용자가 상황에 맞는 최적의 방식을 선택할 수 있도록 합니다.
