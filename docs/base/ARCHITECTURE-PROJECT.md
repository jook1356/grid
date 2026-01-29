## 프로젝트 구조
```
src/
├── types/           # 타입 정의
│   ├── data.types.ts
│   ├── state.types.ts
│   ├── event.types.ts
│   ├── field.types.ts
│   ├── pivot.types.ts
│   ├── grouping.types.ts
│   └── processor.types.ts
│
├── core/            # 핵심 모듈
│   ├── GridCore.ts          # 메인 파사드
│   ├── DataStore.ts         # 원본 데이터 관리
│   ├── IndexManager.ts      # 인덱스 배열 관리
│   ├── EventEmitter.ts      # 이벤트 시스템
│   └── RowCache.ts          # Worker 가상 데이터 캐시 (LRU)
│
├── processor/       # 데이터 처리 (엔진 추상화 + Worker)
│   ├── engines/
│   │   ├── IEngine.ts              # 공통 엔진 인터페이스
│   │   ├── ArqueroEngine.ts        # Arquero 엔진 구현
│   │   ├── _deprecated/DuckDBEngine.ts  # DuckDB 엔진 구현
│   │   └── index.ts
│   ├── MainThreadProcessor.ts      # 메인 스레드 실행
│   ├── WorkerProcessor.ts          # Worker 브릿지
│   ├── processorWorker.ts          # Worker 스크립트
│   ├── ProcessorFactory.ts         # 프로세서 팩토리
│   ├── ArqueroProcessor.ts         # 레거시 (엔진 기반으로 전환 중)
│   └── PivotProcessor.ts           # 피벗 처리
│
├── ui/              # UI 렌더링 모듈
│   ├── PureSheet.ts             # 최상위 파사드
│   ├── GridRenderer.ts          # DOM 렌더링 총괄
│   ├── VirtualScroller.ts       # 가상 스크롤
│   ├── StatusBar.ts             # 하단 상태 표시줄
│   ├── header/                  # 헤더 렌더러
│   ├── body/                    # 바디 렌더러
│   ├── row/                     # Row 클래스
│   ├── pivot/                   # 피벗 헤더 렌더러
│   ├── merge/                   # 셀 병합 관리자
│   ├── style/                   # CSS 스타일
│   └── utils/                   # UI 유틸리티
│
└── utils/           # 공통 유틸리티

tests/
├── core/
└── processor/engines/
    ├── ArqueroEngine.test.ts
    └── engine-consistency.test.ts

demo/
├── index.html
├── shared/
│   ├── nav-sidebar.js           # 공통 사이드바 네비게이션
│   └── styles.css
└── examples/
    ├── worker-fetch.html        # Worker 가상 데이터 로딩 데모
    ├── worker-flat-api.html     # Worker Flat API 데모
    ├── duckdb-benchmark-v2.html # DuckDB 벤치마크
    └── ...                      # 기타 데모
```

## 현재 진행 상황
- ✅ 1회차: 프로젝트 설정 완료
- ✅ 2회차: 타입 정의 (types/) 완료
- ✅ 3회차: EventEmitter 완료
- ✅ 4회차: DataStore 완료
- ✅ 5회차: IndexManager
- ✅ 6회차: ArqueroProcessor + Worker
- ✅ 7회차: GridCore
- ✅ 8회차: 테스트 인프라
- ✅ 9~10회차: UI Layer (행 그룹화, 멀티로우, 헤더)
- ✅ 11~12회차: 헤더 리팩토링, 그룹 헤더 동기화
- ✅ 13회차: 청크 기반 가상 스크롤
- ✅ 14회차: 마키 셀 선택
- ✅ 15회차: Config API 재설계
- ✅ 16회차: 셀 병합 관리자
- ✅ 17회차: 필터/정렬/피벗 파이프라인
- ✅ 18회차: 선택 그룹핑 지원
- ✅ 19회차: 가상 Row 빌더 + formatRow
- ✅ 20회차: CRUD + Undo 스택
- ✅ 21회차: 가로 가상화
- ✅ 22회차: 피벗 부분합
- ✅ 23회차: 유연한 컬럼 너비
- ✅ 24회차: 컬럼 너비 Flex 최적화
- ✅ 25회차: 엔진 추상화 아키텍처
- ✅ 26회차: 웹 워커 / 레이지 로딩 도입
