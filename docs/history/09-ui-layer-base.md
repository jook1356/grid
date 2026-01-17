# 09회차: UI Layer 기반 구조 구현

## 이번 회차에서 구현한 내용

UI Layer의 핵심 기반 구조를 구현했습니다:

1. **UI 타입 정의** (`src/ui/types.ts`)
2. **기본 CSS 스타일** (`src/ui/style/default.css`)
3. **VirtualScroller** - Proxy Scrollbar 방식 가상 스크롤러
4. **BodyRenderer** - 바디 영역 렌더링
5. **RowPool** - DOM 요소 풀링
6. **GridRenderer** - DOM 렌더링 총괄

---

## 생성된 파일 목록

```
src/ui/
├── index.ts                 # UI 모듈 진입점
├── types.ts                 # UI 타입 정의
├── VirtualScroller.ts       # 가상 스크롤러
├── GridRenderer.ts          # DOM 렌더링 총괄
├── body/
│   ├── index.ts             # Body 모듈 진입점
│   ├── BodyRenderer.ts      # 바디 영역 렌더링
│   └── RowPool.ts           # DOM 요소 풀링
└── style/
    └── default.css          # 기본 스타일
```

---

## 핵심 개념 설명

### 1. Proxy Scrollbar 가상화

100만 행을 효율적으로 처리하기 위해 Proxy Scrollbar 방식을 사용합니다:

```
┌─────────────────────────────────────────────┐
│  Grid Container                              │
│  ┌─────────────────────────────┬──────────┐ │
│  │                             │ ▲        │ │
│  │   Viewport (콘텐츠)          │ █ Proxy  │ │
│  │   overflow: hidden          │ █ Scroll │ │
│  │                             │ ▼        │ │
│  └─────────────────────────────┴──────────┘ │
└─────────────────────────────────────────────┘
```

**동작 원리:**
1. Proxy Scrollbar: 네이티브 스크롤바를 별도 DOM에서 생성
2. 스크롤 비율 → 행 인덱스: O(1) 계산으로 성능 확보
3. 평균 행 높이 기반으로 가변 높이 지원

### 2. DOM 풀링 (RowPool)

스크롤 시 DOM 요소를 재사용하여 GC 부담을 줄입니다:

```typescript
class RowPool {
  private pool: HTMLElement[] = [];
  private activeRows: Map<number, HTMLElement> = new Map();

  acquire(rowIndex: number): HTMLElement {
    // 풀에서 가져오거나 새로 생성
    let row = this.pool.pop() ?? this.createRow();
    this.activeRows.set(rowIndex, row);
    return row;
  }

  release(rowIndex: number): void {
    // 풀로 반환
    const row = this.activeRows.get(rowIndex);
    if (row) {
      this.activeRows.delete(rowIndex);
      this.pool.push(row);
    }
  }
}
```

### 3. 하이브리드 렌더링 방식

- **행**: `position: absolute` + `transform: translateY()` → 가상화, GPU 가속
- **셀**: `display: flex` → 간단한 배치
- **컬럼 너비**: CSS 변수로 관리 → 리사이즈 시 효율적

```css
.ps-row {
  position: absolute;
  display: flex;
  will-change: transform;
  contain: layout style;
}
```

### 4. 컬럼 그룹 분리

컬럼 고정(Pinned Columns)을 위해 Left, Center, Right로 분리:

```html
<div class="ps-row">
  <div class="ps-cells-left">...</div>   <!-- position: sticky; left: 0 -->
  <div class="ps-cells-center">...</div> <!-- flex: 1 -->
  <div class="ps-cells-right">...</div>  <!-- position: sticky; right: 0 -->
</div>
```

### 5. CSS 변수를 통한 컬럼 너비 관리

```typescript
// 컬럼 너비 변경 시 CSS 변수만 업데이트
setColumnWidth(key: string, width: number): void {
  this.container.style.setProperty(`--col-${key}-width`, `${width}px`);
}
```

모든 셀이 CSS 변수를 참조하므로 한 번의 업데이트로 전체 반영:

```css
.ps-cell {
  width: var(--col-name-width, 100px);
}
```

---

## 구현 상태

| 모듈 | 상태 | 설명 |
|------|------|------|
| VirtualScroller | ✅ 완료 | Proxy Scrollbar 방식 |
| RowPool | ✅ 완료 | DOM 요소 풀링 |
| BodyRenderer | ✅ 완료 | 바디 영역 렌더링 |
| GridRenderer | ✅ 완료 | DOM 구조 생성, 헤더, 리사이즈 |
| UI 타입 | ✅ 완료 | 셀 위치, 선택 상태, 옵션 등 |
| CSS 스타일 | ✅ 완료 | 테마 지원, 변수 기반 |

---

## 다음 회차 예고

**10회차: HeaderRenderer, HeaderCell 구현**

- 헤더 영역 렌더링 분리
- 정렬 인디케이터
- 컬럼 재정렬 (Drag & Drop)
- 컬럼 고정 토글

---

## 테스트 방법

현재 UI 모듈은 DOM 환경이 필요하므로, 브라우저에서 테스트해야 합니다.
추후 Playwright 또는 Vitest의 Browser Mode를 사용한 테스트를 추가할 예정입니다.

```typescript
// 기본 사용 예시 (브라우저 환경)
import { GridCore } from '@puresheet/core';
import { GridRenderer } from '@puresheet/ui';

const container = document.getElementById('grid');
const gridCore = new GridCore({ columns, data });

const renderer = new GridRenderer(container, {
  gridCore,
  options: {
    columns,
    rowHeight: 36,
    theme: 'light',
  },
});
```
