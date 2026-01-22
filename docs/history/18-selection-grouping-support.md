# 18. Selection + Grouping 연동

## 개요

행 그룹화(Row Grouping)와 Selection 기능의 충돌 문제를 해결했습니다. 그룹화 시 `viewIndex`(화면 인덱스)와 `dataIndex`(데이터 인덱스)가 다르기 때문에 발생하는 선택 오류를 수정했습니다.

## 문제 상황

### viewIndex vs dataIndex

그룹화가 적용되면 `virtualRows` 배열에 그룹 헤더가 포함됩니다:

```
viewIndex 0: [Group Header] Engineering (3)
viewIndex 1: [Data Row] dataIndex 0 - 김철수
viewIndex 2: [Data Row] dataIndex 1 - 이영희
viewIndex 3: [Data Row] dataIndex 2 - 박민수
viewIndex 4: [Group Header] Marketing (2)
viewIndex 5: [Data Row] dataIndex 3 - 정수진
viewIndex 6: [Data Row] dataIndex 4 - 최동현
```

### 기존 문제점

1. **드래그 선택 오류**: `for (i = startDataIndex; i <= endDataIndex)` 방식으로 연속 dataIndex를 사용하여 다른 그룹의 행도 선택됨
2. **Shift+클릭 오류**: 동일한 문제로 각 그룹마다 같은 패턴의 범위가 선택됨
3. **전체 선택 오류**: 그룹 헤더도 선택 대상에 포함됨
4. **행 하이라이트 오류**: `rowIndex` 대신 `dataIndex`로 체크해야 함

## 해결 방안

### 핵심 원칙

1. **viewIndex 범위로 순회**: 화면에 보이는 범위를 기준으로 순회
2. **데이터 행만 선택**: `virtualRow.type === 'data'`인 행만 선택
3. **dataIndex로 저장**: 선택된 셀은 `"dataIndex:columnKey"` 형식으로 저장

### 구현

#### 1. SelectionManager에 virtualRows 추가

```typescript
// SelectionManager.ts
private virtualRows: VirtualRow[] = [];

setVirtualRows(virtualRows: VirtualRow[]): void {
  this.virtualRows = virtualRows;
}
```

#### 2. viewIndex 기반 범위 선택

```typescript
// 드래그/Shift+클릭 시 viewIndex 범위로 순회
private addCellsInRangeByViewIndex(start: CellPosition, end: CellPosition): void {
  const minViewIndex = Math.min(start.rowIndex, end.rowIndex);
  const maxViewIndex = Math.max(start.rowIndex, end.rowIndex);

  for (let viewIdx = minViewIndex; viewIdx <= maxViewIndex; viewIdx++) {
    const virtualRow = this.virtualRows[viewIdx];
    // 데이터 행만 선택 (그룹 헤더 건너뜀)
    if (virtualRow && virtualRow.type === 'data') {
      const dataIndex = virtualRow.dataIndex;
      // 셀 추가
      this.state.selectedCells.add(`${dataIndex}:${columnKey}`);
    }
  }
}
```

#### 3. PureSheet에서 virtualRows 동기화

선택 작업 전에 virtualRows를 동기화:

```typescript
// PureSheet.ts
private handleCellClick(position: CellPosition, value: unknown, event: MouseEvent): void {
  // Shift+클릭 범위 선택을 위해 virtualRows 동기화
  const bodyRenderer = this.gridRenderer.getBodyRenderer();
  if (bodyRenderer) {
    this.selectionManager.setVirtualRows(bodyRenderer.getVirtualRows());
  }
  this.selectionManager.handleCellClick(position, event);
}
```

동기화가 필요한 위치:
- `handleCellClick` - Shift+클릭 셀 선택
- `handleRowClick` - Shift+클릭 행 선택
- `handleDragSelectionStart` - 드래그 선택
- `selectAll` - 전체 선택

## 수정된 파일

### SelectionManager.ts

| 메서드 | 변경 내용 |
|--------|----------|
| `setVirtualRows()` | virtualRows 설정 메서드 추가 |
| `addCellsInRangeByViewIndex()` | viewIndex 기반 셀 범위 추가 (신규) |
| `selectCellRange()` | virtualRows 사용 시 viewIndex 기반으로 동작 |
| `selectRowRange()` | virtualRows 사용 시 viewIndex 기반으로 동작 |
| `updateDragSelection()` | viewIndex 범위로 순회 |
| `selectAll()` | 그룹화 시 데이터 행만 선택 |
| `selectAllCells()` | 그룹화 시 데이터 행만 선택 |
| `cancelDragSelection()` | 행 선택 복원 누락 수정 |
| `getRowId()` | 타입 안전한 행 ID 추출 헬퍼 추가 |

### BodyRenderer.ts

