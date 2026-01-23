# 013. CRUD, UndoStack 및 Dirty State 패턴

## 상태
**설계됨** (2026-01-23)

## 컨텍스트

[012. VirtualRowBuilder 분리 및 formatRow API](./012-virtual-row-builder-and-format-row.md) 문서에서 정의된 아키텍처를 기반으로, 본 문서는 CRUD(Create, Read, Update, Delete) 기능의 상세 구현을 다룹니다.

### 핵심 요구사항

| 영역 | 요구사항 |
|------|----------|
| **UndoStack** | Ctrl+Z(undo), Ctrl+Y/Ctrl+Shift+Z(redo) 단축키 지원 |
| **Dirty State** | 변경사항을 원본에 즉시 반영하지 않고 pending 상태로 관리 |
| **시각적 피드백** | 추가/수정/삭제 상태별 CSS 클래스 자동 적용 |
| **인라인 편집** | 더블클릭으로 셀 편집 모드 진입 |
| **확장성** | Input 외 다양한 에디터(Dropdown 등) 지원 가능한 구조 |

---

## 결정

### 1. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                         UndoStack                                │
│  - Command 패턴으로 변경사항 추적                                 │
│  - push(command), undo(), redo()                                │
│  - Ctrl+Z, Ctrl+Y 단축키 바인딩                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ChangeTracker                               │
│  - Dirty State 관리 (added, modified, deleted)                  │
│  - 원본 데이터 보존                                               │
│  - commit() / discard() API                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CellEditorManager                           │
│  - 인라인 편집 제어 (더블클릭 → 에디터 활성화)                    │
│  - 에디터 타입 레지스트리 (Input, Dropdown 등)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VirtualRowBuilder                            │
│  - Original + Pending Changes 병합                              │
│  - 각 행에 RowState 부여                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BodyRenderer                               │
│  - RowState에 따른 CSS 클래스 자동 적용                          │
│  - CellState에 따른 CSS 클래스 자동 적용                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 상세 설계

### 2. UndoStack

#### 2.1 Command 패턴 인터페이스

```typescript
/**
 * Undo/Redo 가능한 명령 인터페이스
 */
interface Command {
  /** 명령 타입 (디버깅/로깅용) */
  readonly type: 'addRow' | 'updateCell' | 'deleteRow' | 'batch';
  
  /** 명령 실행 */
  execute(): void;
  
  /** 명령 취소 (undo) */
  undo(): void;
  
  /** 명령 설명 (디버깅용) */
  readonly description: string;
}

/**
 * 여러 명령을 하나로 묶는 배치 명령
 * (예: 여러 셀 동시 수정, 여러 행 삭제)
 */
interface BatchCommand extends Command {
  type: 'batch';
  readonly commands: Command[];
}
```

#### 2.2 UndoStack 클래스

```typescript
interface UndoStackOptions {
  /** 최대 히스토리 크기 (기본: 100) */
  maxSize?: number;
}

class UndoStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;

  constructor(options: UndoStackOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
  }

  /** 명령 실행 및 스택에 추가 */
  push(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // redo 스택 초기화
    
    // 최대 크기 초과 시 오래된 명령 제거
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  /** 마지막 명령 취소 */
  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  /** 취소된 명령 다시 실행 */
  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    
    command.execute();
    this.undoStack.push(command);
    return true;
  }

  /** Undo 가능 여부 */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Redo 가능 여부 */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 스택 초기화 (commit 후 호출) */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
```

#### 2.3 단축키 바인딩

```typescript
class KeyboardShortcutManager {
  private shortcuts: Map<string, () => void> = new Map();

  constructor(
    private container: HTMLElement,
    private undoStack: UndoStack
  ) {
    this.registerDefaults();
    this.attachListener();
  }

  private registerDefaults(): void {
    // Undo: Ctrl+Z (Windows/Linux), Cmd+Z (Mac)
    this.shortcuts.set('ctrl+z', () => this.undoStack.undo());
    this.shortcuts.set('meta+z', () => this.undoStack.undo());

    // Redo: Ctrl+Y 또는 Ctrl+Shift+Z (Windows/Linux), Cmd+Shift+Z (Mac)
    this.shortcuts.set('ctrl+y', () => this.undoStack.redo());
    this.shortcuts.set('ctrl+shift+z', () => this.undoStack.redo());
    this.shortcuts.set('meta+shift+z', () => this.undoStack.redo());
  }

  private attachListener(): void {
    this.container.addEventListener('keydown', (e: KeyboardEvent) => {
      const key = this.normalizeKey(e);
      const handler = this.shortcuts.get(key);
      
      if (handler) {
        e.preventDefault();
        handler();
      }
    });
  }

  private normalizeKey(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    parts.push(e.key.toLowerCase());
    return parts.join('+');
  }
}
```

