# 09. Row Grouping 및 Multi-Row 레이아웃 구현

## 날짜
2026-01-18

## 이번 회차에서 구현한 내용

### 1. Row Grouping (행 그룹화) ✅

데이터를 특정 컬럼 기준으로 계층적으로 그룹화하고, 집계 기능을 제공하는 기능을 구현했습니다.

#### 핵심 기능

| 기능 | 설명 |
|------|------|
| **다중 레벨 그룹화** | 여러 컬럼으로 중첩 그룹 (예: 부서 → 상태) |
| **접기/펼치기** | 그룹 헤더 클릭으로 토글 |
| **집계 기능** | sum, avg, count, min, max + 커스텀 함수 |
| **가상화 통합** | 그룹 헤더도 가상 스크롤에 포함 |

#### 구현 파일

```
src/
├── types/
│   └── grouping.types.ts      # 그룹화 관련 타입 (VirtualRow, GroupNode 등)
├── ui/
│   └── grouping/
│       ├── GroupManager.ts    # 그룹화 로직 담당
│       └── index.ts
```

#### API 사용법

```typescript
// 그룹화 설정
bodyRenderer.setGroupingConfig({
  columns: ['department', 'status'],  // 다중 그룹
  aggregates: {
    salary: 'sum',      // 내장 함수
    count: 'count',
  },
});

// 접기/펼치기
bodyRenderer.toggleGroup('department:Engineering');
bodyRenderer.expandAllGroups();
bodyRenderer.collapseAllGroups();

// GroupManager 직접 사용
const groupManager = bodyRenderer.getGroupManager();
groupManager.setAggregate('salary', 'avg');
```

### 2. Multi-Row 레이아웃 (기본 구조) 🔄

하나의 데이터 행을 여러 줄(visual rows)로 표시하는 기능의 기본 구조를 구현했습니다.

#### 핵심 개념

```
일반 그리드:     1 data row = 1 visual row
Multi-Row:      1 data row = N visual rows (rowTemplate.rowCount)
```

#### 구현 파일

```
src/
├── types/
│   └── grouping.types.ts      # RowTemplate, RowLayoutItem 타입
├── ui/
│   └── multirow/
│       ├── MultiRowRenderer.ts # Multi-Row 렌더링 유틸리티
│       └── index.ts
```

#### API 사용법 (예정)

```typescript
const sheet = new PureSheet(container, {
  columns: [...],
  rowTemplate: {
    rowCount: 2,
    layout: [
      // 첫 번째 줄
      [
        { key: 'id', rowSpan: 2 },
        { key: 'name' },
        { key: 'email', colSpan: 2 },
        { key: 'salary', rowSpan: 2 },
      ],
      // 두 번째 줄
      [
        { key: 'dept' },
        { key: 'phone' },
        { key: 'title' },
      ],
    ],
  },
  data,
});
```

### 3. 관련 UI 개선

#### 가로 스크롤 지원
- `ps-viewport`에 `overflow-x: auto` 적용
- 헤더와 바디 가로 스크롤 동기화

#### 컬럼 고정 데모 수정
- `renderer.setColumnPinned()` 실제 호출

---

## 생성/수정된 파일 목록

### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/types/grouping.types.ts` | 그룹화/Multi-Row 타입 정의 |
| `src/ui/grouping/GroupManager.ts` | 그룹화 로직 클래스 |
| `src/ui/grouping/index.ts` | Grouping 모듈 export |
| `src/ui/multirow/MultiRowRenderer.ts` | Multi-Row 렌더링 유틸리티 |
| `src/ui/multirow/index.ts` | Multi-Row 모듈 export |

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/types/index.ts` | grouping.types 타입 export 추가 |
| `src/ui/types.ts` | PureSheetOptions에 groupingConfig, rowTemplate 추가 |
| `src/ui/index.ts` | GroupManager, MultiRowRenderer export 추가 |
| `src/ui/style/default.css` | 그룹 헤더, Multi-Row 스타일 추가, 가로 스크롤 수정 |
| `src/ui/body/BodyRenderer.ts` | GroupManager 통합, VirtualRow 렌더링 |
| `src/ui/GridRenderer.ts` | groupingConfig, onGroupToggle, getBodyRenderer() 추가 |
| `demo/examples/grouping.html` | 실제 Row Grouping 연결, badge 업데이트 |
| `demo/examples/column-pinning.html` | setColumnPinned 실제 호출 |

---

## 핵심 개념 설명

### VirtualRow 타입

그룹화 시 화면에 표시되는 행은 두 종류입니다:

```typescript
// 그룹 헤더 행
interface GroupHeaderRow {
  type: 'group-header';
  groupId: string;        // 접기/펼치기용 ID
  column: string;         // 그룹 컬럼
  value: CellValue;       // 그룹 값 (예: 'Engineering')
  level: number;          // 중첩 레벨
  itemCount: number;      // 하위 아이템 수
  collapsed: boolean;     // 접힘 상태
  aggregates: Record<string, CellValue>; // 집계 값
}

// 데이터 행
interface DataRow {
  type: 'data';
  dataIndex: number;      // 원본 데이터 인덱스
  data: Row;              // 실제 데이터
  groupPath: GroupIdentifier[]; // 속한 그룹 경로
}

type VirtualRow = GroupHeaderRow | DataRow;
```

### GroupManager 동작 원리

```
원본 데이터 (Row[])
    ↓ groupData()
트리 구조 (GroupNode[])
    ↓ flattenWithGroups()
플랫 배열 (VirtualRow[])
    ↓ VirtualScroller
화면에 보이는 행만 렌더링
```

1. **그룹화**: 컬럼 값 기준으로 트리 구조 생성
2. **플랫화**: 트리를 순회하며 그룹 헤더 + 데이터 행으로 변환
3. **접기 처리**: 접힌 그룹의 하위 항목은 결과에서 제외
4. **집계 계산**: 각 그룹의 집계 값 계산

### Multi-Row 개념

```
┌────┬─────────┬────────────────────────┬──────────┐
│    │  Name   │         Email          │          │
│ ID ├─────────┼───────────┬────────────┤  Salary  │
│    │  Dept   │   Phone   │   Title    │          │
├────┼─────────┼───────────────────────┼──────────┤
│  1 │  홍길동  │     hong@example.com   │ 5,000만  │
│    ├─────────┼───────────┬────────────┤          │
│    │  개발팀  │ 010-1234  │   시니어    │          │
└────┴─────────┴───────────┴────────────┴──────────┘

- ID, Salary: rowSpan=2 (2줄에 걸침)
- Email: colSpan=2 (2칸 차지)
```

---

## 다음 회차 예고

1. **Multi-Row 완성**
   - GridRenderer/BodyRenderer에 rowTemplate 통합
   - Multi-Row 데모 페이지 실제 연결

2. **셀 병합**
   - MergeManager 구현
   - 데이터 레벨 병합 (same-value)
   - API 레벨 병합 (mergeCells)

3. **성능 최적화**
   - 대용량 데이터 그룹화 최적화
   - 캐싱 전략 개선

---

## 테스트 방법

### Row Grouping 테스트

```bash
pnpm dev
```

브라우저에서 http://localhost:5173/demo/examples/grouping.html 접속

1. "그룹 기준" 드롭다운으로 그룹화 방식 변경
2. 그룹 헤더 클릭으로 접기/펼치기
3. "모두 펼치기" / "모두 접기" 버튼 테스트
4. "집계" 드롭다운으로 집계 함수 변경
