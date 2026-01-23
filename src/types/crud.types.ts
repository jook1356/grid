/**
 * CRUD 관련 타입 정의
 *
 * ChangeTracker, UndoStack, Command 패턴에서 사용되는 타입들을 정의합니다.
 */

import type { CellValue, Row } from './data.types';

// ============================================================================
// 행 상태 타입
// ============================================================================

/**
 * 행 변경 상태
 */
export type RowState =
  | 'pristine'   // 원본 그대로
  | 'added'      // 새로 추가됨 (commit 전)
  | 'modified'   // 수정됨 (commit 전)
  | 'deleted';   // 삭제 예정 (commit 전)

/**
 * 셀 변경 상태
 */
export type CellState =
  | 'pristine'   // 원본 그대로
  | 'modified';  // 수정됨

// ============================================================================
// 변경 추적 타입
// ============================================================================

/**
 * 추가된 행 정보
 */
export interface AddedRow {
  rowId: string | number;
  data: Row;
  insertIndex: number;
}

/**
 * 수정된 필드 정보
 */
export interface ChangedField {
  originalValue: CellValue;
  currentValue: CellValue;
}

/**
 * 수정된 행 정보
 */
export interface ModifiedRow {
  rowId: string | number;
  originalData: Row;
  currentData: Row;
  changedFields: Map<string, ChangedField>;
}

/**
 * 삭제된 행 정보
 */
export interface DeletedRow {
  rowId: string | number;
  originalData: Row;
  originalIndex: number;
}

/**
 * 변경사항 요약
 */
export interface ChangesSummary {
  added: AddedRow[];
  modified: ModifiedRow[];
  deleted: DeletedRow[];
}

// ============================================================================
// Command 패턴 타입
// ============================================================================

/**
 * Command 타입
 */
export type CommandType =
  | 'addRow'
  | 'updateCell'
  | 'deleteRow'
  | 'undeleteRow'
  | 'discardRow'
  | 'batch';

/**
 * Undo/Redo 가능한 명령 인터페이스
 */
export interface Command {
  /** 명령 타입 */
  readonly type: CommandType;

  /** 명령 실행 */
  execute(): void;

  /** 명령 취소 (undo) */
  undo(): void;

  /** 명령 설명 (디버깅용) */
  readonly description: string;
}

/**
 * 여러 명령을 하나로 묶는 배치 명령
 */
export interface BatchCommand extends Command {
  type: 'batch';
  readonly commands: Command[];
}

// ============================================================================
// ChangeTracker 이벤트 타입
// ============================================================================

/**
 * ChangeTracker 이벤트
 */
export interface ChangeTrackerEvents {
  /** 변경사항 발생 */
  'change': { hasChanges: boolean };
  
  /** 행 추가됨 */
  'rowAdded': { rowId: string | number };
  
  /** 행 수정됨 */
  'rowModified': { rowId: string | number; field: string };
  
  /** 행 삭제됨 */
  'rowDeleted': { rowId: string | number };
  
  /** 변경사항 폐기됨 */
  'discarded': { rowId?: string | number };
}

// ============================================================================
// UndoStack 이벤트 타입
// ============================================================================

/**
 * UndoStack 이벤트
 */
export interface UndoStackEvents {
  /** 명령 실행됨 */
  'push': { command: Command };
  
  /** Undo 실행됨 */
  'undo': { command: Command };
  
  /** Redo 실행됨 */
  'redo': { command: Command };
  
  /** 스택 초기화됨 */
  'clear': void;
  
  /** 상태 변경됨 (canUndo, canRedo) */
  'stateChange': { canUndo: boolean; canRedo: boolean };
}