---

### 3. ChangeTracker (Dirty State 관리)

#### 3.1 타입 정의

```typescript
/**
 * 행 변경 상태
 */
type RowState = 
  | 'pristine'   // 원본 그대로
  | 'added'      // 새로 추가됨 (commit 전)
  | 'modified'   // 수정됨 (commit 전)
  | 'deleted';   // 삭제 예정 (commit 전)

/**
 * 셀 변경 상태
 */
type CellState = 
  | 'pristine'   // 원본 그대로
  | 'modified';  // 수정됨

/**
 * 추가된 행 정보
 */
interface AddedRow {
  rowId: string | number;
  data: Row;
  insertIndex: number;  // 삽입된 위치
}

/**
 * 수정된 행 정보
 */
interface ModifiedRow {
  rowId: string | number;
  originalData: Row;                    // 원본 (되돌리기용)
  currentData: Row;                     // 현재 (수정된 값)
  changedFields: Map<string, {
    originalValue: CellValue;
    currentValue: CellValue;
  }>;
}

/**
 * 삭제된 행 정보
 */
interface DeletedRow {
  rowId: string | number;
  originalData: Row;
  originalIndex: number;  // 삭제 전 위치 (복원용)
}
```

#### 3.2 ChangeTracker 클래스

```typescript
class ChangeTracker {
  private _addedRows: Map<string | number, AddedRow> = new Map();
  private _modifiedRows: Map<string | number, ModifiedRow> = new Map();
  private _deletedRows: Map<string | number, DeletedRow> = new Map();
  
  private version: number = 0;

  // ─────────────────────────────────────────────────────────────
  // 상태 조회
  // ─────────────────────────────────────────────────────────────
  
  get hasChanges(): boolean {
    return this._addedRows.size > 0 
        || this._modifiedRows.size > 0 
        || this._deletedRows.size > 0;
  }

  getRowState(rowId: string | number): RowState {
    if (this._addedRows.has(rowId)) return 'added';
    if (this._deletedRows.has(rowId)) return 'deleted';
    if (this._modifiedRows.has(rowId)) return 'modified';
    return 'pristine';
  }

  getCellState(rowId: string | number, field: string): CellState {
    const modified = this._modifiedRows.get(rowId);
    if (modified?.changedFields.has(field)) return 'modified';
    return 'pristine';
  }

  getChangedFields(rowId: string | number): Set<string> | undefined {
    const modified = this._modifiedRows.get(rowId);
    return modified ? new Set(modified.changedFields.keys()) : undefined;
  }

  getOriginalValue(rowId: string | number, field: string): CellValue | undefined {
    const modified = this._modifiedRows.get(rowId);
    return modified?.changedFields.get(field)?.originalValue;
  }

  // ─────────────────────────────────────────────────────────────
  // 변경 메서드
  // ─────────────────────────────────────────────────────────────

  /**
   * 행 추가
   */
  addRow(row: Row, insertIndex: number): void {
    const rowId = row.id ?? this.generateRowId();
    
    this._addedRows.set(rowId, {
      rowId,
      data: { ...row, id: rowId },
      insertIndex
    });
    
    this.version++;
  }

  /**
   * 셀 값 수정
   */
  updateCell(rowId: string | number, field: string, newValue: CellValue, originalData: Row): void {
    // 추가된 행의 수정은 added 상태 유지
    const addedRow = this._addedRows.get(rowId);
    if (addedRow) {
      addedRow.data[field] = newValue;
      this.version++;
      return;
    }

    // 삭제된 행 수정 불가
    if (this._deletedRows.has(rowId)) {
      return;
    }

    // 기존 수정 정보 가져오기 또는 새로 생성
    let modified = this._modifiedRows.get(rowId);
    if (!modified) {
      modified = {
        rowId,
        originalData: { ...originalData },
        currentData: { ...originalData },
        changedFields: new Map()
      };
      this._modifiedRows.set(rowId, modified);
    }

    const originalValue = originalData[field];
    
    // 값이 원본과 같아지면 해당 필드 변경 제거
    if (newValue === originalValue) {
      modified.changedFields.delete(field);
      modified.currentData[field] = originalValue;
      
      // 모든 필드가 원본으로 돌아오면 modified 상태 해제
      if (modified.changedFields.size === 0) {
        this._modifiedRows.delete(rowId);
      }
    } else {
      modified.changedFields.set(field, {
        originalValue,
        currentValue: newValue
      });
      modified.currentData[field] = newValue;
    }
    
    this.version++;
  }

  /**
   * 행 삭제
   */
  deleteRow(rowId: string | number, originalData: Row, originalIndex: number): void {
    // 추가된 행 삭제 → 그냥 제거
    if (this._addedRows.has(rowId)) {
      this._addedRows.delete(rowId);
      this.version++;
      return;
    }

    // 수정 상태 정리
    this._modifiedRows.delete(rowId);

    // 삭제 목록에 추가
    this._deletedRows.set(rowId, {
      rowId,
      originalData: { ...originalData },
      originalIndex
    });
    
    this.version++;
  }

  // ─────────────────────────────────────────────────────────────
  // 커밋/폐기
  // ─────────────────────────────────────────────────────────────

  /**
   * 변경사항 가져오기 (커밋 전 확인용)
   */
  getChanges(): {
    added: AddedRow[];
    modified: ModifiedRow[];
    deleted: DeletedRow[];
  } {
    return {
      added: [...this._addedRows.values()],
      modified: [...this._modifiedRows.values()],
      deleted: [...this._deletedRows.values()]
    };
  }

  /**
   * 모든 변경사항 폐기
   */
  discard(): void {
    this._addedRows.clear();
    this._modifiedRows.clear();
    this._deletedRows.clear();
    this.version++;
  }

  /**
   * 특정 행 변경사항 폐기
   */
  discardRow(rowId: string | number): void {
    this._addedRows.delete(rowId);
    this._modifiedRows.delete(rowId);
    this._deletedRows.delete(rowId);
    this.version++;
  }

  /**
   * 커밋 (DataStore에 반영 후 호출)
   */
  commitComplete(): void {
    this.discard();
  }

  private generateRowId(): string {
    return `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
