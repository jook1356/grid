# 006: 셀 렌더링 전략

## 상태
**채택 (Accepted)** - 하이브리드 방식 (Flexbox Row + Absolute Y)

## 날짜
2026-01-17

## 배경

100만 행을 지원하는 가상화 그리드에서 셀 렌더링 방식을 결정해야 합니다.
다음 요구사항을 만족해야 합니다:

- 100만 행 가상화
- 가변 행 높이
- 컬럼 고정 (Left/Right)
- 컬럼 리사이즈
- DOM 풀링 (성능)
- 2차: 행 그룹화, Multi-Row, 셀 병합

---

## 고려한 옵션

### 옵션 1: Flexbox 기반

```html
<div class="ps-row" style="display: flex;">
  <div class="ps-cell" style="width: 100px;">값1</div>
  <div class="ps-cell" style="width: 150px;">값2</div>
</div>
```

| 장점 | 단점 |
|------|------|
| 구현 간단 | 가상화 통합 어려움 |
| 유연한 너비 | 큰 테이블에서 성능 이슈 |

### 옵션 2: CSS Grid 기반

```html
<div class="ps-body" style="display: grid; grid-template-columns: 100px 150px 1fr;">
  <div class="ps-cell">값1</div>
  <div class="ps-cell">값2</div>
</div>
```

| 장점 | 단점 |
|------|------|
| 컬럼 정렬 자동 | 행 단위 스타일링 어려움 |
| 컬럼 리사이즈 쉬움 | 가상화와 통합 복잡 |
| | 행 그룹화/Multi-Row 불리 |

### 옵션 3: Absolute 포지셔닝

```html
<div class="ps-row" style="position: absolute; transform: translateY(0px);">
  <div class="ps-cell" style="position: absolute; left: 0; width: 100px;">값1</div>
  <div class="ps-cell" style="position: absolute; left: 100px; width: 150px;">값2</div>
</div>
```

| 장점 | 단점 |
|------|------|
| 가상화에 최적 | 컬럼 위치 직접 계산 |
| GPU 가속 | 컬럼 리사이즈 시 모든 셀 업데이트 |
| DOM 풀링 적합 | 구현 복잡 |

### 옵션 4: 하이브리드 (Flexbox Row + Absolute Y) ✅ 채택

```html
<div class="ps-row" style="position: absolute; transform: translateY(0px); display: flex;">
  <div class="ps-cell" style="width: 100px;">값1</div>
  <div class="ps-cell" style="width: 150px;">값2</div>
</div>
```

| 장점 | 단점 |
|------|------|
| 행 가상화 최적 | 컬럼 정렬 수동 관리 필요 |
| 셀 배치 간단 | |
| GPU 가속 (transform) | |
| 행 그룹화/Multi-Row 자연스러움 | |

---

## 결정

**옵션 4 (하이브리드: Flexbox Row + Absolute Y)를 채택합니다.**

이유:
1. 행은 `position: absolute` + `transform: translateY()` → 가상화 최적, GPU 가속
2. 셀은 `display: flex` → 간단한 배치, 컬럼 고정과 조화
3. 행 단위 DOM 구조 유지 → 행 그룹화, Multi-Row에 유리
4. CSS 변수로 컬럼 너비 관리 → 리사이즈 시 효율적

---

## DOM 구조

