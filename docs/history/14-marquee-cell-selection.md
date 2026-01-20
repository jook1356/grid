# 14. Marquee Cell Selection (다중 셀 선택)

## 개요

그리드 셀의 다중 선택(Marquee Selection) 기능을 구현했습니다. 사용자가 드래그, Shift+클릭, Ctrl+클릭으로 여러 셀을 선택할 수 있습니다.

## Selection Mode (선택 모드)

### 4가지 모드

| 모드 | 클릭 | 드래그 | `selectedCells` | `selectedRows` | 행 하이라이트 |
|------|------|--------|-----------------|----------------|--------------|
| `'none'` | ❌ | ❌ | `[]` | `[]` | ❌ |
| `'row'` | 행 선택 | 행 범위 선택 | `[]` | `[id1, id2]` | ✅ |
| `'range'` | 셀 선택 | 셀 범위 선택 | `["0:name"]` | `[]` | ❌ |
| `'all'` | 셀 선택 | 셀 범위 선택 | `["0:name"]` | `[id1]` (자동) | ✅ |

### 모드별 동작

```typescript
// row 모드: 행 선택 로직만, 셀 선택 로직 skip
if (selectionMode === 'row') { 
  // 클릭/드래그 → selectedRows에 행 ID 추가
}

// range 모드: 셀 선택 로직만, 행 선택 로직 skip
if (selectionMode === 'range') {
  // 클릭/드래그 → selectedCells에 셀 키 추가
  // ps-selected 클래스 미적용
}

// all 모드: 셀 선택 + 행 자동 동기화
if (selectionMode === 'all') {
  // 셀 선택 후 syncRowsFromCells()로 행도 자동 추가
}
```

## 구현된 기능

### 1. 드래그 선택
- 마우스 드래그로 사각형 범위 선택
- `row` 모드: 행 범위 선택
- `range`/`all` 모드: 셀 범위 선택
- 뷰포트 경계에서 자동 스크롤

### 2. Shift + 클릭
- 앵커 셀에서 클릭한 셀까지 범위 확장
- 연속된 사각형 영역 선택

### 3. Ctrl + 클릭
- 개별 셀/행 토글 선택
- 비연속적인 선택 가능

### 4. Ctrl + 드래그
- 기존 선택 유지하면서 새 범위 추가

### 5. 키보드 지원
- Ctrl+A: 전체 선택
- Shift+화살표: 선택 범위 확장
- Escape: 선택 해제
- Home/End: 첫/마지막 열로 이동 (현재 순서 기준)
- Ctrl+Home/End: 첫/마지막 셀로 이동

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

### 컬럼 순서 동기화

컬럼 순서가 UI에서 변경되어도 선택 로직이 올바르게 동작:

```typescript
// SelectionManager 내부
private columnIndexMap: Map<string, number> = new Map();  // 키 → 인덱스
private columnKeysByIndex: string[] = [];                  // 인덱스 → 키

// 컬럼 순서 변경 시 호출
updateColumnIndexMap(columnKeys?: string[]): void {
  // UI에서 전달된 순서로 업데이트
  this.columnKeysByIndex = [...columnKeys];
  columnKeys.forEach((key, index) => {
    this.columnIndexMap.set(key, index);
  });
}
```

**연동 흐름:**
```
컬럼 드래그 → HeaderRenderer → GridRenderer.handleColumnReorder
→ PureSheet.handleColumnReorder → SelectionManager.updateColumnIndexMap(order)
→ 다음 선택부터 새 순서 적용
```

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
  - `SelectionMode` 타입: `'none' | 'row' | 'range' | 'all'`
  - `SelectionState` 인터페이스
  - `selectedCells`: `Set<string>`