```

---

### 4. Command 구현체

```typescript
/**
 * 행 추가 Command
 */
class AddRowCommand implements Command {
  readonly type = 'addRow' as const;
  readonly description: string;
  
  private addedRowId: string | number | null = null;

  constructor(
    private changeTracker: ChangeTracker,
    private row: Row,
    private insertIndex: number
  ) {
    this.description = `행 추가 (index: ${insertIndex})`;
  }

  execute(): void {
    this.changeTracker.addRow(this.row, this.insertIndex);
    this.addedRowId = this.row.id;
  }

  undo(): void {
    if (this.addedRowId) {
      this.changeTracker.discardRow(this.addedRowId);
    }
  }
}

/**
 * 셀 수정 Command
 */
class UpdateCellCommand implements Command {
  readonly type = 'updateCell' as const;
  readonly description: string;

  private previousValue: CellValue;

  constructor(
    private changeTracker: ChangeTracker,
    private rowId: string | number,
    private field: string,
    private newValue: CellValue,
    private originalData: Row
  ) {
    this.previousValue = originalData[field];
    this.description = `셀 수정 (rowId: ${rowId}, field: ${field})`;
  }

  execute(): void {
    this.changeTracker.updateCell(
      this.rowId, 
      this.field, 
      this.newValue, 
      this.originalData
    );
  }

  undo(): void {
    this.changeTracker.updateCell(
      this.rowId, 
      this.field, 
      this.previousValue, 
      this.originalData
    );
  }
}

/**
 * 행 삭제 Command
 */
