/**
 * ChangeTracker - Dirty State 관리
 *
 * CRUD 작업의 변경사항을 추적하고 관리합니다.
 * 원본 데이터에 즉시 반영하지 않고 pending 상태로 유지합니다.
 *
 * @example
 * const tracker = new ChangeTracker();
 *
 * // 행 추가
 * tracker.addRow({ id: 'new-1', name: '신규' }, 0);
 *
 * // 셀 수정
 * tracker.updateCell('row-1', 'name', '수정됨', originalRow);
 *
 * // 행 삭제
 * tracker.deleteRow('row-2', originalRow, 1);
 *
 * // 변경사항 확인
 * console.log(tracker.hasChanges); // true
 * console.log(tracker.getChanges());
 *
 * // 커밋 또는 폐기
 * tracker.commitComplete(); // 또는 tracker.discard();
 */

import type { CellValue, Row } from '../types';
import type {
    RowState,
    CellState,
    AddedRow,
    ModifiedRow,
    DeletedRow,
    ChangesSummary,
    ChangedField,
} from '../types/crud.types';
import { SimpleEventEmitter } from './SimpleEventEmitter';
import type { ChangeTrackerEvents } from '../types/crud.types';

/**
 * Dirty State 관리자
 */
export class ChangeTracker extends SimpleEventEmitter<ChangeTrackerEvents> {
    private _addedRows: Map<string | number, AddedRow> = new Map();
    private _modifiedRows: Map<string | number, ModifiedRow> = new Map();
    private _deletedRows: Map<string | number, DeletedRow> = new Map();

    private _version: number = 0;
    private _idCounter: number = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // 상태 조회
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 변경사항 존재 여부
     */
    get hasChanges(): boolean {
        return (
            this._addedRows.size > 0 ||
            this._modifiedRows.size > 0 ||
            this._deletedRows.size > 0
        );
    }

    /**
     * 버전 (캐시 무효화용)
     */
    get version(): number {
        return this._version;
    }

    /**
     * 행 상태 조회
     */
    getRowState(rowId: string | number): RowState {
        if (this._addedRows.has(rowId)) return 'added';
        if (this._deletedRows.has(rowId)) return 'deleted';
        if (this._modifiedRows.has(rowId)) return 'modified';
        return 'pristine';
    }

    /**
     * 셀 상태 조회
     */
    getCellState(rowId: string | number, field: string): CellState {
        const modified = this._modifiedRows.get(rowId);
        if (modified?.changedFields.has(field)) return 'modified';
        return 'pristine';
    }

    /**
     * 변경된 필드 목록 조회
     */
    getChangedFields(rowId: string | number): Set<string> | undefined {
        const modified = this._modifiedRows.get(rowId);
        return modified ? new Set(modified.changedFields.keys()) : undefined;
    }

    /**
     * 원본 값 조회
     */
    getOriginalValue(rowId: string | number, field: string): CellValue | undefined {
        const modified = this._modifiedRows.get(rowId);
        return modified?.changedFields.get(field)?.originalValue;
    }

    /**
     * 현재 데이터 조회 (수정된 경우 수정된 값, 아니면 undefined)
     */
    getCurrentData(rowId: string | number): Row | undefined {
        const added = this._addedRows.get(rowId);
        if (added) return added.data;

        const modified = this._modifiedRows.get(rowId);
        if (modified) return modified.currentData;

        return undefined;
    }

    /**
     * 행이 삭제되었는지 확인
     */
    isDeleted(rowId: string | number): boolean {
        return this._deletedRows.has(rowId);
    }

    /**
     * 추가된 행 목록
     */
    get addedRows(): ReadonlyMap<string | number, AddedRow> {
        return this._addedRows;
    }

    /**
     * 수정된 행 목록
     */
    get modifiedRows(): ReadonlyMap<string | number, ModifiedRow> {
        return this._modifiedRows;
    }

