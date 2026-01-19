# 11회차: Header 렌더링 모듈 분리

## 🎯 이번 회차 목표

`GridRenderer`에서 직접 수행하던 헤더 렌더링 로직을 `HeaderRenderer` 모듈로 분리하여 코드 구조를 개선합니다.

## 📋 왜 이 작업이 필요한가?

### 기존 문제점

1. **코드 중복**: `src/ui/header/` 폴더에 `HeaderRenderer`가 있었지만 사용되지 않음
2. **단일 책임 원칙 위반**: `GridRenderer`가 헤더 렌더링까지 직접 처리
3. **기능 불일치**: 
   - `HeaderRenderer`에는 정렬, 드래그&드롭 기능이 있었지만 미사용
   - `GridRenderer`에서 Multi-Row 헤더를 직접 구현
4. **유지보수 어려움**: 헤더 관련 수정 시 `GridRenderer` 전체를 파악해야 함

### 개선 방향

```
[Before]                              [After]
┌──────────────────────────┐         ┌──────────────────────────┐
│ GridRenderer             │         │ GridRenderer             │
│ ├─ renderHeader()        │   →     │ └─ HeaderRenderer 사용   │
│ ├─ renderMultiRowHeader()│         ├──────────────────────────┤
│ ├─ createHeaderCell()    │         │ HeaderRenderer           │
│ ├─ startResize()         │         │ ├─ 일반 헤더 렌더링      │
│ └─ ...200줄 이상...      │         │ ├─ Multi-Row 헤더 렌더링 │
│                          │         │ ├─ 정렬 처리             │
│ BodyRenderer (사용 O)    │         │ ├─ 컬럼 리사이즈         │
└──────────────────────────┘         │ └─ 드래그&드롭 재정렬    │
                                     └──────────────────────────┘
```

## 🔧 구현 내용

### 1. HeaderCell.ts 개선

**Multi-Row 셀 지원 추가:**

```typescript
// 새로 추가된 인터페이스
export interface CellPlacement {
  gridRow: number;       // 그리드 행 위치 (1-based)
  gridColumn: number;    // 그리드 컬럼 위치 (1-based)
  rowSpan: number;       // 행 스팬
  colSpan: number;       // 컬럼 스팬
  gridColumnCount: number;  // 총 그리드 컬럼 수
  gridRowCount: number;     // 총 그리드 행 수
}

// HeaderCellOptions에 추가
interface HeaderCellOptions {
  // ... 기존 옵션들
  placement?: CellPlacement;    // Multi-Row 배치 정보
  resizeColumnKey?: string;     // 리사이즈 시 사용할 컬럼 키
}
```

**일반 모드 vs Multi-Row 모드:**
- `placement`가 없으면: 일반 모드 (CSS 변수로 너비 설정)
- `placement`가 있으면: Multi-Row 모드 (CSS Grid 배치)

### 2. HeaderRenderer.ts 개선

**Multi-Row 헤더 지원 추가:**

```typescript
interface HeaderRendererOptions {
  // ... 기존 옵션들
  rowTemplate?: RowTemplate;  // 있으면 Multi-Row 모드
}
```

**주요 메서드:**

| 메서드 | 설명 |
|--------|------|
| `render()` | 모드에 따라 분기 처리 |
| `renderNormalHeader()` | Left/Center/Right 영역으로 나눠 렌더링 |
| `renderMultiRowHeader()` | CSS Grid 기반 렌더링 |
| `calculateMultiRowCellPlacements()` | 셀 배치 정보 계산 |
| `calculateGridColumnInfos()` | 그리드 컬럼별 primaryKey 결정 |

### 3. GridRenderer.ts 단순화

**제거된 코드 (~200줄):**
- `renderHeader()` 메서드
- `renderMultiRowHeader()` 메서드
- `createHeaderCellsContainer()` 메서드
- `createMultiRowHeaderCell()` 메서드
- `calculateMultiRowCellPlacements()` 메서드
- `calculateGridColumnInfos()` 메서드
- `buildGridTemplateColumns()` 메서드
- `startResize()`, `handleResizeMove()`, `handleResizeEnd()` 메서드
- `getColumnGroups()` 헬퍼 메서드

