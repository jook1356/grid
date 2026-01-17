# 003: 가변 행 높이 가상화 전략

## 상태
**채택 (Accepted)** - Proxy Scrollbar + 초기 샘플링 방식

## 날짜
2026-01-17

## 배경

Grid에서 가변 행 높이(행마다 다른 높이)를 지원하면서 가상화를 구현해야 합니다.
일반적인 가상화는 고정 행 높이를 가정하여 `scrollTop ÷ rowHeight`로 행 인덱스를 계산합니다.

가변 행 높이에서는 이 계산이 복잡해집니다:
- 모든 행 높이를 저장하고 prefix sum 계산 필요
- 스크롤 위치에서 행을 찾으려면 이진 탐색 필요 (O(log n))
- 행 높이 변경 시 재계산 비용 발생

---

## 고려한 옵션

### 옵션 1: 전통적 방식 (Prefix Sum + 이진 탐색)

```typescript
// 모든 행 높이 저장
const rowHeights: number[] = [40, 32, 60, 32, 80, ...]; // 100만개

// Prefix sum (누적 합)
const offsets: number[] = [0, 40, 72, 132, 164, 244, ...];

// scrollTop → 행 인덱스 (이진 탐색)
function getRowAtOffset(scrollTop: number): number {
  return binarySearch(offsets, scrollTop);
}
```

**장점:**
- 표준적인 스크롤 동작 유지
- 네이티브 스크롤바 사용 가능

**단점:**
- O(n) 메모리 사용 (100만 행 = 수 MB)
- 행 높이 변경 시 O(n) 재계산
- 초기 렌더링 전 모든 높이를 알아야 함

---

### 옵션 2: 커스텀 스크롤바 (DOM 직접 구현)

스크롤바를 DOM으로 직접 구현하고, 스크롤바 위치를 행 인덱스와 1:1 매핑.

```typescript
// 스크롤바 위치 = 행 인덱스
const rowIndex = Math.floor((thumbPosition / scrollableHeight) * totalRows);
```

**장점:**
- O(1) 계산으로 행 인덱스 도출
- 메모리 효율적 (높이 저장 불필요)
- 구현 단순화

**단점:**
- 비표준 스크롤 동작
- 터치/관성 스크롤 직접 구현 필요
- 접근성 추가 작업 필요

---

### 옵션 3: Proxy Scrollbar (네이티브 스크롤 활용) ✅ 채택

네이티브 스크롤바를 별도 DOM에서 생성하고, 콘텐츠 영역과 동기화.

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

**장점:**
- 네이티브 스크롤 동작 (터치, 관성, 키보드)
- 접근성 자동 지원
- 크로스 브라우저 호환
- O(1) 행 인덱스 계산

**단점:**
- 두 스크롤 영역 동기화 필요
- 평균 높이 업데이트 시 스크롤바 길이 변동 가능

---

## 결정

**옵션 3 (Proxy Scrollbar) + 초기 샘플링 후 고정 방식을 채택합니다.**

이유:
1. 네이티브 스크롤의 모든 장점 (터치, 관성, 접근성)
2. 샘플링 후 높이 고정으로 스크롤바 변동 사이드 이펙트 제거
3. 100만 행에서도 O(1) 성능 유지
4. 모바일/터치 환경에서 자연스러운 UX

---

## 구현 설계

### DOM 구조

```html
<div class="ps-grid-container">
  <!-- 스크롤바 프록시: 네이티브 스크롤바 담당 -->
  <div class="ps-scroll-proxy">
    <div class="ps-scroll-spacer"></div>  <!-- height: estimatedTotalHeight -->
  </div>
  
  <!-- 실제 콘텐츠: 스크롤바 숨김 -->
  <div class="ps-viewport">
    <div class="ps-row-container">
      <!-- 가상화된 행들 -->
    </div>
  </div>
</div>
```

### CSS