class DeleteRowCommand implements Command {
  readonly type = 'deleteRow' as const;
  readonly description: string;

  constructor(
    private changeTracker: ChangeTracker,
    private rowId: string | number,
    private originalData: Row,
    private originalIndex: number
  ) {
    this.description = `행 삭제 (rowId: ${rowId})`;
  }

  execute(): void {
    this.changeTracker.deleteRow(this.rowId, this.originalData, this.originalIndex);
  }

  undo(): void {
    // 삭제 취소 = 삭제 목록에서 제거
    this.changeTracker.discardRow(this.rowId);
  }
}
```

---

### 5. CSS 스타일 (Dirty State 시각화)

```css
/* ═══════════════════════════════════════════════════════════════
   Row 상태별 스타일
   ═══════════════════════════════════════════════════════════════ */

/* 추가된 행 */
.ps-row-added {
  background-color: rgba(76, 175, 80, 0.08);
  border-left: 3px solid #4caf50;
}

.ps-row-added:hover {
  background-color: rgba(76, 175, 80, 0.12);
}

/* 수정된 행 */
.ps-row-modified {
  background-color: rgba(255, 193, 7, 0.08);
  border-left: 3px solid #ffc107;
}

.ps-row-modified:hover {
  background-color: rgba(255, 193, 7, 0.12);
}

/* 삭제 예정 행 */
.ps-row-deleted {
  background-color: rgba(244, 67, 54, 0.08);
  border-left: 3px solid #f44336;
  text-decoration: line-through;
  opacity: 0.6;
  pointer-events: none;  /* 클릭 비활성화 */
}

/* ═══════════════════════════════════════════════════════════════
   Cell 상태별 스타일
   ═══════════════════════════════════════════════════════════════ */

/* 추가된 행의 셀들 */
.ps-cell-added {
  background-color: rgba(76, 175, 80, 0.12);
}

/* 수정된 셀 */
.ps-cell-modified {
  background-color: rgba(255, 193, 7, 0.15);
  position: relative;
}

/* 수정된 셀 좌상단 마커 */
.ps-cell-modified::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  border-left: 6px solid #ffc107;
  border-bottom: 6px solid transparent;
}

/* 삭제 예정 행의 셀들 */
.ps-cell-deleted {
  background-color: rgba(244, 67, 54, 0.12);
  text-decoration: line-through;
  color: rgba(0, 0, 0, 0.4);
}

/* ═══════════════════════════════════════════════════════════════
   인라인 에디터 스타일
   ═══════════════════════════════════════════════════════════════ */

/* 편집 중인 셀 */
.ps-cell-editing {
  padding: 0 !important;
  overflow: visible;
}

/* 기본 Input 에디터 */
.ps-cell-editor {
  width: 100%;
  height: 100%;
  border: 2px solid #1976d2;
  border-radius: 2px;
  padding: 4px 8px;
  font: inherit;
  box-sizing: border-box;
  outline: none;
}