| 메서드 | 변경 내용 |
|--------|----------|
| `getVirtualRows()` | virtualRows 접근자 추가 |
| `renderDataRowWithRowClass()` | 선택 체크 시 `dataRow.dataIndex` 사용 |
| `onRowClick` 시그니처 | viewIndex와 dataIndex 모두 전달 |

### PureSheet.ts

| 메서드 | 변경 내용 |
|--------|----------|
| `handleCellClick()` | virtualRows 동기화 추가 |
| `handleRowClick()` | virtualRows 동기화, viewIndex 전달 |
| `handleDragSelectionStart()` | virtualRows 동기화 추가 |
| `selectAll()` | virtualRows 동기화 추가 |

### GridRenderer.ts

| 변경 | 내용 |
|------|------|
| `onRowClick` 타입 | `(viewIndex, row, event, dataIndex?) => void` |

## 코드 품질 개선

### 1. getRowId 헬퍼 추가

기존의 반복적인 `row['id']` 접근을 타입 안전한 헬퍼로 통합:

```typescript
private getRowId(row: Row | undefined): string | number | undefined {
  if (!row) return undefined;
  const id = row['id'];
  if (typeof id === 'string' || typeof id === 'number') {
    return id;
  }
  return undefined;
}
```

### 2. cancelDragSelection 버그 수정

행 선택 복원이 누락되어 있던 문제 수정:

```typescript
cancelDragSelection(): void {
  // ...
  this.state.selectedCells = new Set(this.preDragSelection);
  this.state.selectedRows = new Set(this.preDragRowSelection);  // 추가됨
  this.preDragSelection.clear();
  this.preDragRowSelection.clear();  // 추가됨
}
```

## 선택 동작 요약

### 그룹화 비활성 시

| 동작 | 처리 방식 |
|------|----------|
| 드래그 | dataIndex 연속 범위 |
| Shift+클릭 | dataIndex 연속 범위 |
| 전체 선택 | 0 ~ totalRows-1 |

### 그룹화 활성 시

| 동작 | 처리 방식 |
|------|----------|
| 드래그 | viewIndex 범위 → 데이터 행만 선택 |
| Shift+클릭 | viewIndex 범위 → 데이터 행만 선택 |
| 전체 선택 | virtualRows 순회 → 데이터 행만 선택 |

## 데모 페이지

`demo/examples/grouping.html`에 전체 선택 테스트 기능 추가:

```html
<button onclick="selectAllRows()">✅ 전체 선택</button>
<button onclick="clearSelection()">❌ 선택 해제</button>
<span id="selectionCount">선택: 0행</span>
```

### 테스트 방법

1. 그룹화 예제 페이지 열기
2. 부서별 그룹화 상태 확인
3. **전체 선택** 버튼 클릭 → 100행 선택됨 (그룹 헤더 제외)
4. 드래그로 범위 선택 → 그룹 경계를 넘어도 정확히 선택
5. Shift+클릭 → 동일하게 정확한 범위 선택

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                        PureSheet                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Selection 작업 전 virtualRows 동기화                  │   │
│  │  - handleCellClick()                                  │   │
│  │  - handleRowClick()                                   │   │
│  │  - handleDragSelectionStart()                         │   │
│  │  - selectAll()                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              SelectionManager                         │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  virtualRows: VirtualRow[]                      │  │   │
│  │  │  - GroupHeaderRow (type: 'group-header')        │  │   │
│  │  │  - DataRow (type: 'data', dataIndex: number)    │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │                                                       │   │
│  │  선택 로직:                                           │   │
│  │  if (virtualRows.length > 0) {                       │   │
│  │    // viewIndex 범위로 순회, 데이터 행만 선택          │   │
│  │    addCellsInRangeByViewIndex()                      │   │
│  │  } else {                                            │   │
│  │    // 기존 방식 (dataIndex 연속 범위)                  │   │
│  │    addCellsInRange()                                 │   │
│  │  }                                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              BodyRenderer                             │   │
│  │  getVirtualRows(): VirtualRow[]                      │   │
│  │  - 그룹 헤더 + 데이터 행 배열 반환                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 성능 고려사항

1. **O(1) 셀 조회 유지**: Set 기반 저장으로 선택 확인 성능 보장
2. **virtualRows 동기화 비용**: 참조만 전달하므로 O(1)
3. **viewIndex 순회**: 화면에 보이는 범위만 순회하므로 효율적

## 변경 이력

### 2026-01

- 그룹화 + Selection 연동 문제 해결
- viewIndex 기반 범위 선택 로직 추가
- virtualRows 동기화 메커니즘 구현
- 전체 선택/전체 셀 선택 그룹화 지원
- 코드 품질 개선 (getRowId 헬퍼, 버그 수정)
- 그룹화 예제에 전체 선택 테스트 버튼 추가