**추가된 코드:**
```typescript
import { HeaderRenderer } from './header/HeaderRenderer';

// HeaderRenderer 인스턴스
private headerRenderer: HeaderRenderer | null = null;

// 초기화
this.headerRenderer = new HeaderRenderer(this.headerElement, {
  gridCore: this.gridCore,
  columns: this.columnStates,
  headerHeight: this.options.rowHeight ?? 36,
  resizable: this.options.resizableColumns !== false,
  reorderable: this.options.reorderableColumns ?? false,
  rowTemplate: this.options.rowTemplate,
  onSortChange: this.handleSortChange.bind(this),
  onColumnResize: this.handleColumnResize.bind(this),
  onColumnReorder: this.handleColumnReorder.bind(this),
});
```

### 4. 타입 정리

**SortState 타입 위치 변경:**
- 기존: `HeaderCell.ts`에서 직접 정의
- 변경: `ui/types.ts`에서 정의, `header/index.ts`에서 re-export

```typescript
// src/ui/types.ts
export interface SortState {
  columnKey: string;
  direction: 'asc' | 'desc';
}
```

## 📁 수정된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/ui/header/HeaderCell.ts` | Multi-Row 지원, CellPlacement 인터페이스 추가 |
| `src/ui/header/HeaderRenderer.ts` | Multi-Row 렌더링 로직 추가 |
| `src/ui/header/index.ts` | SortState re-export 추가 |
| `src/ui/GridRenderer.ts` | HeaderRenderer 사용, 중복 코드 제거 |
| `src/ui/types.ts` | SortState 인터페이스 추가 |

## 💡 핵심 개념

### 모듈 분리의 이점

1. **단일 책임**: 각 클래스가 하나의 역할만 담당
2. **테스트 용이성**: 헤더 관련 테스트를 독립적으로 작성 가능
3. **재사용성**: HeaderRenderer를 다른 컨텍스트에서도 사용 가능
4. **유지보수성**: 헤더 관련 수정이 한 곳에서만 발생

### Multi-Row 헤더의 작동 원리

```
┌───────────────────────────────────────────────────────────────┐
│ Multi-Row 헤더 예시                                           │
├─────────────┬─────────────┬─────────────┬─────────────────────┤
│ ID          │ Name        │ Email       │ Created Date        │
│ (rowSpan:2) │ (rowSpan:1) │ (colSpan:2) │                     │
│             ├─────────────┼─────────────┼─────────────────────┤
│             │ First       │ Last        │ Domain              │
└─────────────┴─────────────┴─────────────┴─────────────────────┘

CSS Grid로 배치:
- gridTemplateRows: repeat(2, 36px)
- gridTemplateColumns: var(--col-id-width) var(--col-first-width) ...
- 각 셀: gridRow: "1 / span 2", gridColumn: "1"
```

## ✅ 결과

### 코드 품질 개선

| 항목 | Before | After |
|------|--------|-------|
| GridRenderer 라인 수 | ~765줄 | ~410줄 |
| 헤더 관련 코드 위치 | 분산 | `header/` 폴더에 집중 |
| 기능 일관성 | Multi-Row만 지원 | 일반/Multi-Row 모두 지원 |
| 정렬/드래그 기능 | 미사용 | 활성화 |

### 기능 통합

`HeaderRenderer`가 다음 기능을 모두 담당:
- ✅ 일반 헤더 렌더링 (Left/Center/Right 영역)
- ✅ Multi-Row 헤더 렌더링 (CSS Grid)
- ✅ 정렬 인디케이터 및 클릭 처리
- ✅ 컬럼 리사이즈
- ✅ 드래그&드롭 재정렬 (일반 모드에서만)

## 🔜 다음 회차 예고

- 성능 최적화 (가상화 개선)
- 편집 기능 구현
- 키보드 네비게이션 추가

