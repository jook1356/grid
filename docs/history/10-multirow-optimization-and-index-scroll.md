# 10. Multi-Row 최적화 및 인덱스 기반 스크롤

## 날짜
2026-01-19

## 이번 회차에서 구현한 내용

### 1. RowPool Multi-Row 지원 ✅

Multi-Row 모드에서도 RowPool을 사용하여 DOM 요소를 재활용합니다.

#### 변경 전 (문제)
```typescript
// 매 스크롤마다 전체 재생성
this.rowContainer.innerHTML = '';
for (let i = start; i <= end; i++) {
  this.multiRowRenderer.renderDataRow(...);  // 매번 새 DOM 생성
}
```

#### 변경 후 (개선)
```typescript
// RowPool로 컨테이너 재활용
const activeRows = this.rowPool.updateVisibleRange(start, end);
for (const [rowIndex, container] of activeRows) {
  this.multiRowRenderer.updateDataRow(container, ...);  // 기존 DOM 재사용
}
```

#### 성능 효과
| 항목 | 이전 | 이후 |
|------|------|------|
| 스크롤 시 DOM 생성 | 매번 전체 생성 | 0개 (재사용) |
| GC 부담 | 높음 | 낮음 |

### 2. 인덱스 기반 가상 스크롤 ✅

VirtualScroller를 인덱스 기반으로 리팩토링했습니다.

#### 핵심 개념

```
Proxy 스크롤 (고정)          실제 렌더링 (가변)
┌──────────────┐             ┌──────────────┐
│ 36px → row 0 │      →      │ 50px (실제)  │
│ 36px → row 1 │      →      │ 30px (실제)  │
│ 36px → row 2 │      →      │ 80px (실제)  │
└──────────────┘             └──────────────┘
    고정 높이                    가변 높이
```

- **Spacer 높이**: 항상 `totalRows × 36px` (고정)
- **스크롤 비율 → row 인덱스**: O(1) 계산
- **렌더링**: 실제 행 높이 사용

#### 장점
1. **직관적**: 스크롤 50% = row 인덱스 50%
2. **일관성**: row 높이가 달라도 스크롤바 동작 동일
3. **끝점 정확**: 맨 위/맨 아래 항상 정확
4. **간단함**: spacer 높이 계산 불필요

#### API 변경

```typescript
// 신규 API
virtualScroller.setRenderRowHeight(height);  // 렌더링용 높이 설정

// deprecated (호환성 유지)
virtualScroller.setRowHeight(height);
virtualScroller.setContentHeight(height);
```

### 3. Multi-Row CSS 개선 ✅

#### rowSpan 셀 border 문제 해결
```css
/* rowSpan 셀의 왼쪽 border 추가 (인접 셀 border가 배경에 가려지는 문제 해결) */
.ps-multi-row-cell.ps-rowspan {
  border-left: var(--ps-border-width) solid var(--ps-border-color);
  margin-left: calc(-1 * var(--ps-border-width));  /* 겹치게 하여 2px 방지 */
}
```

#### Row 배경색 확장
```css
.ps-row {
  min-width: 100%;  /* 배경색이 그리드 끝까지 채워짐 */
  width: max-content;  /* 컨텐츠가 더 넓으면 확장 */
}

.ps-multirow-container {
  height: auto;  /* Grid의 gridTemplateRows에 의해 결정 */
}
```

#### 마지막 컬럼 border 유지
```css
/* 주석 처리하여 우측 border 유지 */
/* .ps-cell:last-child { border-right: none; } */
/* .ps-multi-row-cell.ps-last-column { border-right: none; } */
```

### 4. VirtualScroller 버그 수정 ✅

#### row 수가 적을 때 첫 번째 row 가려짐 문제
```typescript
getRowOffset(): number {
  // row 수가 viewport를 채우지 못하면 offset 불필요
  if (this.totalRows <= visibleCount) {
    return 0;  // 음수 offset 방지
  }
  // ...
}
```

---

## 생성/수정된 파일 목록

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/ui/VirtualScroller.ts` | 인덱스 기반 스크롤로 리팩토링, `setRenderRowHeight()` 추가 |
| `src/ui/body/RowPool.ts` | Multi-Row 템플릿 지원 (`setMultiRowTemplate()`) |
| `src/ui/body/BodyRenderer.ts` | Multi-Row에서 RowPool 사용, `setRenderRowHeight()` 연결 |
| `src/ui/multirow/MultiRowRenderer.ts` | `updateDataRow()` 추가 (DOM 재사용) |
| `src/ui/GridRenderer.ts` | `setRenderRowHeight()` API 노출 |
| `src/ui/style/default.css` | rowSpan border, Row 배경색, 마지막 컬럼 border 수정 |

---

## 핵심 개념 설명

### 인덱스 기반 스크롤 vs 높이 기반 스크롤

| 항목 | 높이 기반 (기존) | 인덱스 기반 (현재) |
|------|-----------------|-----------------|
| spacer 높이 | 실제 콘텐츠 높이 | `totalRows × 36px` |
| 스크롤 → 인덱스 | `scrollTop / rowHeight` | `scrollRatio × maxIndex` |
| 가변 높이 처리 | spacer 높이 조정 필요 | 렌더링 높이만 변경 |
| 끝점 정확도 | 조정 필요 | 항상 정확 |

### RowPool 동작 원리

```
[스크롤 전]
Pool: []
Active: { 0: div, 1: div, 2: div }

[스크롤 후]
Pool: [div(0), div(1)]  ← 범위 밖 행 반환
Active: { 2: div, 3: div(재사용), 4: div(재사용) }
```

---

## 테스트 방법

```bash
pnpm dev
```

### Multi-Row 테스트
http://localhost:5173/demo/examples/multi-row.html

1. 2줄/3줄 레이아웃 전환
2. 스크롤 동작 확인 (부드러움)
3. 마지막 row까지 스크롤 가능 확인
4. rowSpan 셀 border 확인

### 그룹화 테스트
http://localhost:5173/demo/examples/grouping.html

1. 모든 그룹 접기
2. 첫 번째 그룹이 헤더에 가려지지 않는지 확인

---

## 다음 회차 예고

1. **셀 병합**
   - MergeManager 구현
   - 데이터 레벨 병합 (same-value)

2. **가변 높이 row 완전 지원**
   - 각 row의 실제 높이 측정
   - 누적 높이 캐싱

3. **프레임워크 래퍼**
   - React 래퍼
   - Vue 래퍼
