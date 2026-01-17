# ADR-001: Worker 환경 지원 전략

## 상태
**검토 중** (Pending)

## 날짜
2026-01-17

## 맥락 (Context)

Grid 라이브러리의 핵심 기능 중 하나는 100만 건 이상의 데이터를 처리할 때 UI가 블로킹되지 않도록 Web Worker에서 데이터 처리(정렬, 필터링 등)를 수행하는 것입니다.

현재 구현은 브라우저의 Web Worker API만 지원합니다:
```typescript
this.worker = new Worker(
  new URL('./worker.ts', import.meta.url),
  { type: 'module' }
);
```

### 문제점

1. **Node.js 테스트 환경**: `Worker`가 정의되어 있지 않음
2. **SSR (Server-Side Rendering)**: 서버에서 Grid를 사전 렌더링할 때 Worker 사용 불가
3. **CLI 도구**: Node.js 기반 도구에서 라이브러리 사용 시 Worker 없음

## 고려한 옵션들

### 옵션 A: 환경 감지 자동 분기

```typescript
// WorkerBridge.ts
async initialize(): Promise<void> {
  if (typeof window !== 'undefined') {
    // 브라우저: Web Worker
    this.worker = new Worker(new URL('./worker.ts', import.meta.url));
  } else {
    // Node.js: worker_threads
    const { Worker } = await import('worker_threads');
    this.worker = new Worker('./dist/worker.cjs');
  }
}
```

**장점:**
- 사용자가 환경을 신경 쓸 필요 없음
- 양쪽 환경에서 병렬 처리 가능

**단점:**
- 빌드 설정 복잡 (브라우저/Node.js 각각의 Worker 번들 필요)
- Node.js worker_threads와 Web Worker API 차이 처리 필요
- 메시지 직렬화 방식 차이 (Transferable vs SharedArrayBuffer)

### 옵션 B: useWorker 옵션

```typescript
const grid = new GridCore({
  columns,
  useWorker: false  // Worker 비활성화
});
```

**장점:**
- 구현 단순
- 테스트 용이
- SSR/CLI 지원 쉬움

**단점:**
- `useWorker: false` 시 메인 스레드에서 처리 (UI 블로킹 가능)
- 사용자가 환경에 따라 옵션 설정 필요

### 옵션 C: 테스트용 Polyfill 사용

Vitest의 `@vitest/web-worker` 플러그인 사용:

```typescript
// vite.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Web Worker 시뮬레이션
  }
});
```

**장점:**
- 기존 코드 수정 없음
- 테스트에서 실제 Worker 동작과 유사하게 테스트

**단점:**
- 테스트 환경만 해결, SSR/CLI는 별도 해결 필요

## 결정 (Decision)

**미정** - 추후 논의 필요

현재는 **옵션 C**를 사용하여 테스트 환경을 먼저 구축합니다.
SSR/Node.js 지원이 필요해지면 **옵션 B**를 추가로 구현할 예정입니다.

## 관련 이슈

- Node.js `worker_threads` 모듈: https://nodejs.org/api/worker_threads.html
- Web Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Worker
- Vitest Web Worker: https://vitest.dev/guide/features.html#web-workers

## 참고 사항

### Worker API 차이점

| 기능 | Web Worker | Node.js worker_threads |
|------|------------|------------------------|
| 생성 | `new Worker(url)` | `new Worker(path)` |
| 메시지 전송 | `postMessage(data, transfer)` | `postMessage(data)` |
| Transferable | ✅ ArrayBuffer 등 | ❌ (SharedArrayBuffer 사용) |
| 모듈 타입 | `{ type: 'module' }` | `{ eval: false }` |

### 테스트 전략

1. **단위 테스트**: `@vitest/web-worker` 사용
2. **E2E 테스트**: 실제 브라우저에서 테스트 (Playwright 등)
3. **성능 테스트**: 브라우저에서 100만 건 데이터로 측정
