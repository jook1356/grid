# 16. 셀 병합 (Cell Merge Manager)

## 개요

Wijmo FlexGrid의 MergeManager 패턴을 참고하여 범용 셀 병합 시스템을 구현했습니다.
사용자가 쉽게 커스텀할 수 있는 확장 가능한 구조로 설계되었습니다.

## 왜 필요한가?

1. **데이터 가독성**: 같은 값이 반복되는 경우 병합하여 시각적으로 깔끔하게 표시
2. **계층적 표현**: 부서 → 팀 같은 계층 구조를 병합으로 표현
3. **커스텀 로직**: 비즈니스 로직에 맞는 다양한 병합 규칙 적용 가능

## 구현 내용

### 1. MergeManager 추상 클래스

Wijmo의 패턴을 참고한 확장 가능한 설계:

```typescript
// 사용자가 상속하여 커스텀 병합 로직 구현
abstract class MergeManager {
  // 특정 셀의 병합 범위 반환 (오버라이드 대상)
  abstract getMergedRange(
    rowIndex: number,
    columnKey: string,
    data: readonly Row[]
  ): MergedRange | null;

  // 렌더링용 병합 정보 (내부에서 사용)
  getCellMergeInfo(rowIndex, columnKey, data): CellMergeInfo;
}
```

### 2. 기본 제공 구현체

#### ContentMergeManager (같은 값 병합)

```typescript
// 'department' 컬럼에서 같은 값 병합
grid.setMergeManager(new ContentMergeManager(['department']));

// 여러 컬럼 병합
grid.setMergeManager(new ContentMergeManager(['department', 'status']));
```

#### HierarchicalMergeManager (계층적 병합)

```typescript
// 상위 컬럼 범위 내에서만 하위 컬럼 병합
// 예: 같은 부서 내에서만 상태 병합
grid.setMergeManager(new HierarchicalMergeManager(['department', 'status']));
```

#### CustomMergeManager (사용자 정의)

```typescript
// 완전한 커스텀 로직
grid.setMergeManager(new CustomMergeManager((row, col, data) => {
  // 원하는 조건에 따라 MergedRange 반환
  if (조건) {
    return { startRow, endRow, startCol, endCol };
  }
  return null;
}));
```

### 3. 병합 스타일

사용자 요구사항에 따른 스타일 구현:
- **앵커 셀**: 병합 범위의 첫 번째 셀만 표시, 높이 확장
- **숨김 셀**: `visibility: hidden`으로 숨김 (레이아웃 유지)

```css
/* 병합 앵커 셀 */
.ps-cell-merged-anchor {
  display: flex;
  align-items: center;  /* 세로 중앙 정렬 */
  z-index: 1;
  position: relative;
}

/* 병합된 숨김 셀 */
.ps-cell-merged-hidden {
  pointer-events: none;  /* 클릭 이벤트 방지 */
}
```

### 4. 성능 최적화 (v2 - 사전 계산)

**기존 문제점** (v1):
- 셀마다 O(n) 탐색으로 병합 범위 계산
- 캐시 키에 visibleStartIndex 포함 → 스크롤마다 캐시 무효화
- valuesEqual() 중복 구현

**개선된 구조** (v2):

```
[데이터 로드/변경 시]
    ↓
precomputeRanges()  ← O(n) 한 번만 실행
    ↓
Map<"row:col", MergedRange> 저장
    ↓
[렌더링 시]
    ↓
getMergedRange() → O(1) Map 조회
    ↓
applyDynamicAnchor() → 간단한 조건문
```

**주요 개선사항**:

1. **사전 계산 (Pre-computation)**
   - 데이터 로드 시 O(n)으로 모든 병합 범위 계산
   - 이후 조회는 O(1) Map lookup

2. **캐시 분리**
   - MergeManager: 원본 병합 정보 캐시 (데이터 변경 시만 무효화)
   - BodyRenderer: 캐시 제거 (동적 앵커는 간단한 조건문)

3. **코드 정리**
   - valuesEqual()을 기본 클래스로 이동 (중복 제거)
   - 동일한 MergedRange 객체 참조 공유 (메모리 효율)

**복잡도 비교**:
| 작업 | v1 | v2 |
|------|----|----|
| 셀당 병합 조회 | O(n) | O(1) |
| 스크롤 시 캐시 | 무효화 | 유지 |
| 메모리 | 캐시 중복 | 참조 공유 |

## 생성/수정된 파일