```html
<div class="ps-grid-container">
  <!-- ========================================
       헤더
       ======================================== -->
  <div class="ps-header">
    <div class="ps-header-row">
      <!-- 왼쪽 고정 -->
      <div class="ps-cells-left">
        <div class="ps-header-cell" style="width: var(--col-id-width)">ID</div>
      </div>
      
      <!-- 중앙 스크롤 -->
      <div class="ps-cells-center">
        <div class="ps-header-cell" style="width: var(--col-name-width)">Name</div>
        <div class="ps-header-cell" style="width: var(--col-email-width)">Email</div>
        <div class="ps-header-cell" style="width: var(--col-phone-width)">Phone</div>
      </div>
      
      <!-- 오른쪽 고정 -->
      <div class="ps-cells-right">
        <div class="ps-header-cell" style="width: var(--col-actions-width)">Actions</div>
      </div>
    </div>
  </div>
  
  <!-- ========================================
       바디 (Proxy Scrollbar + 가상화)
       ======================================== -->
  <div class="ps-body">
    <!-- 스크롤바 프록시 -->
    <div class="ps-scroll-proxy">
      <div class="ps-scroll-spacer"></div>
    </div>
    
    <!-- 실제 콘텐츠 -->
    <div class="ps-viewport">
      <div class="ps-row-container">
        <!-- 가상화된 행 (transform으로 Y 위치) -->
        <div class="ps-row" style="transform: translateY(0px)">
          <div class="ps-cells-left">
            <div class="ps-cell" style="width: var(--col-id-width)">1</div>
          </div>
          <div class="ps-cells-center">
            <div class="ps-cell" style="width: var(--col-name-width)">홍길동</div>
            <div class="ps-cell" style="width: var(--col-email-width)">hong@example.com</div>
            <div class="ps-cell" style="width: var(--col-phone-width)">010-1234-5678</div>
          </div>
          <div class="ps-cells-right">
            <div class="ps-cell" style="width: var(--col-actions-width)">Edit</div>
          </div>
        </div>
        
        <div class="ps-row" style="transform: translateY(40px)">
          <!-- ... -->
        </div>
      </div>
    </div>
  </div>
</div>
```

---

## CSS 설계

```css
/* ========================================
   Grid Container
   ======================================== */
.ps-grid-container {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  
  /* 테마 변수 */
  --bg-color: #ffffff;
  --border-color: #e0e0e0;
  --header-bg: #f5f5f5;
  --row-hover-bg: #f0f7ff;
  --row-selected-bg: #e3f2fd;
  
  /* 크기 변수 */
  --header-height: 40px;
  --row-height: 36px;
  --scrollbar-width: 17px;
  
  /* 컬럼 너비 변수 (리사이즈 시 여기만 변경) */
  --col-id-width: 60px;
  --col-name-width: 150px;
  --col-email-width: 200px;
  --col-phone-width: 120px;
  --col-actions-width: 100px;
}

/* ========================================
   Header
   ======================================== */
.ps-header {
  flex-shrink: 0;
  background: var(--header-bg);
  border-bottom: 2px solid var(--border-color);
  overflow: hidden;
}

.ps-header-row {
  display: flex;
  height: var(--header-height);
}

.ps-header-cell {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-weight: 600;
  border-right: 1px solid var(--border-color);
  user-select: none;
}

/* ========================================
   Body
   ======================================== */
.ps-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.ps-scroll-proxy {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  pointer-events: none;
}

.ps-scroll-proxy::-webkit-scrollbar {
  pointer-events: auto;
}

.ps-viewport {
  position: absolute;
  top: 0;
  left: 0;
  right: var(--scrollbar-width);
  bottom: 0;
  overflow: hidden;
}

@media (pointer: coarse) {
  .ps-viewport {
    right: 0;
  }
}

.ps-row-container {
  position: relative;
  will-change: transform;
}

/* ========================================
   Row (가상화 핵심)
   ======================================== */
.ps-row {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  height: var(--row-height);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color);
  will-change: transform;
  contain: layout style;
}

.ps-row:hover {
  background: var(--row-hover-bg);
}

.ps-row.selected {
  background: var(--row-selected-bg);
}

/* ========================================
   Cells Container (고정/스크롤 분리)
   ======================================== */
.ps-cells-left,
.ps-cells-center,
.ps-cells-right {
  display: flex;
  align-items: center;
}

.ps-cells-left {
  position: sticky;
  left: 0;
  z-index: 2;
  background: inherit;
  box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1);
}

.ps-cells-right {
  position: sticky;
  right: 0;
  z-index: 2;
  background: inherit;
  box-shadow: -2px 0 4px rgba(0, 0, 0, 0.1);
}

.ps-cells-center {
  flex: 1;
  overflow: hidden;
}

/* ========================================
   Cell
   ======================================== */
.ps-cell {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-right: 1px solid var(--border-color);
  contain: content;
}

.ps-cell:last-child {
  border-right: none;
}
```

