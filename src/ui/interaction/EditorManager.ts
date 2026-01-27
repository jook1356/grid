/**
 * EditorManager - 셀 편집 관리
 *
 * 셀 편집 모드를 관리하고 다양한 에디터 타입을 지원합니다.
 * - 텍스트, 숫자, 날짜, 선택, 체크박스 에디터
 * - 유효성 검사
 * - 키보드 단축키 (Enter, Tab, Escape)
 */

import { SimpleEventEmitter } from '../../core/SimpleEventEmitter';
import type { GridCore } from '../../core/GridCore';
import type { CellValue, ColumnDef } from '../../types';
import type { CellPosition, EditorConfig, EditorType } from '../types';

/**
 * EditorManager 이벤트 타입
 */
interface EditorManagerEvents {
  /** 편집 시작 */
  editStart: { position: CellPosition; value: CellValue };
  /** 편집 확정 */
  editCommit: { position: CellPosition; oldValue: CellValue; newValue: CellValue };
  /** 편집 취소 */
  editCancel: { position: CellPosition };
  /** 유효성 검사 실패 */
  validationError: { position: CellPosition; message: string };
}

/**
 * EditorManager 설정
 */
export interface EditorManagerOptions {
  /** GridCore 인스턴스 */
  gridCore: GridCore;
  /** 편집 가능 여부 */
  editable: boolean;
  /** 셀 편집 완료 콜백 (ChangeTracker 연동용) */
  onCellEdit?: (rowId: string | number, field: string, oldValue: CellValue, newValue: CellValue) => void;
  /** 행 데이터 조회 콜백 (ChangeTracker 병합 데이터 포함) */
  getRowData?: (visibleIndex: number) => Record<string, unknown> | undefined;
}

/**
 * 셀 편집 관리자
 */
export class EditorManager extends SimpleEventEmitter<EditorManagerEvents> {
  private readonly gridCore: GridCore;
  private readonly editable: boolean;

  // 편집 상태
  private activeEditor: HTMLElement | null = null;
  private editingCell: CellPosition | null = null;
  private originalValue: CellValue = null;

  // 컬럼별 에디터 설정
  private editorConfigs: Map<string, EditorConfig> = new Map();

  // 셀 편집 콜백 (ChangeTracker 연동)
  private onCellEdit?: EditorManagerOptions['onCellEdit'];

  // 행 데이터 조회 콜백 (ChangeTracker 병합 데이터 포함)
  private getRowData?: EditorManagerOptions['getRowData'];

