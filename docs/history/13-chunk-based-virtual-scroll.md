# 13회차: 청크 기반 가상 스크롤 구현

## 이번 회차에서 구현한 내용

브라우저 높이 제한(~16M px)을 우회하여 수백만 행을 지원하는 청크 기반 가상 스크롤을 구현했습니다.

### 문제 상황

- 기존 가상 스크롤은 전체 데이터 높이를 하나의 컨테이너에 설정
- 브라우저별 최대 요소 높이 제한: Chrome ~33M, Firefox ~17M
- 500만 행 × 36px = 180M px → 브라우저 제한 초과

### 해결 방법: 청크 기반 스크롤

```
┌─────────────────────────────────────────────────────────────┐
│                    Proxy Scrollbar                          │
│  (전체 데이터 범위 표시, SPACER_ROW_HEIGHT로 높이 계산)       │
└─────────────────────────────────────────────────────────────┘
                              ↕ 동기화
┌─────────────────────────────────────────────────────────────┐
│                      Viewport                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              rowContainer (현재 청크)                │   │
│  │    높이 = chunkRowCount × renderRowHeight           │   │
│  │    (최대 ~10M px, 브라우저 제한 내)                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 핵심 아이디어

1. **데이터를 청크로 분할**: `chunkSize = floor(10,000,000 / rowHeight)` ≈ 277,777행/청크
2. **현재 청크만 렌더링**: rowContainer 높이는 항상 브라우저 제한 내
3. **네이티브 스크롤**: 청크 내에서는 브라우저 기본 휠/터치 스크롤 사용
4. **청크 전환**: 경계에 도달하면 부드럽게 다음/이전 청크로 전환
5. **프록시 스크롤바**: 전체 데이터 범위를 나타내는 별도 스크롤바

## 생성/수정된 파일 목록

### 수정된 파일

1. **`src/ui/VirtualScroller.ts`** (완전 재작성)
   - 청크 기반 로직 구현
   - `getChunkForIndex()`, `getChunkStartIndex()`, `getChunkRowCount()` 추가
   - `getTotalChunks()` - 마지막 청크가 너무 작으면 병합
   - `transitionToAdjacentChunk()` - 청크 전환 (스크롤 위치 유지)
   - `syncProxyScrollbar()`, `syncViewportScroll()` - 양방향 동기화

2. **`src/ui/body/BodyRenderer.ts`**
   - `virtualScroller.getRowOffsetInChunk(rowIndex)` 사용하여 청크 내 상대 위치로 행 배치
   - `renderDataRow()`, `renderGroupHeader()`, `renderMultiRowMode()` 수정

3. **`src/ui/style/default.css`**
   - 터치 디바이스에서 `.ps-scroll-proxy`에 `pointer-events: none` 적용
   - 터치 스크롤이 viewport를 직접 스크롤하도록 변경

## 핵심 개념 설명

### 청크 크기 계산

```typescript
const MAX_CHUNK_HEIGHT = 10_000_000;  // 안전한 최대 높이
const chunkSize = Math.floor(MAX_CHUNK_HEIGHT / renderRowHeight);
// 36px 행 기준: 277,777 행/청크
```

### 마지막 청크 병합

마지막 청크가 너무 작으면(BUFFER × 2 미만) 이전 청크에 병합:

```typescript
// 500만 행 예시:
// - 원래: chunk 18에 14행만 있음 → 스크롤 공간 부족
// - 병합 후: chunk 17이 마지막, 277,791행 포함
```

### 스크롤 동기화

```
[Proxy Scrollbar 드래그]
     ↓
scrollRatio = scrollTop / maxScroll
     ↓
targetStartIndex = scrollRatio × maxStartIndex
     ↓
청크 전환 + viewport.scrollTop 동기화

[Viewport 휠/터치 스크롤]
     ↓
indexInChunk = scrollTop / rowHeight
     ↓
청크 경계 감지 → 전환
     ↓
proxy.scrollTop 동기화
```

### 청크 전환 버퍼

```typescript
const CHUNK_TRANSITION_BUFFER = 50;  // 행 수

// 다음 청크로 전환: indexInChunk >= chunkRowCount - 50
// 이전 청크로 전환: indexInChunk < 50
```

경계에서 50행 전에 미리 전환하여 부드러운 스크롤 경험 제공.

## 리팩토링 내용

### 제거된 코드

| 항목 | 이유 |
|------|------|
| `setRowHeight()` | deprecated, 외부 사용 없음 |
| `getEstimatedRowHeight()` | deprecated, 외부 사용 없음 |
| `getRowOffset()` | 외부 사용 없음 |
| `scroll` 이벤트 | 외부 구독 없음 |

### 통합된 코드

| 변경 전 | 변경 후 |
|---------|---------|
| `transitionToNextChunk()` | `transitionToAdjacentChunk('next')` |
| `transitionToPrevChunk()` | `transitionToAdjacentChunk('prev')` |

## 해결된 이슈

1. **500만 행 맨 아래 스크롤 버벅임**: 마지막 청크 병합으로 해결
2. **터치 스크롤 방향 반전**: CSS `pointer-events: none`으로 해결
3. **프록시 스크롤바 맨 아래 몇 픽셀 남음**: `syncViewportScroll()`에서 맨 아래 감지 후 최대 스크롤 위치 설정

## 사용 예시

```typescript
// VirtualScroller는 BodyRenderer 내부에서 자동 생성/관리됨
const sheet = new PureSheet(container, {
  columns: [...],
  data: generateLargeData(5_000_000),  // 500만 행
  rowHeight: 36,
});

// 특정 행으로 스크롤
sheet.scrollToRow(2_500_000);  // 250만 번째 행으로 이동
```

## 다음 회차 예고

- 가로 스크롤 가상화 (대량 컬럼 지원)
- 스크롤 성능 최적화 (throttle/debounce)