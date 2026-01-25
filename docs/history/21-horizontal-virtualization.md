# 21. 가로 가상화 (Horizontal Virtualization)

## 작업 일자
2026-01-25

## 개요

컬럼 수가 많은 그리드(50개 이상)에서 성능을 향상시키기 위해 가로 가상화 기능을 구현했습니다. 세로 가상화와 동일한 원리로, 보이는 컬럼만 DOM에 렌더링합니다.

## 왜 이게 필요한가?

1. **DOM 성능**: 컬럼이 100개 이상이면 모든 셀을 렌더링하면 성능 저하 발생
2. **메모리 효율**: 보이지 않는 셀의 DOM 요소를 생성하지 않음
3. **일관된 UX**: 세로 가상화와 동일한 방식으로 스크롤 성능 유지

## 핵심 구현 내용

### 1. HorizontalVirtualScroller 클래스

```
┌──────────────────────────────────────────────────────────────────┐
│                    HorizontalVirtualScroller                      │
│  - 가로 스크롤 위치에 따라 visible column range 계산              │
│  - 컬럼 offset 캐싱 (O(n) 한 번)                                  │
│  - 이진 탐색으로 범위 계산 (O(log n))                             │
│  - overscan 지원 (좌우 추가 렌더링)                               │
└──────────────────────────────────────────────────────────────────┘
```

**주요 API**:
- `attach(scrollProxyX, viewport, spacerX)`: DOM 요소 연결
- `setCenterColumns(columns)`: Center 컬럼 설정
- `getVisibleRange()`: 현재 보이는 컬럼 범위 반환
- `getVisibleColumns()`: 보이는 컬럼 배열 반환
- `on('rangeChanged', callback)`: 범위 변경 이벤트

### 2. 컬럼 영역 구분

```
┌─────────┬───────────────────────────┬─────────┐
│  Left   │         Center            │  Right  │
│ (고정)  │      (가상화 대상)        │ (고정)  │
│         │  ◄── 보이는 범위만 렌더 ──►  │         │
└─────────┴───────────────────────────┴─────────┘
```

- **Left/Right**: 항상 모두 렌더링 (고정 컬럼)
- **Center**: 가상화 적용, viewport에 보이는 컬럼만 렌더링

### 3. 오프셋 기반 위치 계산

```typescript
interface HorizontalVirtualRange {
  startIndex: number;    // 첫 번째 visible 컬럼 인덱스
  endIndex: number;      // 마지막 visible 컬럼 인덱스 (exclusive)
  offsetLeft: number;    // 첫 컬럼의 왼쪽 offset (px)
  totalWidth: number;    // Center 영역 전체 너비
}
```

### 4. Row 클래스 수정

`RowRenderContext`에 `horizontalVirtualRange`를 추가하여 Row가 가상화된 컬럼만 렌더링:

```typescript
private renderData(container: HTMLElement, context: RowRenderContext): void {
  const { columnGroups, horizontalVirtualRange } = context;

  let visibleCenterColumns = columnGroups.center;
  let centerOffsetLeft = 0;

  if (horizontalVirtualRange) {
    // 가상화된 범위의 컬럼만 렌더링
    visibleCenterColumns = columnGroups.center.slice(
      horizontalVirtualRange.startIndex,
      horizontalVirtualRange.endIndex
    );
    centerOffsetLeft = horizontalVirtualRange.offsetLeft;
  }

  // Center 영역 위치 조정
  centerContainer.style.transform = `translateX(${centerOffsetLeft}px)`;
}
```

## 주요 파일 변경

### 신규 파일
- `src/ui/HorizontalVirtualScroller.ts`: 가로 가상화 스크롤러

### 수정 파일
- `src/ui/types.ts`: `HorizontalVirtualRange` 인터페이스 (이미 존재)
- `src/ui/row/types.ts`: `RowRenderContext`에 `horizontalVirtualRange` 추가
- `src/ui/body/BodyRenderer.ts`: HorizontalVirtualScroller 연동
- `src/ui/header/HeaderRenderer.ts`: 가로 가상화 범위 설정 API 추가
- `src/ui/row/Row.ts`: 가상화된 컬럼만 렌더링
- `src/ui/interaction/ColumnManager.ts`: offset 계산 메서드 추가
- `src/ui/GridRenderer.ts`: Header/Body 가로 가상화 동기화

## 자동 활성화

컬럼 수가 임계값(기본 30개) 이상이면 자동으로 가상화 활성화:

```typescript
const horizontalScroller = new HorizontalVirtualScroller({
  enabled: false,              // 수동 활성화
  autoEnableThreshold: 30,     // 30개 이상이면 자동 활성화
  overscan: 2,                 // 좌우 2개씩 추가 렌더링
});
```

## 성능 향상

| 컬럼 수 | 가상화 전 | 가상화 후 |
|---------|-----------|-----------|
| 50개    | ~500 셀   | ~50 셀    |
| 100개   | ~1000 셀  | ~50 셀    |
| 200개   | ~2000 셀  | ~50 셀    |

(50행 기준, viewport에 보이는 컬럼 약 10개 가정)

## 제한사항

1. **Multi-Row 모드**: 가로 가상화 미지원 (복잡한 셀 배치로 인해)
2. **피벗 모드**: 가로 가상화 미지원 (계층적 헤더로 인해)
3. **셀 병합**: 병합된 셀이 가상화 범위 경계에 걸치면 처리 필요

## 다음 단계

- [ ] 피벗 모드에서 가로 가상화 지원
- [ ] 셀 병합과 가로 가상화 통합 테스트
- [ ] 가변 컬럼 너비 최적화
