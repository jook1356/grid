# 002: 가로 가상화 (Horizontal Virtualization) 전략

## 상태
**보류 (Deferred)** - 필요 시 구현 예정

## 날짜
2026-01-17

## 배경

Grid 라이브러리에서 대용량 데이터(100만 행) 처리를 위해 가상화(Virtualization)가 필수입니다.
가상화에는 두 가지 차원이 있습니다:

| 차원 | 대상 | 필요 상황 |
|------|------|----------|
| **세로 (Vertical)** | 행 (Rows) | 행이 수천~수백만 개일 때 (필수) |
| **가로 (Horizontal)** | 컬럼 (Columns) | 컬럼이 50개 이상일 때 (선택적) |

## 현재 결정

### 세로 가상화: 구현 ✅
- 100만 행 지원이 핵심 요구사항
- `VirtualScroller`에서 `visibleStart ~ visibleEnd` 범위의 행만 DOM에 렌더링

### 가로 가상화: 보류 ⏸️
- 대부분의 사용 사례에서 컬럼 수는 20~30개 이하
- 컬럼이 적을 때 가로 가상화는 오버헤드만 증가
- 구조적으로 나중에 추가 가능하도록 설계

## 가로 가상화 분석

### 복잡도 비교

| 항목 | 세로 가상화 | 가로 가상화 |
|------|------------|------------|
| **크기 계산** | 행 높이 고정 → 단순 | 컬럼 너비 가변 → 복잡 |
| **offset 계산** | `index × rowHeight` | 각 컬럼 너비 합산 필요 |
| **리사이즈** | 없음 | 컬럼 리사이즈 시 재계산 |
| **고정 영역** | 없음 | Pinned 컬럼과 동기화 |

### 구현 시 고려사항

```
세로 가상화만:  1차원 → visibleRowStart ~ visibleRowEnd
가로+세로:      2차원 → (rowStart~rowEnd) × (colStart~colEnd)
```

**추가 작업:**
1. `HorizontalVirtualScroller` 클래스 구현
2. 컬럼 offset 캐싱 (`[0, 100, 250, 400, ...]`)
3. 컬럼 리사이즈 시 offset 재계산
4. Pinned 컬럼(left/right)과 가상화 영역(center) 동기화

### 안정성 이슈

| 이슈 | 발생 상황 | 해결책 |
|------|----------|--------|
| 깜빡임 | 빠른 가로 스크롤 | overscan 증가, RAF throttle |
| 셀 선택 오류 | 가상화된 셀로 키보드 이동 | 강제 스크롤 후 선택 |
| 에디터 이탈 | 편집 중 스크롤 | 편집 셀 강제 렌더링 유지 |

## 확장성을 위한 현재 설계

가로 가상화를 나중에 추가할 수 있도록 인터페이스에 여지를 남겨둡니다:

```typescript
// src/ui/types.ts

/**
 * 렌더링 범위
 * 현재는 행(row)만 사용하지만, 가로 가상화 시 컬럼 범위도 사용
 */
interface RenderRange {
  rowStart: number;
  rowEnd: number;
  colStart?: number;  // 가로 가상화 시 사용
  colEnd?: number;    // 가로 가상화 시 사용
}

/**
 * BodyRenderer에서 렌더링할 범위를 받는 인터페이스
 */
interface BodyRendererOptions {
  getVisibleRange(): RenderRange;
}
```

### 컬럼 상태 관리 준비

```typescript
// src/ui/interaction/ColumnManager.ts

interface ColumnState {
  key: string;
  width: number;
  offset: number;      // 가로 가상화 시 사용 (해당 컬럼의 시작 x좌표)
  visible: boolean;
  pinned: 'left' | 'right' | null;
}

class ColumnManager {
  private columns: ColumnState[] = [];
  
  /**
   * 컬럼 offset 재계산
   * 가로 가상화 시 어떤 컬럼이 viewport에 있는지 빠르게 판단
   */
  recalculateOffsets(): void {
    let offset = 0;
    for (const col of this.columns) {
      col.offset = offset;
      offset += col.width;
    }
  }
  
  /**
   * 주어진 x 범위에 해당하는 컬럼 인덱스 반환
   * 가로 가상화 시 사용
   */
  getColumnsInRange(startX: number, endX: number): { start: number; end: number } {
    // 이진 탐색으로 O(log n) 구현 가능
    // ...
  }
}
```

## 가로 가상화가 필요한 시점

다음 조건 중 하나라도 해당되면 구현을 검토합니다:

1. **컬럼 수 50개 이상** 사용 사례 발생
2. **셀 렌더링이 복잡** (커스텀 셀 렌더러, 이미지 등)
3. **모바일 환경**에서 성능 이슈 발생
4. **사용자 피드백**으로 가로 스크롤 성능 문제 제기

## 결론

- **현재**: 세로 가상화만 구현, 가로는 일반 스크롤
- **확장성**: 인터페이스에 `colStart/colEnd` 여지 확보
- **향후**: 필요 시 `HorizontalVirtualScroller` 추가

이 결정으로 초기 구현 복잡도를 낮추면서도, 나중에 큰 리팩토링 없이 가로 가상화를 추가할 수 있습니다.

## 관련 문서

- [UI Architecture](../base/ARCHITECTURE-UI.md)
- [Worker 환경 지원 전략](./001-worker-environment-support.md)