.ps-cell-editor:focus {
  border-color: #1565c0;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

/* Dropdown 에디터 */
.ps-cell-editor-dropdown {
  width: 100%;
  height: 100%;
  border: 2px solid #1976d2;
  border-radius: 2px;
  padding: 4px 8px;
  font: inherit;
  box-sizing: border-box;
  cursor: pointer;
}
```

---

### 6. CellEditorManager (인라인 편집)

#### 6.1 에디터 인터페이스

```typescript
/**
 * 셀 에디터 인터페이스
 * 
 * 다양한 에디터 타입(Input, Dropdown, DatePicker 등)을 
 * 동일한 방식으로 처리하기 위한 추상화
 */
interface CellEditor<T = CellValue> {
  /** 에디터 타입 식별자 */
  readonly type: string;
  
  /** 에디터 DOM 요소 생성 */
  createElement(): HTMLElement;
  
  /** 에디터에 값 설정 */
  setValue(value: T): void;
  
  /** 에디터에서 값 가져오기 */
  getValue(): T;
  
  /** 에디터 포커스 */
  focus(): void;
  
  /** 에디터 정리 (이벤트 해제 등) */
  destroy(): void;
}

/**
 * 에디터 생성 컨텍스트
 */
interface EditorContext {
  rowId: string | number;
  field: string;
  currentValue: CellValue;
  fieldDef: FieldDefinition;
  cellElement: HTMLElement;
  
  /** 편집 완료 콜백 */
  onCommit: (value: CellValue) => void;
  
  /** 편집 취소 콜백 */
  onCancel: () => void;
}

/**
 * 에디터 팩토리 인터페이스
 */
interface CellEditorFactory {
  /** 에디터 생성 가능 여부 */
  canHandle(fieldDef: FieldDefinition): boolean;
  
  /** 에디터 인스턴스 생성 */
  create(context: EditorContext): CellEditor;
}
```

#### 6.2 기본 Input 에디터

```typescript
/**
 * 기본 텍스트 Input 에디터
 */
class TextInputEditor implements CellEditor<string> {
  readonly type = 'text-input';
  
  private input: HTMLInputElement;
  private context: EditorContext;

  constructor(context: EditorContext) {
    this.context = context;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'ps-cell-editor';
    
    this.attachEvents();
  }

  createElement(): HTMLElement {
    return this.input;
  }

  setValue(value: string): void {
    this.input.value = value ?? '';
  }

  getValue(): string {
    return this.input.value;
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  destroy(): void {
    this.input.remove();
  }

  private attachEvents(): void {
    // Enter → 편집 완료
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.context.onCommit(this.getValue());
      }
      // Escape → 편집 취소
      else if (e.key === 'Escape') {
        e.preventDefault();
        this.context.onCancel();
      }
      // Tab → 다음 셀로 이동 (편집 완료 후)
      else if (e.key === 'Tab') {
        this.context.onCommit(this.getValue());
        // Tab 기본 동작은 유지 (다음 셀로 이동)
      }
    });

    // 포커스 아웃 → 편집 완료
    this.input.addEventListener('blur', () => {
      this.context.onCommit(this.getValue());
    });
  }
}

/**
 * TextInput 팩토리
 */
class TextInputEditorFactory implements CellEditorFactory {
  canHandle(fieldDef: FieldDefinition): boolean {
    // 특별한 타입이 지정되지 않은 경우 기본 에디터로 사용
    return !fieldDef.editor || fieldDef.editor === 'text';
  }

  create(context: EditorContext): CellEditor {
    const editor = new TextInputEditor(context);
    editor.setValue(String(context.currentValue ?? ''));
    return editor;
  }
}
```

#### 6.3 CellEditorManager

```typescript
/**
 * 셀 편집 관리자
 * 
 * 더블클릭 시 인라인 에디터 활성화를 담당합니다.
 * 에디터 팩토리 레지스트리를 통해 다양한 에디터 타입을 지원합니다.
 */
class CellEditorManager {
  private factories: CellEditorFactory[] = [];
  private activeEditor: {
    editor: CellEditor;
    rowId: string | number;
    field: string;
    cellElement: HTMLElement;
  } | null = null;

  constructor(
    private container: HTMLElement,
    private changeTracker: ChangeTracker,
    private undoStack: UndoStack,
    private getOriginalData: (rowId: string | number) => Row | undefined
  ) {
    // 기본 팩토리 등록
    this.registerFactory(new TextInputEditorFactory());
    
    // 컨테이너에 더블클릭 이벤트 위임
    this.attachDoubleClickHandler();
  }

  /**
   * 에디터 팩토리 등록
   * 
   * 커스텀 에디터(Dropdown, DatePicker 등)를 추가할 때 사용
   */
  registerFactory(factory: CellEditorFactory): void {
    // 앞에 추가하여 나중에 등록된 팩토리가 우선권 가짐
    this.factories.unshift(factory);
  }