```css
.ps-grid-container {
  position: relative;
  overflow: hidden;
}

/* 스크롤바 프록시 */
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

/* 스크롤바 영역만 클릭 가능 */
.ps-scroll-proxy::-webkit-scrollbar {
  pointer-events: auto;
}

/* Firefox용 */
@supports (scrollbar-width: thin) {
  .ps-scroll-proxy {
    scrollbar-width: thin;
  }
}

/* 실제 콘텐츠 */
.ps-viewport {
  position: absolute;
  top: 0;
  left: 0;
  right: 17px;  /* 스크롤바 너비만큼 여백 */
  bottom: 0;
  overflow: hidden;
}

/* 모바일: 스크롤바 오버레이 */
@media (pointer: coarse) {
  .ps-viewport {
    right: 0;
  }
}
```

### 핵심 로직

```typescript
class ProxyScrollVirtualizer {
  private scrollProxy: HTMLElement;
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  
  private totalRows = 0;
  private estimatedRowHeight = 40;
  private currentRowIndex = 0;
  
  /**
   * 프록시 스크롤 이벤트 → 행 인덱스 계산
   */
  private onProxyScroll = (): void => {
    const scrollTop = this.scrollProxy.scrollTop;
    const scrollHeight = this.scrollProxy.scrollHeight;
    const clientHeight = this.scrollProxy.clientHeight;
    
    // 스크롤 가능 영역에서의 비율
    const maxScroll = scrollHeight - clientHeight;
    const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;
    
    // 비율 → 행 인덱스
    const maxRowIndex = Math.max(0, this.totalRows - this.getVisibleRowCount());
    const targetRowIndex = Math.round(scrollRatio * maxRowIndex);
    
    if (targetRowIndex !== this.currentRowIndex) {
      this.currentRowIndex = targetRowIndex;
      this.renderVisibleRows();
    }
  };
  
  /**
   * Viewport 휠 이벤트 → 프록시로 전달
   */
  private onViewportWheel = (e: WheelEvent): void => {
    this.scrollProxy.scrollTop += e.deltaY;
    e.preventDefault();
  };
  
  /**
   * 터치 이벤트 → 프록시로 전달
   */
  private setupTouchEvents(): void {
    let startY = 0;
    let startScrollTop = 0;
    
    this.viewport.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      startScrollTop = this.scrollProxy.scrollTop;
    }, { passive: true });
    
    this.viewport.addEventListener('touchmove', (e) => {
      const deltaY = startY - e.touches[0].clientY;
      this.scrollProxy.scrollTop = startScrollTop + deltaY;
    }, { passive: true });
  }
}
```

---

## 평균 높이 업데이트 전략

스크롤바 길이 변동으로 인한 사이드 이펙트를 처리하는 방법들:

### 전략 A: 초기 샘플링 후 고정 ✅ 권장

```typescript
class ProxyScrollVirtualizer {
  private heightSamples: number[] = [];
  private isHeightLocked = false;
  private sampleSize = 50;
  
  /**
   * 첫 N개 행만 측정하고 평균 고정
   */
  measureRow(index: number, height: number): void {
    if (this.isHeightLocked) return;
    
    this.heightSamples.push(height);
    
    if (this.heightSamples.length >= this.sampleSize) {
      const sum = this.heightSamples.reduce((a, b) => a + b, 0);
      this.estimatedRowHeight = sum / this.heightSamples.length;
      this.isHeightLocked = true;
      this.updateSpacerHeight();
      console.log(`Height locked at ${this.estimatedRowHeight}px`);
    }
  }
  
  private updateSpacerHeight(): void {
    const totalHeight = this.totalRows * this.estimatedRowHeight;
    this.spacer.style.height = `${totalHeight}px`;
  }
}
```

**장점:**
- 스크롤바 길이가 한 번만 변경됨
- 초기 50개 행 렌더링 후 안정화
- 대부분의 사용 사례에서 충분히 정확

**단점:**
- 샘플 행들이 전체를 대표하지 못할 수 있음

---

### 전략 B: 스크롤 멈춤 시 업데이트

