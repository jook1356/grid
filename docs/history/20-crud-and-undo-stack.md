이# 20. CRUD 및 UndoStack 구현

## 작업 일자
2026-01-23 ~ 2026-01-25

## 개요

그리드에 CRUD(Create, Read, Update, Delete) 기능과 Undo/Redo 스택을 구현했습니다. 원본 데이터에 즉시 반영하지 않고 Dirty State로 관리하여, 사용자가 변경사항을 검토한 후 커밋하거나 폐기할 수 있습니다.

## 왜 이게 필요한가?

1. **Undo/Redo 지원**: 사용자가 실수로 데이터를 수정/삭제해도 Ctrl+Z로 복원 가능
2. **Dirty State 관리**: 변경사항을 pending 상태로 유지하여 서버 저장 전 검토 가능
3. **시각적 피드백**: 추가/수정/삭제된 행을 CSS로 구분하여 사용자에게 명확한 피드백 제공
4. **인라인 편집**: 더블클릭으로 셀 편집 모드 진입

## 핵심 구현 내용

### 1. Command 패턴 기반 UndoStack

```
┌─────────────────────────────────────────────────────────────────┐
│                         UndoStack                                │
│  - Command 패턴으로 변경사항 추적                                 │
│  - push(command), undo(), redo()                                │
│  - Ctrl+Z, Ctrl+Y 단축키 바인딩                                  │
│  - Batch 모드 지원 (여러 작업을 하나의 Undo 단위로)              │
└─────────────────────────────────────────────────────────────────┘
```

**Command 타입**:
- `AddRowCommand`: 행 추가
- `UpdateCellCommand`: 셀 수정
- `DeleteRowCommand`: 행 삭제
- `UndeleteRowCommand`: 삭제 취소
- `DiscardRowCommand`: 변경사항 폐기
- `BatchCommand`: 여러 명령을 하나로 묶음

### 2. ChangeTracker (Dirty State 관리)

```typescript
// 행 상태
type RowState = 'pristine' | 'added' | 'modified' | 'deleted';

// 셀 상태
type CellState = 'pristine' | 'modified';
```

**주요 기능**:
- `addRow()`: 새 행 추가 (pending 상태)
- `updateCell()`: 셀 값 수정 (원본 보존)
- `deleteRow()`: 행 삭제 예정 표시
- `getChanges()`: 모든 변경사항 조회
- `commitComplete()`: 변경사항 확정 후 초기화
- `discard()`: 모든 변경사항 폐기

### 3. PureSheet CRUD API

```typescript
// Dirty State CRUD
grid.addRowDirty(row, insertIndex?);     // 행 추가
grid.updateCellDirty(rowId, field, value); // 셀 수정
grid.deleteRowDirty(rowId);               // 행 삭제

// Batch 작업
grid.beginBatch('설명');
grid.deleteRowDirty(id1);
grid.deleteRowDirty(id2);
grid.endBatch(); // Ctrl+Z 1번으로 전체 복원

// Undo/Redo
grid.undo();
grid.redo();

// 변경사항 관리
grid.hasChanges;        // 변경 여부
grid.getChanges();      // 변경사항 조회
grid.commitChanges();   // 원본에 반영
grid.discardChanges();  // 모두 폐기
```

### 4. 시각적 피드백 (CSS)

```css
/* 추가된 행 */
.ps-row-added {
  background-color: rgba(76, 175, 80, 0.08);
  border-left: 3px solid #4caf50;
}

/* 수정된 행 */
.ps-row-modified {
  background-color: rgba(255, 193, 7, 0.08);
  border-left: 3px solid #ffc107;
}

/* 삭제 예정 행 */
.ps-row-deleted {
  background-color: rgba(244, 67, 54, 0.08);
  border-left: 3px solid #f44336;
  text-decoration: line-through;
  opacity: 0.6;
}

/* 수정된 셀 좌상단 마커 */
.ps-cell-modified::before {
  border-left: 6px solid #ffc107;
  border-bottom: 6px solid transparent;
}
```

### 5. 키보드 단축키 (KeyboardShortcutManager)

| 단축키 | 동작 |
|--------|------|
| Ctrl+Z / Cmd+Z | Undo |
| Ctrl+Y / Cmd+Shift+Z | Redo |
| Ctrl+Shift+Z | Redo |

## 리팩토링 (2026-01-25)

초기 구현 후 코드 리뷰를 통해 다음 항목을 리팩토링:

