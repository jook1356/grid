# 26회차: 웹 워커 / 레이지 로딩 도입

## 개요

커밋: `af65ceb` (2026-01-28)

엔진 추상화 아키텍처(25회차)를 기반으로, Web Worker 실행 경로와 가상 데이터 로딩(레이지 로딩)을 도입했습니다. 대량 데이터 처리 시 UI 블로킹을 방지하고, 화면에 보이는 행만 Worker에서 요청하여 메모리 사용을 최적화합니다.

## 왜 이게 필요한가?

### 배경

기존에는 Worker를 제거하고 메인 스레드에서 직접 처리하는 방식이었습니다(009 결정). 하지만 엔진 추상화(021 결정) 이후 다시 Worker를 선택적으로 사용할 수 있게 되면서, 대량 데이터에서의 UI 블로킹 문제를 해결할 수 있게 되었습니다.

**핵심 문제**: 100만 건 데이터를 메인 스레드에서 처리하면 UI가 멈춤

**해결**: `useWorker: true` 옵션으로 Worker에서 처리, 화면에 보이는 행만 요청

## 무엇을 했나?

### 1. Worker 실행 경로 구현

| 모듈 | 파일 | 역할 |
|------|------|------|
| WorkerProcessor | `src/processor/WorkerProcessor.ts` | Worker 브릿지 (메시지 송수신) |
| processorWorker | `src/processor/processorWorker.ts` | Worker 스크립트 (엔진 실행) |
| MainThreadProcessor | `src/processor/MainThreadProcessor.ts` | 메인 스레드 실행 |
| ProcessorFactory | `src/processor/ProcessorFactory.ts` | 조합별 프로세서 생성 팩토리 |

### 2. 가상 데이터 로딩 (RowCache)

| 모듈 | 파일 | 역할 |
|------|------|------|
| RowCache | `src/core/RowCache.ts` | LRU 기반 행 캐시 |

Worker 모드에서 전체 데이터를 메인 스레드로 복사하지 않고, 화면에 보이는 행만 요청합니다:

```
Worker: 전체 데이터 보유 + 인덱스 관리
Main Thread: 보이는 행만 요청 (예: 50행)
→ 100만 건이어도 전송되는 데이터는 ~50행만
```

- 캐시 미스 시 Worker에 `fetchVisibleRows()` 요청
- 스크롤 방향 기반 프리페치 (`prefetchForScroll`)
- 요청 병합 디바운스 (`prefetchDebounced`)
- 먼 캐시 자동 정리 (`evictDistantCache`)
- filter/sort 변경 시 캐시 자동 무효화

### 3. GridCore 통합

- `getVisibleRowsAsync()` 메서드 추가 (캐시 우선 → Worker 요청)
- `createProcessor()` 팩토리를 통한 프로세서 생성
- `engine`, `useWorker` 옵션 지원

### 4. StatusBar 추가

`src/ui/StatusBar.ts` — 그리드 하단 상태 표시줄:
- 로딩 단계별 소요 시간 표시
- 행 수 정보 표시
- 높이 16px 고정

### 5. 기타 변경사항

- **PrecalculatedMergeManager** (`src/ui/merge/PrecalculatedMergeManager.ts`): 사전 계산 기반 병합 관리자 추가
- **피벗 필드 타입 통일** (결정문서 023): `valueFields` 타입을 객체 배열로 통일
- **데모 페이지 추가**: `worker-fetch.html`, `worker-flat-api.html`, `duckdb-benchmark-v2.html`
- **데모 네비게이션**: `demo/shared/nav-sidebar.js` 공통 사이드바 컴포넌트 추가

## 생성/수정된 파일 목록

### 신규 파일
- `src/processor/WorkerProcessor.ts` — Worker 브릿지
- `src/processor/MainThreadProcessor.ts` — 메인 스레드 프로세서
- `src/processor/ProcessorFactory.ts` — 프로세서 팩토리
- `src/processor/processorWorker.ts` — Worker 스크립트
- `src/processor/engines/IEngine.ts` — 엔진 공통 인터페이스
- `src/processor/engines/ArqueroEngine.ts` — Arquero 엔진 구현
- `src/processor/engines/_deprecated/DuckDBEngine.ts` — DuckDB 엔진 구현
- `src/processor/engines/index.ts` — 엔진 내보내기
- `src/core/RowCache.ts` — 행 캐시
- `src/ui/StatusBar.ts` — 상태 표시줄
- `src/ui/merge/PrecalculatedMergeManager.ts` — 사전 계산 병합 관리자
- `tests/processor/engines/ArqueroEngine.test.ts` — 엔진 단위 테스트
- `tests/processor/engines/engine-consistency.test.ts` — 일관성 테스트
- `docs/decisions/021-engine-abstraction-architecture.md`
- `docs/decisions/022-worker-virtual-data-loading.md`
- `docs/decisions/023-pivot-field-type-unification.md`
- `demo/examples/worker-fetch.html`
- `demo/examples/worker-flat-api.html`
- `demo/examples/duckdb-benchmark-v2.html`
- `demo/shared/nav-sidebar.js`

### 수정된 주요 파일
- `src/core/GridCore.ts` — 프로세서 팩토리 통합, `getVisibleRowsAsync()` 추가
- `src/processor/ArqueroProcessor.ts` — 엔진 기반으로 리팩토링
- `src/processor/PivotProcessor.ts` — 엔진 기반으로 리팩토링
- `src/processor/index.ts` — 새 모듈 내보내기
- `src/ui/PureSheet.ts` — `engine`, `useWorker` 옵션 지원
- `src/ui/GridRenderer.ts` — StatusBar 통합
- `src/ui/body/BodyRenderer.ts` — 비동기 데이터 로딩 지원
- `src/types/field.types.ts` — `engine`, `useWorker` 옵션 추가
- `src/types/pivot.types.ts` — 피벗 필드 타입 통일

## 핵심 개념 설명

### 4가지 실행 조합

| engine | useWorker | 실행 방식 | 사용 케이스 |
|--------|-----------|----------|------------|
| `'aq'` | `false` | Main + Arquero | 기본값, 소량 데이터 |
| `'aq'` | `true` | Worker + Arquero | 중량 데이터, UI 블로킹 방지 |
| `'db'` | `false` | Main + DuckDB | 테스트/디버깅 |
| `'db'` | `true` | Worker + DuckDB | 대량 데이터 + 복잡 집계 |

### 데이터 흐름 (Worker 모드)

```
loadData() → Worker로 데이터 전송
filter/sort → 인덱스 배열만 반환 (Transferable)
스크롤 → RowCache 확인 → 미스 시 fetchVisibleRows() → Worker 요청 → 캐시 저장 → 렌더링
```

### 테스트 결과

```
✓ tests/processor/engines/ArqueroEngine.test.ts (22 tests)
✓ tests/processor/engines/engine-consistency.test.ts (6 tests)
Test Files  2 passed
Tests       28 passed | 2 skipped
```

## 다음 회차 예고

- VirtualScroller와 비동기 데이터 로딩의 완전한 UI 통합
- DuckDB 엔진 테스트 환경 구성
- 실제 대량 데이터 벤치마크