  /**
   * 셀 편집 시작
   */
  startEdit(rowId: string | number, field: string, cellElement: HTMLElement, fieldDef: FieldDefinition): void {
    // 이미 편집 중이면 기존 편집 완료
    if (this.activeEditor) {
      this.commitEdit();
    }

    const originalData = this.getOriginalData(rowId);
    if (!originalData) return;

    const currentValue = originalData[field];

    const context: EditorContext = {
      rowId,
      field,
      currentValue,
      fieldDef,
      cellElement,
      onCommit: (value) => this.commitEdit(value),
      onCancel: () => this.cancelEdit()
    };

    // 적절한 팩토리 찾기
    const factory = this.factories.find(f => f.canHandle(fieldDef));
    if (!factory) return;

    const editor = factory.create(context);

    // 셀 내용 교체
    cellElement.classList.add('ps-cell-editing');
    const originalContent = cellElement.innerHTML;
    cellElement.innerHTML = '';
    cellElement.appendChild(editor.createElement());
    
    // 에디터 활성화
    editor.focus();

    this.activeEditor = {
      editor,
      rowId,
      field,
      cellElement
    };
  }

  /**
   * 편집 완료 (값 적용)
   */
  private commitEdit(newValue?: CellValue): void {
    if (!this.activeEditor) return;

    const { editor, rowId, field, cellElement } = this.activeEditor;
    const value = newValue ?? editor.getValue();
    
    const originalData = this.getOriginalData(rowId);
    if (originalData && value !== originalData[field]) {
      // UndoStack을 통한 변경 적용
      const command = new UpdateCellCommand(
        this.changeTracker,
        rowId,
        field,
        value,
        originalData
      );
      this.undoStack.push(command);
    }

    this.closeEditor();
  }

  /**
   * 편집 취소
   */
  private cancelEdit(): void {
    this.closeEditor();
  }

  private closeEditor(): void {
    if (!this.activeEditor) return;

    const { editor, cellElement } = this.activeEditor;
    
    cellElement.classList.remove('ps-cell-editing');
    editor.destroy();
    
    // 이벤트 발행 → BodyRenderer가 셀 재렌더링
    this.container.dispatchEvent(new CustomEvent('cellEditComplete'));
    
    this.activeEditor = null;
  }

  private attachDoubleClickHandler(): void {
    this.container.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest('[data-field]') as HTMLElement;
      if (!cell) return;

      const row = cell.closest('[data-row-id]') as HTMLElement;
      if (!row) return;

      const rowId = row.dataset.rowId;
      const field = cell.dataset.field;
      
      if (rowId && field) {
        // fieldDef는 외부에서 주입받거나 조회
        const fieldDef = this.getFieldDef(field);
        if (fieldDef && fieldDef.editable !== false) {
          this.startEdit(rowId, field, cell, fieldDef);
        }
      }
    });
  }

  private getFieldDef(field: string): FieldDefinition | undefined {
    // 구현 시 PureSheet에서 주입받은 fields 참조
    return undefined;
  }
}
```

---

### 7. 확장 가능한 에디터 설계

> [!NOTE]
> 본 섹션은 향후 확장을 위한 설계 논의입니다. 현재는 `TextInputEditor`만 구현합니다.

#### 7.1 Dropdown 에디터 예시

```typescript
interface DropdownEditorOptions {
  options: Array<{ value: CellValue; label: string }>;
}

class DropdownEditor implements CellEditor {
  readonly type = 'dropdown';
  
  private select: HTMLSelectElement;
  private context: EditorContext;

  constructor(context: EditorContext, options: DropdownEditorOptions) {
    this.context = context;
    this.select = document.createElement('select');
    this.select.className = 'ps-cell-editor-dropdown';
    
    // 옵션 추가
    for (const opt of options.options) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      this.select.appendChild(option);
    }
    
    this.attachEvents();
  }

  // ... CellEditor 인터페이스 구현
}

class DropdownEditorFactory implements CellEditorFactory {
  canHandle(fieldDef: FieldDefinition): boolean {
    return fieldDef.editor === 'dropdown' && Array.isArray(fieldDef.options);
  }

  create(context: EditorContext): CellEditor {
    return new DropdownEditor(context, {
      options: context.fieldDef.options
    });
  }
}
```

#### 7.2 FieldDefinition 확장

```typescript
interface FieldDefinition {
  key: string;
  header: string;
  width?: number;
  
  // 편집 관련
  editable?: boolean;           // false면 편집 불가 (기본: true)
  editor?: 'text' | 'dropdown' | 'date' | 'number' | string;  // 에디터 타입
  options?: Array<{ value: CellValue; label: string }>;       // dropdown용
  
