## 프로젝트 구조
```
src/
├── types/      # 타입 정의
├── core/       # 핵심 모듈 (EventEmitter, DataStore, IndexManager, GridCore)
├── processor/  # 데이터 처리 (ArqueroProcessor, WorkerBridge, worker.ts)
└── utils/      # 유틸리티
```

## 현재 진행 상황
- ✅ 1회차: 프로젝트 설정 완료
- ✅ 2회차: 타입 정의 (types/) 완료
- ✅ 3회차: EventEmitter 완료
- ✅ 4회차: DataStore 완료
- ✅ 5회차: IndexManager
- ✅ 6회차: ArqueroProcessor + Worker
- ✅ 7회차: GridCore
- 🔜 8회차 이후: 테스트, DOM 렌더러, 프레임워크 래퍼