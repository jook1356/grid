# 015. CRUD 및 UndoStack 리팩토링

## 상태
**완료** (2026-01-25)

## 컨텍스트

[013. CRUD, UndoStack 및 Dirty State 패턴](./013-crud-and-undo-stack.md) 문서에서 설계된 기능이 구현되었으나, 코드 리뷰 결과 여러 리팩토링 필요 사항이 발견되었습니다.

### 발견된 문제점

| 순위 | 항목 | 심각도 | 설명 |
|------|------|--------|------|
| 1 | KeyboardShortcutManager 중복 초기화 | 높음 | PureSheet 생성자에서 두 번 초기화되어 첫 번째 인스턴스의 이벤트 리스너가 해제되지 않음 |
| 2 | addRowDirty() 반환값 오류 | 높음 | 자동 생성된 ID가 아닌 원본 row.id를 반환하여 새 행을 찾을 수 없음 |
| 3 | deleteRowDirty 중복 코드 | 중간 | deleteRowDirty()와 deleteRowDirtyInternal()이 거의 동일한 로직 |
| 4 | Command 타입 불일치 | 중간 | UndeleteRowCommand, DiscardRowCommand가 모두 'deleteRow' 타입 사용 |
| 5 | destroy() 메서드 불완전 | 낮음 | ChangeTracker, UndoStack, KeyboardShortcutManager의 정리 누락 |
| 6 | 이벤트 기반 refresh 비효율 | 중간 | DOM CustomEvent를 통한 간접 호출 방식 |

---

## 결정

### 1. KeyboardShortcutManager 중복 초기화 제거

**Before (PureSheet.ts)**:
```typescript
// 165-171번 줄 - 첫 번째 초기화
this.keyboardShortcutManager = new KeyboardShortcutManager(
  this.container,
  this.undoStack
);

// ... EditorManager 초기화 ...

// 227-230번 줄 - 중복 초기화 (제거 대상)
this.keyboardShortcutManager = new KeyboardShortcutManager(
  this.container,
  this.undoStack
);
```

**After**:
```typescript
// 한 번만 초기화 (EditorManager 초기화 후)
this.keyboardShortcutManager = new KeyboardShortcutManager(
  this.container,
  this.undoStack
);
```

---

### 2. addRowDirty() 반환값 수정

**Before**:
```typescript
addRowDirty(row: Partial<RowData>, insertIndex?: number): string | number {
  const idx = insertIndex ?? this.gridCore.getDataStore().getRowCount();
  const command = new AddRowCommand(this.changeTracker, row as RowData, idx);
  this.undoStack.push(command);
  this.refresh();
  // 문제: 원본 row.id 반환 (자동 생성된 ID가 아님)
  const rawId = (row as RowData).id;
  return typeof rawId === 'string' || typeof rawId === 'number' ? rawId : 'unknown';
}
```

**After**:
```typescript
addRowDirty(row: Partial<RowData>, insertIndex?: number): string | number {
  const idx = insertIndex ?? this.gridCore.getDataStore().getRowCount();
  const command = new AddRowCommand(this.changeTracker, row as RowData, idx);
  this.undoStack.push(command);
  this.refresh();
  // 수정: Command에서 실제 생성된 ID 반환
  return command.getAddedRowId();
}
```

**AddRowCommand 수정**:
```typescript
class AddRowCommand implements Command {
  private addedRowId: string | number | null = null;

  execute(): void {
    this.addedRowId = this.changeTracker.addRow(this.row, this.insertIndex);
  }

  /** 추가된 행의 ID 반환 */
  getAddedRowId(): string | number {
    return this.addedRowId ?? this.row.id ?? 'unknown';
  }
}
```

---

### 3. deleteRowDirty 중복 코드 통합

**Before**:
- `deleteRowDirty()`: refresh() 포함
- `deleteRowDirtyInternal()`: refresh() 미포함, 거의 동일한 로직

