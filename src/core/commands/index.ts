/**
 * Command 패턴 구현체
 *
 * CRUD 작업을 Command로 래핑하여 Undo/Redo를 지원합니다.
 */

import type { CellValue, Row } from '../../types';
import type { Command } from '../../types/crud.types';
import type { ChangeTracker } from '../ChangeTracker';

// ============================================================================
// AddRowCommand
// ============================================================================

/**
 * 행 추가 Command
 */
export class AddRowCommand implements Command {
    readonly type = 'addRow' as const;
    readonly description: string;

    private addedRowId: string | number | null = null;

    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly row: Row,
        private readonly insertIndex: number
    ) {
        this.description = `행 추가 (index: ${insertIndex})`;
    }

    execute(): void {
        this.addedRowId = this.changeTracker.addRow(this.row, this.insertIndex);
    }

    undo(): void {
        if (this.addedRowId !== null) {
            this.changeTracker.discardRow(this.addedRowId);
        }
    }

    /**
     * 추가된 행의 ID 반환
     * execute() 호출 후에 유효한 값 반환
     */
    getAddedRowId(): string | number {
        if (this.addedRowId !== null) {
            return this.addedRowId;
        }
        // execute() 전이면 row.id 사용 (있는 경우)
        const rawId = this.row.id;
        return typeof rawId === 'string' || typeof rawId === 'number' ? rawId : 'unknown';
    }
}

// ============================================================================
// UpdateCellCommand
// ============================================================================

/**
 * 셀 수정 Command
 *
 * 연속 수정 시에도 각 수정의 바로 이전 값을 올바르게 추적합니다.
 * Command 생성 시점의 ChangeTracker 현재 값을 previousValue로 저장합니다.
 */
export class UpdateCellCommand implements Command {
    readonly type = 'updateCell' as const;
    readonly description: string;

    private readonly previousValue: CellValue;

    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly rowId: string | number,
        private readonly field: string,
        private readonly newValue: CellValue,
        private readonly originalData: Row
    ) {
        // ChangeTracker에 현재 추적 중인 값이 있으면 그것을 사용, 없으면 원본 사용
        // 이렇게 해야 연속 수정 시에도 각 수정의 바로 이전 값을 올바르게 저장
        const currentData = this.changeTracker.getCurrentData(rowId);
        this.previousValue = currentData ? currentData[field] : originalData[field];
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

// ============================================================================
// DeleteRowCommand
// ============================================================================

/**
 * 행 삭제 Command
 */
export class DeleteRowCommand implements Command {
    readonly type = 'deleteRow' as const;
    readonly description: string;

    // 추가된 행이었는지 여부 (undo 시 addRow로 복원해야 함)
    private readonly wasAddedRow: boolean;

    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly rowId: string | number,
        private readonly originalData: Row,
        private readonly originalIndex: number
    ) {
        this.description = `행 삭제 (rowId: ${rowId})`;
        // 실행 전에 추가된 행인지 확인
        this.wasAddedRow = this.changeTracker.addedRows.has(rowId);
    }

    execute(): void {
        this.changeTracker.deleteRow(this.rowId, this.originalData, this.originalIndex);
    }

    undo(): void {
        if (this.wasAddedRow) {
            // 추가된 행이었으면 다시 addRow로 복원
            this.changeTracker.addRow(this.originalData, this.originalIndex);
        } else {
            // 기존 행이었으면 삭제 목록에서 제거
            this.changeTracker.undeleteRow(this.rowId);
        }
    }
}

// ============================================================================
// UndeleteRowCommand
// ============================================================================

/**
 * 삭제 취소 Command (삭제 예정 → 되돌리기)
 *
 * 삭제된 행을 복원하는 작업을 Undo/Redo 가능하게 래핑합니다.
 */
export class UndeleteRowCommand implements Command {
    readonly type = 'undeleteRow' as const;
    readonly description: string;

    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly rowId: string | number,
        private readonly originalData: Row,
        private readonly originalIndex: number
    ) {
        this.description = `삭제 취소 (rowId: ${rowId})`;
    }

    execute(): void {
        // 삭제 목록에서 제거
        this.changeTracker.undeleteRow(this.rowId);
    }

    undo(): void {
        // 다시 삭제 상태로
        this.changeTracker.deleteRow(this.rowId, this.originalData, this.originalIndex);
    }
}

// ============================================================================
// DiscardRowCommand
// ============================================================================

/**
 * 행 변경사항 폐기 Command
 *
 * added, modified, deleted 상태를 저장하고 폐기 후 Undo 시 복원합니다.
 */
export class DiscardRowCommand implements Command {
    readonly type = 'discardRow' as const;
    readonly description: string;

    // 폐기 전 상태 저장
    private readonly wasAdded: boolean;
    private readonly wasModified: boolean;
    private readonly wasDeleted: boolean;
    private readonly addedData: Row | null = null;
    private readonly addedIndex: number = 0;
    private readonly modifiedData: { original: Row; current: Row; fields: Map<string, { originalValue: CellValue; currentValue: CellValue }> } | null = null;
    private readonly deletedData: Row | null = null;
    private readonly deletedIndex: number = 0;

    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly rowId: string | number
    ) {
        this.description = `변경사항 폐기 (rowId: ${rowId})`;

        // 현재 상태 저장
        const added = this.changeTracker.addedRows.get(rowId);
        const modified = this.changeTracker.modifiedRows.get(rowId);
        const deleted = this.changeTracker.deletedRows.get(rowId);

        this.wasAdded = !!added;
        this.wasModified = !!modified;
        this.wasDeleted = !!deleted;

        if (added) {
            this.addedData = { ...added.data };
            this.addedIndex = added.insertIndex;
        }
        if (modified) {
            this.modifiedData = {
                original: { ...modified.originalData },
                current: { ...modified.currentData },
                fields: new Map(modified.changedFields),
            };
        }
        if (deleted) {
            this.deletedData = { ...deleted.originalData };
            this.deletedIndex = deleted.originalIndex;
        }
    }

    execute(): void {
        this.changeTracker.discardRow(this.rowId);
    }

    undo(): void {
        if (this.wasAdded && this.addedData) {
            // 다시 추가
            this.changeTracker.addRow(this.addedData, this.addedIndex);
        }
        if (this.wasModified && this.modifiedData) {
            // 다시 수정 상태로 복원 - 각 필드별로 updateCell 호출
            for (const [field, change] of this.modifiedData.fields) {
                this.changeTracker.updateCell(
                    this.rowId,
                    field,
                    change.currentValue,
                    this.modifiedData.original
                );
            }
        }
        if (this.wasDeleted && this.deletedData) {
            // 다시 삭제 예정 상태로 복원
            this.changeTracker.deleteRow(this.rowId, this.deletedData, this.deletedIndex);
        }
    }
}

// ============================================================================
// BatchCommand
// ============================================================================

/**
 * 여러 명령을 하나로 묶는 배치 Command
 */
export class BatchCommand implements Command {
    readonly type = 'batch' as const;
    readonly description: string;

    constructor(
        readonly commands: Command[],
        description?: string
    ) {
        this.description = description ?? `배치 (${commands.length}개 명령)`;
    }

    execute(): void {
        for (const command of this.commands) {
            command.execute();
        }
    }

    undo(): void {
        // 역순으로 undo
        for (let i = this.commands.length - 1; i >= 0; i--) {
            this.commands[i]?.undo();
        }
    }
}
