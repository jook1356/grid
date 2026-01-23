/**
 * UndoStack - Undo/Redo 스택 관리
 *
 * Command 패턴을 사용하여 변경사항을 추적하고 Undo/Redo를 지원합니다.
 *
 * @example
 * const undoStack = new UndoStack();
 *
 * // 명령 실행
 * undoStack.push(new UpdateCellCommand(...));
 *
 * // Undo/Redo
 * undoStack.undo();
 * undoStack.redo();
 *
 * // 상태 확인
 * console.log(undoStack.canUndo, undoStack.canRedo);
 *
 * // Batch 모드 (여러 작업을 하나의 Undo 단위로 묶기)
 * undoStack.beginBatch('3개 행 삭제');
 * undoStack.push(command1);
 * undoStack.push(command2);
 * undoStack.endBatch(); // → BatchCommand로 묶여서 스택에 추가
 */

import type { Command, UndoStackEvents } from '../types/crud.types';
import { SimpleEventEmitter } from './SimpleEventEmitter';
import { BatchCommand } from './commands';

/**
 * UndoStack 옵션
 */
export interface UndoStackOptions {
    /** 최대 히스토리 크기 (기본: 100) */
    maxSize?: number;
}

/**
 * Undo/Redo 스택 관리자
 */
export class UndoStack extends SimpleEventEmitter<UndoStackEvents> {
    private undoStack: Command[] = [];
    private redoStack: Command[] = [];
    private readonly maxSize: number;

    // Batch 모드 관련
    private batchBuffer: Command[] | null = null;
    private batchDescription: string | undefined;

    constructor(options: UndoStackOptions = {}) {
        super();
        this.maxSize = options.maxSize ?? 100;
    }

    // =========================================================================
    // Batch 모드 API
    // =========================================================================

    /**
     * Batch 모드 시작
     *
     * beginBatch() 호출 후 endBatch() 전까지 push되는 모든 Command들이
     * 하나의 BatchCommand로 묶여서 Undo Stack에 추가됩니다.
     *
     * @param description - Batch 설명 (디버깅용)
     *
     * @example
     * undoStack.beginBatch('3개 행 삭제');
     * undoStack.push(deleteCommand1);
     * undoStack.push(deleteCommand2);
     * undoStack.push(deleteCommand3);
     * undoStack.endBatch();
     * // → Ctrl+Z 1번으로 3개 행 모두 복원
     */
    beginBatch(description?: string): void {
        // 이미 batch 중이면 기존 것 자동 종료
        if (this.batchBuffer !== null) {
            this.endBatch();
        }
        this.batchBuffer = [];
        this.batchDescription = description;
    }

    /**
     * Batch 모드 종료
     *
     * 버퍼에 모인 Command들을 BatchCommand로 묶어서 스택에 추가합니다.
     * 버퍼가 비어있으면 아무것도 하지 않습니다.
     */
    endBatch(): void {
        if (this.batchBuffer === null) return;

        if (this.batchBuffer.length > 0) {
            const batchCommand = new BatchCommand(
                this.batchBuffer,
                this.batchDescription
            );
            // 스택에 추가 (execute는 이미 push에서 실행됨)
            this.undoStack.push(batchCommand);
            this.redoStack = [];

            if (this.undoStack.length > this.maxSize) {
                this.undoStack.shift();
            }

            this.emit('push', { command: batchCommand });
            this.emitStateChange();
        }

        this.batchBuffer = null;
        this.batchDescription = undefined;
    }

    /**
     * 현재 Batch 모드 여부
     */
    get isBatching(): boolean {
        return this.batchBuffer !== null;
    }

    // =========================================================================
    // 기본 API
    // =========================================================================

    /**
     * 명령 실행 및 스택에 추가
     *
     * Batch 모드일 경우 버퍼에 저장되고, endBatch() 시 BatchCommand로 묶입니다.
     */
    push(command: Command): void {
        command.execute();

        // Batch 모드: 버퍼에 저장
        if (this.batchBuffer !== null) {
            this.batchBuffer.push(command);
            return;
        }

        // 일반 모드: 스택에 직접 추가
        this.undoStack.push(command);
        this.redoStack = []; // redo 스택 초기화

        // 최대 크기 초과 시 오래된 명령 제거
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }

        this.emit('push', { command });
        this.emitStateChange();
    }

    /**
     * 명령만 실행 (스택에 추가하지 않음 - 내부용)
     */
    executeOnly(command: Command): void {
        command.execute();
    }

    /**
     * 마지막 명령 취소
     */
    undo(): boolean {
        const command = this.undoStack.pop();
        if (!command) return false;

        command.undo();
        this.redoStack.push(command);

        this.emit('undo', { command });
        this.emitStateChange();
        return true;
    }

    /**
     * 취소된 명령 다시 실행
     */
    redo(): boolean {
        const command = this.redoStack.pop();
        if (!command) return false;

        command.execute();
        this.undoStack.push(command);

        this.emit('redo', { command });
        this.emitStateChange();
        return true;
    }

    /**
     * Undo 가능 여부
     */
    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Redo 가능 여부
     */
    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Undo 스택 크기
     */
    get undoCount(): number {
        return this.undoStack.length;
    }

    /**
     * Redo 스택 크기
     */
    get redoCount(): number {
        return this.redoStack.length;
    }

    /**
     * 스택 초기화 (commit 후 호출)
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.batchBuffer = null;
        this.batchDescription = undefined;
        this.emit('clear', undefined);
        this.emitStateChange();
    }

    /**
     * 마지막 Undo 명령 peek
     */
    peekUndo(): Command | undefined {
        return this.undoStack[this.undoStack.length - 1];
    }

    /**
     * 마지막 Redo 명령 peek
     */
    peekRedo(): Command | undefined {
        return this.redoStack[this.redoStack.length - 1];
    }

    private emitStateChange(): void {
        this.emit('stateChange', {
            canUndo: this.canUndo,
            canRedo: this.canRedo,
        });
    }
}