  // 향후 확장
  // validator?: (value: CellValue) => boolean | string;
  // format?: (value: CellValue) => string;
}
```

---

### 8. BodyRenderer 통합

```typescript
class BodyRenderer {
  private cellEditorManager: CellEditorManager;
  
  /**
   * 행 렌더링 시 RowState에 따른 CSS 클래스 자동 적용
   */
  private applyRowStateClasses(
    rowElement: HTMLElement, 
    virtualRow: VirtualRow
  ): void {
    // 기존 상태 클래스 제거
    rowElement.classList.remove(
      'ps-row-added',
      'ps-row-modified', 
      'ps-row-deleted'
    );

    // 새 상태 클래스 적용
    switch (virtualRow.rowState) {
      case 'added':
        rowElement.classList.add('ps-row-added');
        break;
      case 'modified':
        rowElement.classList.add('ps-row-modified');
        break;
      case 'deleted':
        rowElement.classList.add('ps-row-deleted');
        break;
    }
  }

  /**
   * 셀 렌더링 시 CellState에 따른 CSS 클래스 자동 적용
   */
  private applyCellStateClasses(
    cellElement: HTMLElement,
    virtualRow: VirtualRow,
    field: string
  ): void {
    // 기존 상태 클래스 제거
    cellElement.classList.remove(
      'ps-cell-added',
      'ps-cell-modified',
      'ps-cell-deleted'
    );

    switch (virtualRow.rowState) {
      case 'added':
        cellElement.classList.add('ps-cell-added');
        break;
      case 'deleted':
        cellElement.classList.add('ps-cell-deleted');
        break;
      case 'modified':
        // 수정된 행의 경우, 해당 필드가 실제로 수정되었는지 확인
        if (virtualRow.changedFields?.has(field)) {
          cellElement.classList.add('ps-cell-modified');
        }
        break;
    }
  }
}
```

---

### 9. PureSheet API

```typescript
class PureSheet {
  private changeTracker: ChangeTracker;
  private undoStack: UndoStack;
  private cellEditorManager: CellEditorManager;

  // ─────────────────────────────────────────────────────────────
  // CRUD API
  // ─────────────────────────────────────────────────────────────

  /**
   * 새 행 추가
   * @param row 행 데이터 (id 없으면 자동 생성)
   * @param insertIndex 삽입 위치 (기본: 마지막)
   */
  addRow(row: Partial<Row>, insertIndex?: number): void {
    const idx = insertIndex ?? this.dataStore.length;
    const command = new AddRowCommand(this.changeTracker, row as Row, idx);
    this.undoStack.push(command);
    this.refresh();
  }

  /**
   * 셀 값 수정
   */
  updateCell(rowId: string | number, field: string, value: CellValue): void {
    const originalData = this.dataStore.getById(rowId);
    if (!originalData) return;

    const command = new UpdateCellCommand(
      this.changeTracker,
      rowId,
      field,
      value,
      originalData
    );
    this.undoStack.push(command);
    this.refresh();
  }

  /**
   * 행 삭제
   */
  deleteRow(rowId: string | number): void {
    const originalData = this.dataStore.getById(rowId);
    const originalIndex = this.dataStore.getIndexById(rowId);
    if (!originalData || originalIndex === -1) return;

    const command = new DeleteRowCommand(
      this.changeTracker,
      rowId,
      originalData,
      originalIndex
    );
    this.undoStack.push(command);
    this.refresh();
  }

  // ─────────────────────────────────────────────────────────────
  // Undo/Redo API
  // ─────────────────────────────────────────────────────────────

  undo(): boolean {
    const result = this.undoStack.undo();
    if (result) this.refresh();
    return result;
  }