---

## DOM 풀링

```typescript
/**
 * 행 요소 풀
 * 스크롤 시 행 DOM을 재사용하여 GC 부담 감소
 */
class RowPool {
  private pool: HTMLElement[] = [];
  private activeRows: Map<number, HTMLElement> = new Map();
  private rowContainer: HTMLElement;
  
  constructor(rowContainer: HTMLElement) {
    this.rowContainer = rowContainer;
  }
  
  /**
   * 행 요소 획득 (풀에서 재사용 또는 새로 생성)
   */
  acquire(rowIndex: number): HTMLElement {
    let row = this.pool.pop();
    
    if (!row) {
      row = this.createRowElement();
    }
    
    this.activeRows.set(rowIndex, row);
    this.rowContainer.appendChild(row);
    
    return row;
  }
  
  /**
   * 행 요소 반환 (풀로 돌려보냄)
   */
  release(rowIndex: number): void {
    const row = this.activeRows.get(rowIndex);
    if (row) {
      this.activeRows.delete(rowIndex);
      row.remove();
      this.pool.push(row);
    }
  }
  
  /**
   * 보이는 범위 업데이트
   */
  updateVisibleRange(startIndex: number, endIndex: number): void {
    // 범위 밖 행 반환
    for (const [index] of this.activeRows) {
      if (index < startIndex || index > endIndex) {
        this.release(index);
      }
    }
    
    // 새 범위 행 획득
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.activeRows.has(i)) {
        this.acquire(i);
      }
    }
  }
  
  /**
   * 행 요소 생성 (템플릿)
   */
  private createRowElement(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-row';
    
    // Left cells
    const left = document.createElement('div');
    left.className = 'ps-cells-left';
    row.appendChild(left);
    
    // Center cells
    const center = document.createElement('div');
    center.className = 'ps-cells-center';
    row.appendChild(center);
    
    // Right cells
    const right = document.createElement('div');
    right.className = 'ps-cells-right';
    row.appendChild(right);
    
    return row;
  }
  
  /**
   * 풀 정리
   */
  destroy(): void {
    this.pool = [];
    this.activeRows.clear();
  }
}
```

---

## 컬럼 너비 관리 (CSS 변수)

```typescript
class ColumnWidthManager {
  private container: HTMLElement;
  private widths: Map<string, number> = new Map();
  
  constructor(container: HTMLElement, columns: ColumnDef[]) {
    this.container = container;
    
    // 초기 너비 설정
    for (const col of columns) {
      const width = col.width ?? 100;
      this.widths.set(col.key, width);
      this.container.style.setProperty(`--col-${col.key}-width`, `${width}px`);
    }
  }
  
  /**
   * 컬럼 너비 변경
   * CSS 변수 업데이트 → 모든 셀이 자동으로 반영
   */
  setWidth(columnKey: string, width: number): void {
    const minWidth = 50;
    const actualWidth = Math.max(minWidth, width);
    
    this.widths.set(columnKey, actualWidth);
    this.container.style.setProperty(`--col-${columnKey}-width`, `${actualWidth}px`);
  }
  
  /**
   * 컬럼 너비 조회
   */
  getWidth(columnKey: string): number {
    return this.widths.get(columnKey) ?? 100;
  }
  
  /**
   * 전체 너비 (스크롤 영역 계산용)
   */
  getTotalWidth(): number {
    let total = 0;
    for (const width of this.widths.values()) {
      total += width;
    }
    return total;
  }
}
```

---

## 성능 최적화 포인트

| 기법 | 적용 위치 | 효과 |
|------|----------|------|
| `transform: translateY()` | Row | GPU 가속, 리플로우 방지 |
| `will-change: transform` | Row, RowContainer | 레이어 프로모션 |
| `contain: layout style` | Row | 레이아웃 격리 |
| `contain: content` | Cell | 콘텐츠 격리 |
| DOM 풀링 | RowPool | GC 부담 감소 |
| CSS 변수 | 컬럼 너비 | 일괄 업데이트 |

---

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [가변 행 높이 가상화 전략](./003-variable-row-height-virtualization.md)