  constructor(options: EditorManagerOptions) {
    super();

    this.gridCore = options.gridCore;
    this.editable = options.editable;
    this.onCellEdit = options.onCellEdit;
    this.getRowData = options.getRowData;

    // 컬럼 정의에서 에디터 설정 추출
    this.initializeEditorConfigs();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 편집 중인지 확인
   */
  isEditing(): boolean {
    return this.editingCell !== null;
  }

  /**
   * 현재 편집 중인 셀 위치
   */
  getEditingCell(): CellPosition | null {
    return this.editingCell;
  }

  /**
   * 편집 모드 시작
   */
  startEdit(position: CellPosition, cellElement: HTMLElement, initialValue?: string): boolean {
    if (!this.editable) return false;

    // 기존 편집 종료
    if (this.activeEditor) {
      this.commitEdit();
    }

    // 컬럼 정의 확인
    const colDef = this.getColumnDef(position.columnKey);
    // readonly가 true면 편집 불가 (전역 editable 설정보다 우선)
    if (colDef?.readonly === true) {
      return false;
    }
    // editable이 명시적으로 false면 편집 불가
    if (colDef?.editable === false) {
      return false;
    }

    // 현재 값 가져오기 (ChangeTracker 병합 데이터 우선 사용)
    const row = this.getRowData?.(position.rowIndex)
      ?? this.gridCore.getRowByVisibleIndex(position.rowIndex);
    if (!row) return false;

    this.editingCell = position;
    this.originalValue = row[position.columnKey] as CellValue;

    // 에디터 생성
    const editorConfig = this.editorConfigs.get(position.columnKey);
    const editor = this.createEditor(
      editorConfig?.type ?? 'text',
      editorConfig,
      initialValue ?? String(this.originalValue ?? '')
    );

    // 셀에 에디터 마운트
    this.mountEditor(cellElement, editor);

    this.emit('editStart', { position, value: this.originalValue });

    return true;
  }

  /**
   * 편집 확정
   */
  commitEdit(): boolean {
    if (!this.activeEditor || !this.editingCell) return false;

    const newValue = this.getEditorValue();
    const editorConfig = this.editorConfigs.get(this.editingCell.columnKey);

    // 유효성 검사
    const validationResult = this.validate(editorConfig, newValue);
    if (validationResult !== true) {
      this.emit('validationError', {
        position: this.editingCell,
        message: validationResult as string,
      });
      return false;
    }

    // 값이 변경되었는지 확인
    const valueChanged = newValue !== this.originalValue;

    // 값이 변경되었으면 업데이트
    if (valueChanged) {
      // onCellEdit 콜백 호출 (ChangeTracker 연동)
      if (this.onCellEdit) {
        // ChangeTracker 병합 데이터에서 rowId 조회
        const row = this.getRowData?.(this.editingCell.rowIndex)
          ?? this.gridCore.getRowByVisibleIndex(this.editingCell.rowIndex);
        const rawRowId = row?.['id'];
        const rowId = typeof rawRowId === 'string' || typeof rawRowId === 'number' ? rawRowId : undefined;
        if (rowId !== undefined) {
          this.onCellEdit(rowId, this.editingCell.columnKey, this.originalValue, newValue);
        }
        // 주의: onCellEdit이 있으면 ChangeTracker가 변경사항을 관리합니다.
        // DataStore 원본은 수정하지 않습니다 (commitChanges() 시점에 반영).
        // 이렇게 해야 Undo/Redo가 정상 작동합니다.
      } else {
        // onCellEdit이 없으면 직접 DataStore 업데이트 (기존 동작)
        const gridCoreRow = this.gridCore.getRowByVisibleIndex(this.editingCell.rowIndex);
        if (gridCoreRow) {
          this.gridCore.updateRow(this.editingCell.rowIndex, {
            [this.editingCell.columnKey]: newValue,
          });
        }
      }

      this.emit('editCommit', {
        position: this.editingCell,
        oldValue: this.originalValue,
        newValue,
      });
    }

    // 값이 변경되었으면 refresh가 새 값 렌더링하므로 복원 불필요
    // 값이 변경되지 않았으면 원래 내용 복원 필요
    this.unmountEditor(!valueChanged);
    return true;
  }

  /**
   * 편집 취소
   */
  cancelEdit(): void {
    if (!this.editingCell) return;

    this.emit('editCancel', { position: this.editingCell });
    this.unmountEditor();
  }

  /**
   * 키보드 이벤트 처리
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.isEditing()) {
      // 편집 중이 아닐 때 Enter 또는 F2로 편집 시작
      if (event.key === 'Enter' || event.key === 'F2') {
        return true; // 외부에서 편집 시작 처리
      }
      return false;
    }

    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (this.commitEdit()) {
          // 다음 행으로 이동 (외부에서 처리)
          return true;
        }
        break;

      case 'Tab':
        event.preventDefault();
        if (this.commitEdit()) {
          // 다음/이전 셀로 이동 (외부에서 처리)
          return true;
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.cancelEdit();
        return true;
    }

    return false;
  }

  /**
   * 에디터 설정 등록
   */
  setEditorConfig(columnKey: string, config: EditorConfig): void {
    this.editorConfigs.set(columnKey, config);
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.unmountEditor();
    this.removeAllListeners();
    this.editorConfigs.clear();
  }

  // ===========================================================================
  // 에디터 생성 (Private)
  // ===========================================================================

  /**
   * 에디터 생성
   */
  private createEditor(
    type: EditorType,
    config: EditorConfig | undefined,
    initialValue: string
  ): HTMLElement {
    switch (type) {
      case 'number':
        return this.createNumberEditor(initialValue);

      case 'date':
        return this.createDateEditor(initialValue);

      case 'select':
        return this.createSelectEditor(config?.options ?? [], initialValue);

      case 'checkbox':
        return this.createCheckboxEditor(initialValue === 'true');

      case 'text':
      default:
        return this.createTextEditor(initialValue);
    }
  }

  /**
   * 텍스트 에디터 생성
   */
  private createTextEditor(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ps-editor ps-editor-text';
    input.value = value;
    return input;
  }

  /**
   * 숫자 에디터 생성
   */
  private createNumberEditor(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'ps-editor ps-editor-number';
    input.value = value;
    return input;
  }

  /**
   * 날짜 에디터 생성
   */
  private createDateEditor(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'ps-editor ps-editor-date';
    input.value = value;
    return input;
  }

  /**
   * 선택 에디터 생성
   */
  private createSelectEditor(
    options: { value: unknown; label: string }[],
    value: string
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'ps-editor ps-editor-select';

    for (const option of options) {
      const optEl = document.createElement('option');
      optEl.value = String(option.value);
      optEl.textContent = option.label;
      if (String(option.value) === value) {
        optEl.selected = true;
      }
      select.appendChild(optEl);
    }

    return select;
  }

  /**
   * 체크박스 에디터 생성
   */
  private createCheckboxEditor(checked: boolean): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'ps-editor ps-editor-checkbox';
    input.checked = checked;
    return input;
  }