```typescript
class ProxyScrollVirtualizer {
  private scrollEndTimer: number | null = null;
  private measuredHeights: number[] = [];
  private pendingUpdate = false;
  
  measureRow(index: number, height: number): void {
    this.measuredHeights[index] = height;
    this.pendingUpdate = true;
  }
  
  private onProxyScroll = (): void => {
    // 기존 로직...
    
    // 스크롤 멈춤 감지
    if (this.scrollEndTimer) clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = window.setTimeout(() => {
      if (this.pendingUpdate) {
        this.recalculateAverageHeight();
        this.pendingUpdate = false;
      }
    }, 150);
  };
  
  private recalculateAverageHeight(): void {
    const measured = this.measuredHeights.filter(h => h !== undefined);
    if (measured.length > 0) {
      const avg = measured.reduce((a, b) => a + b, 0) / measured.length;
      
      // 스크롤 위치 보정
      const oldHeight = this.estimatedRowHeight;
      const scrollRatio = this.scrollProxy.scrollTop / this.scrollProxy.scrollHeight;
      
      this.estimatedRowHeight = avg;
      this.updateSpacerHeight();
      
      // 스크롤 위치 복원
      this.scrollProxy.scrollTop = scrollRatio * this.scrollProxy.scrollHeight;
    }
  }
}
```

**장점:**
- 더 정확한 평균 높이 계산
- 스크롤 중에는 변경 없음

**단점:**
- 스크롤 멈출 때마다 약간의 점프 가능
- 구현 복잡도 증가

---

### 전략 C: 완전 고정값 사용

```typescript
interface VirtualizerOptions {
  estimatedRowHeight: number;  // 사용자가 직접 지정
}

class ProxyScrollVirtualizer {
  constructor(options: VirtualizerOptions) {
    this.estimatedRowHeight = options.estimatedRowHeight;
    // 측정/업데이트 없음
  }
}
```

**장점:**
- 가장 단순
- 사이드 이펙트 전혀 없음

**단점:**
- 예상값이 실제와 많이 다르면 스크롤 위치 부정확

---

## 전략 비교

| 전략 | 정확도 | 안정성 | 복잡도 | 권장 상황 |
|------|--------|--------|--------|----------|
| **A. 샘플링 후 고정** | ★★★★☆ | ★★★★★ | ★★☆☆☆ | **대부분의 경우 (기본값)** |
| B. 스크롤 멈춤 시 | ★★★★★ | ★★★☆☆ | ★★★★☆ | 정확도가 중요할 때 |
| C. 완전 고정 | ★★☆☆☆ | ★★★★★ | ★☆☆☆☆ | 높이가 거의 일정할 때 |

---

## 최종 구현 인터페이스

```typescript
interface ProxyScrollOptions {
  /**
   * 초기 예상 행 높이 (픽셀)
   * @default 40
   */
  estimatedRowHeight?: number;
  
  /**
   * 평균 계산에 사용할 샘플 수
   * @default 50
   */
  sampleSize?: number;
  
  /**
   * 샘플링 후 높이 고정 여부
   * @default true
   */
  lockHeightAfterSample?: boolean;
  
  /**
   * 스크롤 멈춤 시 높이 재계산 여부 (lockHeight가 false일 때만)
   * @default false
   */
  recalculateOnScrollEnd?: boolean;
}

// 기본 설정 (권장)
const defaultOptions: ProxyScrollOptions = {
  estimatedRowHeight: 40,
  sampleSize: 50,
  lockHeightAfterSample: true,
  recalculateOnScrollEnd: false,
};
```

---

## 유사 사례

| 라이브러리 | 접근 방식 |
|-----------|----------|
| react-window | estimateSize + 동적 측정 |
| tanstack-virtual | Proxy 스크롤 + 측정 |
| AG Grid | 복합 방식 (설정에 따라) |
| Slack/Discord | 커스텀 스크롤 + 가변 높이 |

---

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [가로 가상화 전략](./002-horizontal-virtualization.md)
