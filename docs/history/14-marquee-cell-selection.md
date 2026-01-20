# 14. Marquee Cell Selection (다중 셀 선택)

## 개요

그리드 셀의 다중 선택(Marquee Selection) 기능을 구현했습니다. 사용자가 드래그, Shift+클릭, Ctrl+클릭으로 여러 셀을 선택할 수 있습니다.

## 구현된 기능

### 1. 드래그 선택
- 마우스 드래그로 사각형 범위의 셀 선택
- 드래그 중 마키 오버레이(반투명 박스) 표시
- 뷰포트 경계에서 자동 스크롤

### 2. Shift + 클릭
- 앵커 셀에서 클릭한 셀까지 범위 확장
- 연속된 사각형 영역 선택

### 3. Ctrl + 클릭
- 개별 셀 토글 선택
- 비연속적인 셀 선택 가능

### 4. 키보드 지원
- Ctrl+A: 전체 셀 선택
- Shift+화살표: 선택 범위 확장
- Escape: 선택 해제

## 핵심 설계

### Set 기반 셀 저장

```typescript
// 선택된 셀을 "rowIndex:columnKey" 문자열로 저장
selectedCells: Set<string> = new Set();

// O(1) 조회로 렌더링 성능 보장
selectedCells.has(`${rowIndex}:${columnKey}`);
```

**장점:**
- 셀 선택 여부 확인이 O(1)로 매우 빠름
- 스크롤 시 수백 개 셀 체크해도 성능 저하 없음
- 중복 걱정 없음 (Set 특성)

### 가상 스크롤러 연동

드래그 중 뷰포트 경계에 도달하면 자동 스크롤:

```typescript
// 마우스가 뷰포트 상/하단 근처에 있으면 자동 스크롤
if (mouseY < viewportTop + 50) {
  virtualScroller.scrollToRow(currentRow - 1);
} else if (mouseY > viewportBottom - 50) {
  virtualScroller.scrollToRow(currentRow + 1);
}
```

## 수정된 파일

### 타입 정의
- `src/ui/types.ts`
  - `CellRange` 인터페이스 추가
  - `SelectionState` 확장 (isDragging, dragStartCell, dragEndCell, selectionRange)
  - `selectedCells`를 `Map`에서 `Set`으로 변경

### 선택 로직
- `src/ui/interaction/SelectionManager.ts`
  - `startDragSelection()`: 드래그 시작
  - `updateDragSelection()`: 드래그 중 범위 업데이트
  - `commitDragSelection()`: 드래그 완료
  - `selectCellRange()`: 범위 내 모든 셀 선택
  - `toggleCellSelection()`: Ctrl+클릭 토글
  - `isCellSelected()`: O(1) 선택 여부 확인
  - `dragSelectionChanged` 이벤트 추가

### UI 렌더링
- `src/ui/body/BodyRenderer.ts`
  - `handleMouseDown()`: 드래그 시작 처리
  - `handleMouseMove()`: 드래그 중 처리
  - `handleMouseUp()`: 드래그 종료 처리
  - `createMarqueeOverlay()`: 마키 오버레이 생성
  - `updateMarqueeOverlay()`: 마키 위치/크기 업데이트
  - `updateCellSelectionStyles()`: 셀 선택 스타일 적용
  - `checkAutoScroll()`: 자동 스크롤 체크
  - `startAutoScroll()`: 자동 스크롤 시작
  - `stopAutoScroll()`: 자동 스크롤 중지

- `src/ui/GridRenderer.ts`
  - 드래그 선택 콜백 전달 추가

- `src/ui/PureSheet.ts`
  - 드래그 선택 이벤트 핸들러 연결
  - `updateCellSelectionUI()` 메서드 추가

### CSS 스타일
- `src/ui/style/default.css`
  - `.ps-cell.ps-cell-selected`: 선택된 셀 배경색
  - `.ps-marquee-overlay`: 드래그 중 마키 박스
  - 다크 테마 지원
  - CSS 변수로 커스터마이징 가능

## 사용 방법

### 선택 모드 설정

```typescript
const grid = new PureSheet(container, {
  columns: [...],
  selectionMode: 'range',  // 범위 선택 모드 활성화
  multiSelect: true,
});
```

### 선택된 셀 가져오기

```typescript
// 선택 변경 이벤트 구독
grid.on('selection:changed', (state) => {
  console.log('선택된 셀:', state.selectedCells);
});
```

## 시각적 표현

- **선택된 셀**: 반투명 파란색 배경 (`rgba(25, 118, 210, 0.15)`)
- **마키 오버레이**: 파란색 테두리 + 반투명 배경
- **다크 테마**: 자동으로 어두운 색상 적용

## 성능 최적화

1. **Set.has() O(1) 조회**: 렌더링 시 빠른 선택 상태 확인
2. **requestAnimationFrame**: 자동 스크롤에 사용
3. **이벤트 위임**: viewport에서 이벤트 처리
4. **조건부 업데이트**: 변경된 셀만 스타일 업데이트

## 다음 단계 (선택)

- 복사/붙여넣기 기능 (Ctrl+C, Ctrl+V)
- 선택 영역 데이터 내보내기
- 셀 범위 수식 지원