  // ===========================================================================
  // 에디터 관리 (Private)
  // ===========================================================================

  /**
   * 에디터 마운트
   */
  private mountEditor(cellElement: HTMLElement, editor: HTMLElement): void {
    // 셀 내용 숨기기
    cellElement.classList.add('ps-editing');

    // 기존 내용 임시 저장
    const originalContent = cellElement.innerHTML;
    cellElement.dataset['originalContent'] = originalContent;
    cellElement.innerHTML = '';

    // 에디터 추가
    cellElement.appendChild(editor);
    this.activeEditor = editor;

    // 포커스
    if (editor instanceof HTMLInputElement || editor instanceof HTMLSelectElement) {
      editor.focus();
      if (editor instanceof HTMLInputElement && editor.type !== 'checkbox') {
        editor.select();
      }
    }

    // 이벤트 리스너
    editor.addEventListener('keydown', this.handleEditorKeyDown);
    editor.addEventListener('blur', this.handleEditorBlur);
  }

  /**
   * 에디터 언마운트
   *
   * @param restoreContent - true면 원래 내용 복원 (취소 시), false면 refresh가 새 값 렌더링 (확정 시)
   */
  private unmountEditor(restoreContent: boolean = true): void {
    if (!this.activeEditor) return;

    const cellElement = this.activeEditor.parentElement;
    if (cellElement) {
      cellElement.classList.remove('ps-editing');

      // 취소 시에만 원래 내용 복원
      // 확정 시에는 gridRenderer.refresh()가 새 값으로 렌더링함
      if (restoreContent) {
        const originalContent = cellElement.dataset['originalContent'];
        if (originalContent !== undefined) {
          cellElement.innerHTML = originalContent;
        }
      }
      delete cellElement.dataset['originalContent'];
    }

    this.activeEditor.removeEventListener('keydown', this.handleEditorKeyDown);
    this.activeEditor.removeEventListener('blur', this.handleEditorBlur);
    this.activeEditor.remove();
    this.activeEditor = null;
    this.editingCell = null;
    this.originalValue = null;
  }

  /**
   * 에디터 키다운 이벤트 핸들러
   */
  private handleEditorKeyDown = (event: KeyboardEvent): void => {
    this.handleKeyDown(event);
  };

  /**
   * 에디터 블러 이벤트 핸들러
   */
  private handleEditorBlur = (): void => {
    // 약간의 지연 후 커밋 (다른 요소로 포커스 이동 시)
    setTimeout(() => {
      if (this.isEditing()) {
        this.commitEdit();
      }
    }, 100);
  };

  /**
   * 에디터 값 가져오기
   */
  private getEditorValue(): CellValue {
    if (!this.activeEditor) return null;

    if (this.activeEditor instanceof HTMLInputElement) {
      const input = this.activeEditor;

      switch (input.type) {
        case 'checkbox':
          return input.checked;
        case 'number':
          return input.value === '' ? null : Number(input.value);
        default:
          return input.value;
      }
    }

    if (this.activeEditor instanceof HTMLSelectElement) {
      return this.activeEditor.value;
    }

    return null;
  }

  // ===========================================================================
  // 유효성 검사 (Private)
  // ===========================================================================

  /**
   * 유효성 검사
   */
  private validate(config: EditorConfig | undefined, value: CellValue): boolean | string {
    if (!config?.validator) {
      return true;
    }

    return config.validator(value);
  }

  // ===========================================================================
  // 헬퍼 (Private)
  // ===========================================================================

  /**
   * 컬럼 정의 가져오기
   */
  private getColumnDef(columnKey: string): ColumnDef | undefined {
    return this.gridCore.getColumns().find((c) => c.key === columnKey);
  }

  /**
   * 에디터 설정 초기화
   */
  private initializeEditorConfigs(): void {
    for (const col of this.gridCore.getColumns()) {
      if (col.editorConfig) {
        this.editorConfigs.set(col.key, col.editorConfig as EditorConfig);
      } else if (col.type) {
        // 컬럼 타입에 따른 기본 에디터
        const type = this.mapColumnTypeToEditorType(col.type);
        this.editorConfigs.set(col.key, { type });
      }
    }
  }

  /**
   * 컬럼 타입을 에디터 타입으로 매핑
   */
  private mapColumnTypeToEditorType(columnType: string): EditorType {
    switch (columnType) {
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'boolean':
        return 'checkbox';
      default:
        return 'text';
    }
  }
}