    /**
     * 삭제된 행 ID 목록
     */
    get deletedRowIds(): Set<string | number> {
        return new Set(this._deletedRows.keys());
    }

    /**
     * 삭제된 행 정보 (원본 데이터 포함)
     */
    get deletedRows(): ReadonlyMap<string | number, DeletedRow> {
        return this._deletedRows;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 변경 메서드
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 행 추가
     */
    addRow(row: Row, insertIndex: number): string | number {
        // row.id가 string 또는 number인 경우에만 사용, 아니면 자동 생성
        const rawId = row.id;
        const rowId: string | number =
            typeof rawId === 'string' || typeof rawId === 'number'
                ? rawId
                : this.generateRowId();
        const data = { ...row, id: rowId };

        this._addedRows.set(rowId, {
            rowId,
            data,
            insertIndex,
        });

        this._version++;
        this.emit('rowAdded', { rowId });
        this.emit('change', { hasChanges: this.hasChanges });

        return rowId;
    }

    /**
     * 셀 값 수정
     */
    updateCell(
        rowId: string | number,
        field: string,
        newValue: CellValue,
        originalData: Row
    ): void {
        // 추가된 행의 수정은 added 상태 유지
        const addedRow = this._addedRows.get(rowId);
        if (addedRow) {
            addedRow.data[field] = newValue;
            this._version++;
            this.emit('rowModified', { rowId, field });
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
                changedFields: new Map<string, ChangedField>(),
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
                currentValue: newValue,
            });
            modified.currentData[field] = newValue;
        }

        this._version++;
        this.emit('rowModified', { rowId, field });
        this.emit('change', { hasChanges: this.hasChanges });
    }

    /**
     * 행 삭제
     */
    deleteRow(rowId: string | number, originalData: Row, originalIndex: number): void {
        // 추가된 행 삭제 → 그냥 제거
        if (this._addedRows.has(rowId)) {
            this._addedRows.delete(rowId);
            this._version++;
            this.emit('rowDeleted', { rowId });
            this.emit('change', { hasChanges: this.hasChanges });
            return;
        }

        // 수정 상태 정리
        this._modifiedRows.delete(rowId);

        // 삭제 목록에 추가
        this._deletedRows.set(rowId, {
            rowId,
            originalData: { ...originalData },
            originalIndex,
        });

        this._version++;
        this.emit('rowDeleted', { rowId });
        this.emit('change', { hasChanges: this.hasChanges });
    }

    /**
     * 삭제 취소 (Undo용)
     */
    undeleteRow(rowId: string | number): void {
        this._deletedRows.delete(rowId);
        this._version++;
        this.emit('change', { hasChanges: this.hasChanges });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 커밋/폐기
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 변경사항 가져오기
     */
    getChanges(): ChangesSummary {
        return {
            added: [...this._addedRows.values()],
            modified: [...this._modifiedRows.values()],
            deleted: [...this._deletedRows.values()],
        };
    }

    /**
     * 모든 변경사항 폐기
     */
    discard(): void {
        this._addedRows.clear();
        this._modifiedRows.clear();
        this._deletedRows.clear();
        this._version++;
        this.emit('discarded', {});
        this.emit('change', { hasChanges: false });
    }

    /**
     * 특정 행 변경사항 폐기
     */
    discardRow(rowId: string | number): void {
        this._addedRows.delete(rowId);
        this._modifiedRows.delete(rowId);
        this._deletedRows.delete(rowId);
        this._version++;
        this.emit('discarded', { rowId });
        this.emit('change', { hasChanges: this.hasChanges });
    }

    /**
     * 커밋 완료 (DataStore에 반영 후 호출)
     */
    commitComplete(): void {
        this.discard();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 내부 메서드
    // ─────────────────────────────────────────────────────────────────────────

    private generateRowId(): string {
        return `new-${Date.now()}-${++this._idCounter}`;
    }
}