### 신규 생성
- `src/ui/merge/MergeManager.ts` - 추상 클래스 및 기본 구현체들
- `src/ui/merge/index.ts` - 모듈 내보내기
- `demo/examples/merge.html` - 데모 예제

### 수정
- `src/ui/row/types.ts` - RowRenderContext에 getMergeInfo 추가
- `src/ui/row/Row.ts` - renderCells에 병합 처리 로직 추가
- `src/ui/body/BodyRenderer.ts` - MergeManager 통합
- `src/ui/PureSheet.ts` - setMergeManager/getMergeManager API 추가
- `src/ui/index.ts` - merge 모듈 내보내기 추가
- `src/ui/style/default.css` - 병합 셀 스타일 추가

## API 요약

```typescript
// PureSheet API
grid.setMergeManager(manager: MergeManager | null): void;
grid.getMergeManager(): MergeManager | null;

// MergeManager 구현체
new ContentMergeManager(columns?: string[]);
new HierarchicalMergeManager(hierarchy: string[]);
new CustomMergeManager(mergeFunction: CustomMergeFunction);

// 타입
interface MergedRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

interface CellMergeInfo {
  range: MergedRange | null;
  isAnchor: boolean;
  rowSpan: number;
  colSpan: number;
}
```

## 핵심 개념

### Wijmo MergeManager 패턴

1. **getMergedRange()**: 특정 셀의 병합 범위를 반환하는 메서드
2. **CellRange**: 병합 범위 (startRow, endRow, startCol, endCol)
3. **앵커 셀**: 병합 범위의 좌상단 셀 (실제로 표시되는 셀)
4. **확장 가능**: 상속하여 커스텀 로직 구현

### 렌더링 방식

```
[Before]                    [After - ContentMerge]
+------------+             +------------+
| Eng        |             | Eng        | ← 앵커 (height 확장)
+------------+             |            |
| Eng        |  ────────►  |            |
+------------+             |            |
| Eng        |             |            |
+------------+             +------------+
| Sales      |             | Sales      | ← 새 앵커
+------------+             +------------+
```

## 가상화 호환성 (동적 앵커)

셀 병합과 가상 스크롤을 함께 사용할 때 발생하는 문제를 해결했습니다:

### 문제
- 병합 앵커(startRow)가 viewport 밖으로 스크롤되면 나머지 셀들이 hidden 상태라 빈 공간만 보임

### 해결: 동적 앵커 로직
```
[스크롤 전 - row 0-9 병합]
row 0: 앵커 (height = 10행)  ← 실제 앵커
row 1-9: hidden

[스크롤 후 - row 5부터 보임]
row 5: 가상 앵커 (height = 5행)  ← 동적 앵커
row 6-9: hidden
```

- `applyDynamicAnchor()`: 실제 앵커가 viewport 밖이면 보이는 첫 번째 행을 가상 앵커로 변환
- 가상 앵커의 `rowSpan`은 남은 병합 범위만큼 재계산

## 피벗 그리드 자동 병합

피벗 모드에서 row 헤더에 계층적 병합이 자동으로 적용됩니다.

### 적용 시점

`PureSheet.applyPivot()` 메서드에서 피벗 결과가 생성된 후:

```typescript
// rowHeaderColumns 키 추출 (예: ['product', 'region'])
const rowHeaderKeys = this.pivotResult.rowHeaderColumns.map(col => col.key);

// HierarchicalMergeManager 자동 설정
if (rowHeaderKeys.length > 0) {
  const mergeManager = new HierarchicalMergeManager(rowHeaderKeys);
  this.setMergeManager(mergeManager);
}
```

### 예시

```
[rowFields: ['product', 'region']]

Before (병합 없음):          After (계층적 병합):
+----------+--------+       +----------+--------+
| 노트북   | 서울   |       | 노트북   | 서울   | ← product 앵커
+----------+--------+       |          +--------+
| 노트북   | 부산   |  →    |          | 부산   |
+----------+--------+       +----------+--------+
| 스마트폰 | 서울   |       | 스마트폰 | 서울   | ← product 앵커
+----------+--------+       |          +--------+
| 스마트폰 | 부산   |       |          | 부산   |
+----------+--------+       +----------+--------+
```

### 피벗 해제 시

`restoreFromPivot()` 메서드에서 MergeManager를 자동으로 해제합니다.

## 다음 단계 예고

- 컬럼 방향 병합 지원 (colSpan)
- 병합된 셀 편집 지원
- 병합된 셀 선택 개선
- 인쇄/내보내기 시 병합 유지