### 선택 로직
- `src/ui/interaction/SelectionManager.ts`
  - `isCellSelectionMode()`: 셀 선택 모드 확인 헬퍼
  - `startDragSelection()`: 모드별 드래그 시작
  - `updateDragSelection()`: 모드별 드래그 업데이트
  - `commitDragSelection()`: 드래그 완료
  - `selectCellRange()`: 셀 범위 선택
  - `toggleCellSelection()`: Ctrl+클릭 토글
  - `syncRowsFromCells()`: 'all' 모드에서 행 자동 동기화
  - `updateColumnIndexMap()`: 컬럼 순서 변경 시 인덱스 맵 업데이트
  - `columnKeysByIndex`: 현재 UI 순서의 컬럼 키 배열

### UI 렌더링
- `src/ui/body/BodyRenderer.ts`
  - `selectionMode` 옵션 추가
  - `updateCellSelection()`: 모드에 따른 조건부 행 하이라이트
  - `handleMouseDown/Move/Up()`: 드래그 처리
  - `checkAutoScroll()`: 자동 스크롤 체크

- `src/ui/GridRenderer.ts`
  - `selectionMode`를 BodyRenderer에 전달
  - `onColumnReorder` 콜백 전달

- `src/ui/PureSheet.ts`
  - `handleColumnReorder()`: 컬럼 순서 변경 핸들러 추가
  - `updateSelectionUI()`: 모드별 UI 업데이트

### CSS 스타일
- `src/ui/style/default.css`
  - `.ps-cell.ps-cell-selected`: 선택된 셀 배경색
  - `.ps-row.ps-selected`: 선택된 행 배경색
  - 다크 테마 지원

### 예제 페이지
- `demo/examples/selection-modes.html`
  - 4가지 선택 모드 비교 데모
  - 실시간 선택 상태 표시
  - 모드 전환 기능

## 사용 방법

### 선택 모드 설정

```typescript
const grid = new PureSheet(container, {
  columns: [...],
  selectionMode: 'all',   // 'none' | 'row' | 'range' | 'all'
  multiSelect: true,
});
```

### 선택된 데이터 가져오기

```typescript
// 선택 변경 이벤트 구독
grid.on('selection:changed', (state) => {
  console.log('선택된 행:', state.selectedRows);   // 행 ID 배열
  console.log('선택된 셀:', state.selectedCells);  // 셀 키 배열 ["0:name", "1:email"]
});
```

## 시각적 표현

- **선택된 셀**: 반투명 파란색 배경 (`rgba(25, 118, 210, 0.15)`)
- **선택된 행**: 같은 배경색 (`ps-selected` 클래스)
- **다크 테마**: 자동으로 어두운 색상 적용

## 성능 최적화

1. **Set.has() O(1) 조회**: 렌더링 시 빠른 선택 상태 확인
2. **requestAnimationFrame**: 자동 스크롤에 사용
3. **이벤트 위임**: viewport에서 이벤트 처리
4. **조건부 업데이트**: 변경된 셀만 스타일 업데이트
5. **헬퍼 메서드**: `isCellSelectionMode()` 등으로 반복 조건 단순화

## 변경 이력

### 2024-01 (초기 구현)
- 드래그 셀 선택 기능 구현
- Set 기반 선택 상태 관리
- 마키 오버레이 표시

### 2026-01 (리팩토링)
- SelectionMode 4가지로 정리 (`none`, `row`, `range`, `all`)
- `row` 모드에서 드래그 행 선택 지원
- `range` 모드에서 행 하이라이트 제거
- 컬럼 순서 변경과 선택 로직 동기화
- `columnKeysByIndex` 배열로 현재 UI 순서 추적
- 마키 오버레이 제거 (배경색만 사용)
- 디버그 로그 정리
- 예제 페이지 추가

## 다음 단계 (선택)

- 복사/붙여넣기 기능 (Ctrl+C, Ctrl+V)
- 선택 영역 데이터 내보내기
- 셀 범위 수식 지원
- 런타임 선택 모드 변경 API (`setSelectionMode()`)