  redo(): boolean {
    const result = this.undoStack.redo();
    if (result) this.refresh();
    return result;
  }

  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }

  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  // ─────────────────────────────────────────────────────────────
  // Dirty State API
  // ─────────────────────────────────────────────────────────────

  /**
   * 변경사항 존재 여부
   */
  get hasChanges(): boolean {
    return this.changeTracker.hasChanges;
  }

  /**
   * 변경사항 조회
   */
  getChanges(): {
    added: AddedRow[];
    modified: ModifiedRow[];
    deleted: DeletedRow[];
  } {
    return this.changeTracker.getChanges();
  }

  /**
   * 변경사항 커밋 (원본 데이터에 반영)
   */
  async commitChanges(): Promise<void> {
    const changes = this.getChanges();
    
    // DataStore에 반영
    for (const added of changes.added) {
      this.dataStore.insert(added.data, added.insertIndex);
    }
    for (const modified of changes.modified) {
      this.dataStore.update(modified.rowId, modified.currentData);
    }
    for (const deleted of changes.deleted) {
      this.dataStore.delete(deleted.rowId);
    }
    
    // ChangeTracker & UndoStack 초기화
    this.changeTracker.commitComplete();
    this.undoStack.clear();
    
    this.refresh();
  }

  /**
   * 모든 변경사항 폐기
   */
  discardChanges(): void {
    this.changeTracker.discard();
    this.undoStack.clear();
    this.refresh();
  }

  /**
   * 특정 행 변경사항 폐기
   */
  discardRow(rowId: string | number): void {
    this.changeTracker.discardRow(rowId);
    this.refresh();
  }
}
```

---

## 구현 순서

### Phase 1: 기본 인프라
1. `ChangeTracker` 클래스 구현
2. `UndoStack` 클래스 구현
3. Command 구현체 (AddRow, UpdateCell, DeleteRow)

### Phase 2: CSS 스타일
1. Row 상태별 스타일 (`ps-row-added`, `ps-row-modified`, `ps-row-deleted`)
2. Cell 상태별 스타일 (`ps-cell-added`, `ps-cell-modified`, `ps-cell-deleted`)
3. 에디터 스타일 (`ps-cell-editing`, `ps-cell-editor`)

### Phase 3: BodyRenderer 통합
1. `VirtualRow`에 `rowState`, `changedFields` 반영
2. `applyRowStateClasses()` 구현
3. `applyCellStateClasses()` 구현

### Phase 4: 인라인 편집
1. `CellEditor` 인터페이스 정의
2. `TextInputEditor` 구현
3. `CellEditorManager` 구현 (더블클릭 → 편집)

### Phase 5: 단축키 및 API
1. `KeyboardShortcutManager` 구현 (Ctrl+Z, Ctrl+Y)
2. `PureSheet` CRUD API 추가
3. Dirty State API 추가

---

## 영향받는 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/core/ChangeTracker.ts` | 신규 생성 - Dirty State 관리 |
| `src/core/UndoStack.ts` | 신규 생성 - Command 패턴, Undo/Redo |
| `src/core/commands/` | 신규 생성 - AddRow, UpdateCell, DeleteRow Command |
| `src/ui/editing/CellEditorManager.ts` | 신규 생성 - 인라인 편집 관리 |
| `src/ui/editing/editors/TextInputEditor.ts` | 신규 생성 - 기본 텍스트 에디터 |
| `src/ui/keyboard/KeyboardShortcutManager.ts` | 신규 생성 - 단축키 바인딩 |
| `src/ui/body/BodyRenderer.ts` | 수정 - rowState/cellState CSS 적용 |
| `src/ui/PureSheet.ts` | 수정 - CRUD/Undo/Dirty State API 추가 |
| `src/ui/style/default.css` | 수정 - 상태별 스타일 추가 |
| `src/types/crud.types.ts` | 신규 생성 - CRUD 관련 타입 |

---

## 결론

1. **Command 패턴**: UndoStack은 Command 패턴으로 구현하여 다양한 변경 유형을 통일된 방식으로 처리
2. **Dirty State**: ChangeTracker가 pending changes를 관리하고, commit/discard 패턴 제공
3. **시각적 피드백**: Row/Cell 상태별 자동 CSS 클래스 적용으로 사용자에게 명확한 피드백
4. **인라인 편집**: 더블클릭으로 즉시 편집 모드 진입, Enter/Escape/Tab으로 제어
5. **확장 가능한 에디터**: CellEditorFactory 레지스트리 패턴으로 Dropdown 등 커스텀 에디터 추가 용이
6. **단축키 지원**: Ctrl+Z(undo), Ctrl+Y/Ctrl+Shift+Z(redo) 기본 제공
