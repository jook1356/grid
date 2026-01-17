# 8회차: 테스트 인프라 구축

## 날짜
2026-01-17

## 작업 목표
- 테스트 데이터 생성 유틸리티 구현
- 단위 테스트 및 성능 테스트 작성
- Web Worker 테스트 환경 구축

## 구현 내용

### 1. 테스트 데이터 생성기 (`tests/fixtures/generateTestData.ts`)

요청한 개수만큼 테스트 데이터를 동적으로 생성하는 유틸리티:

```typescript
import { generateTestData, getTestColumns } from './generateTestData';

// 사용 예시
const data = generateTestData(1_000_000);  // 100만 건 생성
const columns = getTestColumns();          // 컬럼 정의
```

**생성되는 컬럼 (10개):**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | number | 고유 ID |
| name | string | 이름 (한글) |
| email | string | 이메일 |
| age | number | 나이 (22-60) |
| salary | number | 급여 (3천만-1.5억) |
| department | string | 부서 |
| position | string | 직급 |
| hireDate | string | 입사일 |
| isActive | boolean | 활성 여부 |
| score | number | 점수 (0-100) |

### 2. 단위 테스트 (`tests/core/GridCore.test.ts`)

GridCore의 주요 기능 테스트:
- 초기화
- 데이터 접근
- 정렬 (단일/다중 컬럼, 토글)
- 필터 (숫자, 문자열, 다중)
- 이벤트 발생

### 3. 성능 테스트 (`tests/performance/performance.test.ts`)

다양한 데이터 크기에서 성능 측정:
- 1,000 / 10,000 / 100,000 / 1,000,000 행
- 결과는 `tests/results/` 폴더에 JSON으로 저장

### 4. Web Worker 테스트 환경

**문제**: Node.js 테스트 환경에서는 `Worker`가 정의되지 않음

**해결**: `@vitest/web-worker` 플러그인 사용

```bash
pnpm add -D @vitest/web-worker@2.1.9
```

```typescript
// 테스트 파일 상단에 추가
import '@vitest/web-worker';
```

## 성능 테스트 결과

### 1,000,000 행 (100만 건)

| 작업 | 시간 | 비고 |
|------|------|------|
| 데이터 생성 | 4,792ms | 테스트 데이터 생성 |
| 데이터 로드 | 4,511ms | Worker로 전송 포함 |
| 숫자 정렬 | 581ms | `age` 컬럼 |
| 문자열 정렬 | 3,650ms | `name` 컬럼 (한글) |
| 다중 컬럼 정렬 | 1,711ms | 2개 컬럼 |
| 필터 (숫자) | 56ms | `age >= 30` |
| 필터 (문자열) | 223ms | `name contains '김'` |
| 필터 + 정렬 | 278ms | 조합 |
| getRowsInRange | 0.04ms | 100개 행 추출 |

### 데이터 크기별 비교

| 데이터 크기 | 로드 | 숫자 정렬 | 문자열 정렬 | 필터 |
|------------|------|----------|------------|------|
| 1,000 | 23ms | 7ms | 4ms | 5ms |
| 10,000 | 58ms | 10ms | 23ms | 3ms |
| 100,000 | 849ms | 69ms | 377ms | 12ms |
| 1,000,000 | 4,511ms | 581ms | 3,650ms | 56ms |

## 파일 구조

```
tests/
├── fixtures/
│   └── generateTestData.ts    # 테스트 데이터 생성기
├── core/
│   └── GridCore.test.ts       # 단위 테스트
├── performance/
│   └── performance.test.ts    # 성능 테스트
└── results/
    └── performance-*.json     # 성능 결과
```

## 추가된 의존성

```json
{
  "devDependencies": {
    "@vitest/web-worker": "^2.1.9",
    "tsx": "^4.7.0",
    "jsdom": "^27.4.0"
  }
}
```

## 추가된 스크립트

```json
{
  "scripts": {
    "generate:data": "tsx tests/fixtures/generateTestData.ts"
  }
}
```

## 발견 및 수정된 이슈

### 정렬/필터 결과가 제대로 적용되지 않음

**증상**: 정렬 후 데이터가 정렬되지 않은 상태로 반환됨

**원인**: Arquero의 `aq.op.row_number()`가 **1부터 시작**하는데, 코드는 **0부터 시작**하는 인덱스를 기대

**수정 내용** (`src/processor/ArqueroProcessor.ts`):

```typescript
// 수정 전
this.table = this.table.derive({
  __rowIndex__: aq.op.row_number(),
});

// 수정 후
this.table = this.table.derive({
  __rowIndex__: () => aq.op.row_number() - 1,
});
```

**상태**: ✅ 수정 완료

## 최종 테스트 결과

- **단위 테스트**: 24개 통과
- **성능 테스트**: 40개 통과
- **총**: 64개 테스트 통과

## 다음 회차 계획

1. DOM 렌더러 설계 및 구현
2. 가상화(Virtualization) 구현
3. 프레임워크 래퍼 (React/Vue) 시작

## 관련 문서

- [ADR-001: Worker 환경 지원 전략](../decisions/001-worker-environment-support.md)