1. **KeyboardShortcutManager 중복 초기화 제거**: 생성자에서 두 번 초기화되던 문제 수정
2. **addRowDirty() 반환값 수정**: 자동 생성된 ID를 올바르게 반환
3. **deleteRowDirty 중복 코드 통합**: `deleteRowDirtyCore()` 공통 메서드로 통합
4. **Command 타입 분리**: `undeleteRow`, `discardRow` 타입 추가
5. **onRefresh 콜백 추가**: DOM 이벤트 대신 콜백 방식으로 변경
6. **destroy() 완성**: CRUD 관련 리소스 정리 추가

## 생성/수정된 파일

### 신규 생성
| 파일 | 설명 |
|------|------|
| `src/core/ChangeTracker.ts` | Dirty State 관리 |
| `src/core/UndoStack.ts` | Undo/Redo 스택 |
| `src/core/commands/index.ts` | Command 패턴 구현체 |
| `src/types/crud.types.ts` | CRUD 관련 타입 정의 |
| `src/ui/keyboard/KeyboardShortcutManager.ts` | 단축키 관리 |
| `src/ui/keyboard/index.ts` | keyboard 모듈 export |
| `demo/examples/crud.html` | CRUD 데모 페이지 |
| `docs/decisions/013-crud-and-undo-stack.md` | 설계 문서 |
| `docs/decisions/014-batch-undo-api.md` | Batch API 설계 |
| `docs/decisions/015-refactor-required-crud-and-undo-stack.md` | 리팩토링 문서 |

### 수정
| 파일 | 변경 내용 |
|------|----------|
| `src/ui/PureSheet.ts` | CRUD/Undo API 추가, ChangeTracker/UndoStack 통합 |
| `src/ui/body/BodyRenderer.ts` | rowState/cellState CSS 적용 로직 |
| `src/ui/interaction/EditorManager.ts` | ChangeTracker 연동 |
| `src/ui/interaction/SelectionManager.ts` | 선택된 행 ID 조회 개선 |
| `src/ui/style/default.css` | Dirty State 스타일 추가 |
| `src/types/index.ts` | crud.types export |
| `src/core/index.ts` | ChangeTracker, UndoStack export |

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         PureSheet                                │
│  - CRUD API (addRowDirty, updateCellDirty, deleteRowDirty)      │
│  - Undo/Redo API (undo, redo, beginBatch, endBatch)             │
│  - Dirty State API (hasChanges, getChanges, commitChanges)      │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│   UndoStack     │  │  ChangeTracker  │  │ KeyboardShortcut    │
│  - undoStack[]  │  │  - addedRows    │  │    Manager          │
│  - redoStack[]  │  │  - modifiedRows │  │  - Ctrl+Z/Y         │
│  - batchBuffer  │  │  - deletedRows  │  │  - onRefresh        │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Commands                                   │
│  AddRowCommand | UpdateCellCommand | DeleteRowCommand | ...     │
│  - execute(): 실행                                               │
│  - undo(): 취소                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 사용 예시

```typescript
// 편집 가능한 그리드 생성
const grid = new PureSheet(container, {
  fields: [
    { key: 'id', header: 'ID' },
    { key: 'name', header: '이름' },
    { key: 'price', header: '가격', dataType: 'number' }
  ],
  data: [...],
  editable: true
});

// 새 행 추가
const newId = grid.addRowDirty({ name: '신규 상품', price: 1000 });

// 셀 수정
grid.updateCellDirty(newId, 'price', 1500);

// Undo
grid.undo(); // price가 1000으로 복원

// 여러 행 일괄 삭제
const selectedIds = grid.getSelectedRowIds();
grid.beginBatch('선택 행 삭제');
selectedIds.forEach(id => grid.deleteRowDirty(id));
grid.endBatch();

// Undo로 전체 복원
grid.undo(); // 삭제된 모든 행 복원

// 변경사항 확인 및 커밋
if (grid.hasChanges) {
  const changes = grid.getChanges();
  console.log('추가:', changes.added.length);
  console.log('수정:', changes.modified.length);
  console.log('삭제:', changes.deleted.length);

  await grid.commitChanges(); // 원본 데이터에 반영
}
```

## 다음 단계

- [ ] 다양한 에디터 타입 지원 (Dropdown, DatePicker 등)
- [ ] 유효성 검사 (Validator) 통합
- [ ] 서버 동기화 API 설계
