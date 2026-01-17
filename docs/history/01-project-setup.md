# 1회차: 프로젝트 초기 설정

**작업일**: 2024년  
**상태**: ✅ 완료

---

## 이번 회차 목표

프로젝트의 기반을 다지는 작업입니다. 코드를 작성하기 전에 필요한 도구들을 설정했습니다.

---

## 구현한 내용

### 1. package.json
프로젝트의 "신분증" 역할을 하는 파일입니다.

| 항목 | 설명 |
|------|------|
| `name` | @puresheet/core (패키지 이름) |
| `type` | module (ES 모듈 방식) |
| `dependencies` | arquero (데이터 처리 라이브러리) |
| `devDependencies` | typescript, vite, vitest |

### 2. tsconfig.json
TypeScript 컴파일러 설정입니다.

**핵심 설정:**
- `strict: true` - 엄격한 타입 검사로 버그 예방
- `target: ES2020` - 최신 JavaScript 문법 지원
- `paths` - 경로 별칭 (`@/` → `src/`)

### 3. vite.config.ts
빌드 도구 설정입니다.

**핵심 설정:**
- 라이브러리 모드로 빌드
- ES Module + CommonJS 둘 다 지원
- TypeScript 타입 정의 파일 자동 생성

### 4. 폴더 구조
```
grid/
├── docs/
│   ├── ARCHITECTURE.md    # 설계 문서
│   ├── RULES.md           # AI 개발 규칙
│   └── history/           # 작업 기록
├── src/
│   ├── index.ts           # 진입점
│   ├── types/             # 타입 정의
│   ├── core/              # 핵심 모듈
│   └── processor/         # 데이터 처리
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .gitignore
```

---

## 생성된 파일 목록

| 파일 | 용도 |
|------|------|
| `package.json` | 프로젝트 설정 및 의존성 |
| `tsconfig.json` | TypeScript 설정 |
| `vite.config.ts` | 빌드 도구 설정 |
| `.gitignore` | Git 제외 파일 목록 |
| `src/index.ts` | 라이브러리 진입점 |
| `src/types/index.ts` | 타입 모듈 진입점 |
| `src/core/index.ts` | 코어 모듈 진입점 |
| `src/processor/index.ts` | 프로세서 모듈 진입점 |

---

## 핵심 개념 정리

### ES Module vs CommonJS
```javascript
// ES Module (우리가 사용하는 방식)
import { something } from './module';
export const value = 1;

// CommonJS (Node.js 전통 방식)
const something = require('./module');
module.exports = { value: 1 };
```

### 왜 둘 다 지원하나요?
- ES Module: 최신 브라우저, 최신 Node.js
- CommonJS: 레거시 Node.js, 일부 번들러
- 라이브러리는 다양한 환경에서 사용되므로 둘 다 지원

### Vite를 선택한 이유
1. **빠른 개발 서버**: 네이티브 ES 모듈 사용
2. **간단한 설정**: 복잡한 webpack 설정 불필요
3. **라이브러리 모드**: 라이브러리 빌드를 쉽게 지원
4. **TypeScript 내장**: 별도 설정 없이 TypeScript 지원

---

## 다음 회차 예고

### 2회차: 타입 정의 (types/)

다음 회차에서는 모든 모듈의 기반이 되는 타입들을 정의합니다.

**만들 파일:**
- `src/types/data.types.ts` - Row, Column, CellValue
- `src/types/state.types.ts` - SortState, FilterState
- `src/types/event.types.ts` - 이벤트 타입
- `src/types/processor.types.ts` - IDataProcessor 인터페이스

**배울 내용:**
- TypeScript 인터페이스와 타입
- 타입을 먼저 정의하는 이유 (계약 우선 개발)
- 제네릭 타입 기초

---

## 다음 단계 실행 방법

의존성 설치:
```bash
pnpm install
```

개발 서버 실행 (타입 정의 후):
```bash
pnpm dev
```

빌드:
```bash
pnpm build
```