**After**:
```typescript
/**
 * 행 삭제 내부 구현
 * @param rowId - 삭제할 행 ID
 * @param shouldRefresh - refresh 호출 여부 (Batch 모드에서는 false)
 */
private deleteRowDirtyCore(rowId: string | number, shouldRefresh: boolean): void {
  // 추가된 행인지 확인
  const addedRow = this.changeTracker.addedRows.get(rowId);
  if (addedRow) {
    const command = new DeleteRowCommand(
      this.changeTracker,
      rowId,
      addedRow.data,
      addedRow.insertIndex
    );
    this.undoStack.push(command);
    if (shouldRefresh) this.refresh();
    return;
  }

  // 기존 행 삭제
  const originalData = this.gridCore.getDataStore().getRowById(rowId);
  const originalIndex = this.gridCore.getDataStore().getIndexById(rowId);
  if (!originalData || originalIndex === -1) return;

  const command = new DeleteRowCommand(
    this.changeTracker,
    rowId,
    originalData as RowData,
    originalIndex
  );
  this.undoStack.push(command);
  if (shouldRefresh) this.refresh();
}

deleteRowDirty(rowId: string | number): void {
  this.deleteRowDirtyCore(rowId, true);
}

private deleteRowDirtyInternal(rowId: string | number): void {
  this.deleteRowDirtyCore(rowId, false);
}
```

---

### 4. Command 타입 분리

**Before (crud.types.ts)**:
```typescript
export type CommandType = 'addRow' | 'updateCell' | 'deleteRow' | 'batch';
```

**After**:
```typescript
export type CommandType =
  | 'addRow'
  | 'updateCell'
  | 'deleteRow'
  | 'undeleteRow'   // 추가
  | 'discardRow'    // 추가
  | 'batch';
```

**Command 클래스 수정**:
```typescript
// UndeleteRowCommand
readonly type = 'undeleteRow' as const;

// DiscardRowCommand
readonly type = 'discardRow' as const;
```

---

### 5. destroy() 메서드 완성

**Before (PureSheet.ts)**:
```typescript
destroy(): void {
  this.gridRenderer.destroy();
  this.selectionManager.destroy();
  this.editorManager.destroy();
  this.columnManager.destroy();
  this.gridCore.destroy();
  this.eventHandlers.clear();
  // changeTracker, undoStack, keyboardShortcutManager 누락
}
```

**After**:
```typescript
destroy(): void {
  this.gridRenderer.destroy();
  this.selectionManager.destroy();
  this.editorManager.destroy();
  this.columnManager.destroy();
  this.gridCore.destroy();

  // CRUD 관련 정리 추가
  this.keyboardShortcutManager.destroy();
  this.undoStack.clear();
  this.changeTracker.removeAllListeners();

  this.eventHandlers.clear();
}
```

---

### 6. 이벤트 기반 refresh → 콜백 방식 변경

**Before**:
```typescript
// KeyboardShortcutManager
private dispatchRefreshEvent(): void {
  this.container.dispatchEvent(new CustomEvent('ps:refresh', { bubbles: true }));
}

// PureSheet
this.container.addEventListener('ps:refresh', () => this.refresh());
```

**After**:
```typescript
// KeyboardShortcutManager 옵션에 콜백 추가
interface KeyboardShortcutManagerOptions {
  disableUndoRedo?: boolean;
  onRefresh?: () => void;  // 추가
}

// 콜백 호출
private triggerRefresh(): void {
  this.options.onRefresh?.();
}

// PureSheet에서 콜백 전달
this.keyboardShortcutManager = new KeyboardShortcutManager(
  this.container,
  this.undoStack,
  { onRefresh: () => this.refresh() }
);
```

---

## 영향받는 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/ui/PureSheet.ts` | 중복 초기화 제거, addRowDirty 수정, deleteRowDirty 통합, destroy 완성 |
| `src/core/commands/index.ts` | AddRowCommand에 getAddedRowId() 추가, 타입 수정 |
| `src/types/crud.types.ts` | CommandType에 'undeleteRow', 'discardRow' 추가 |
| `src/ui/keyboard/KeyboardShortcutManager.ts` | onRefresh 콜백 옵션 추가 |

---

## 구현 순서

1. [x] 문서 작성
2. [x] KeyboardShortcutManager 중복 초기화 제거
3. [x] CommandType 확장 및 Command 클래스 타입 수정
4. [x] AddRowCommand.getAddedRowId() 추가 및 addRowDirty() 수정
5. [x] deleteRowDirty 중복 코드 통합
6. [x] KeyboardShortcutManager onRefresh 콜백 추가
7. [x] PureSheet.destroy() 완성
8. [x] 테스트 및 검증 (64 tests passed)
