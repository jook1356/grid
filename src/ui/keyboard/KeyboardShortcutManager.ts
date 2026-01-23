/**
 * KeyboardShortcutManager - 단축키 관리
 *
 * Undo/Redo 등 키보드 단축키를 처리합니다.
 *
 * @example
 * const manager = new KeyboardShortcutManager(container, undoStack);
 *
 * // 커스텀 단축키 등록
 * manager.register('ctrl+s', () => saveChanges());
 *
 * // 정리
 * manager.destroy();
 */

import type { UndoStack } from '../../core/UndoStack';

/**
 * 단축키 핸들러
 */
export type ShortcutHandler = () => void;

/**
 * 단축키 관리자 옵션
 */
export interface KeyboardShortcutManagerOptions {
    /** Undo/Redo 단축키 비활성화 */
    disableUndoRedo?: boolean;
    /** Undo/Redo 후 호출될 콜백 (DOM 이벤트 대신 사용) */
    onRefresh?: () => void;
}

/**
 * 키보드 단축키 관리자
 */
export class KeyboardShortcutManager {
    private shortcuts: Map<string, ShortcutHandler> = new Map();
    private boundHandler: (e: KeyboardEvent) => void;

    constructor(
        private readonly container: HTMLElement,
        private readonly undoStack: UndoStack,
        private readonly options: KeyboardShortcutManagerOptions = {}
    ) {
        this.boundHandler = this.handleKeyDown.bind(this);
        this.registerDefaults();
        this.attach();
    }

    /**
     * 단축키 등록
     */
    register(shortcut: string, handler: ShortcutHandler): void {
        this.shortcuts.set(shortcut.toLowerCase(), handler);
    }

    /**
     * 단축키 해제
     */
    unregister(shortcut: string): void {
        this.shortcuts.delete(shortcut.toLowerCase());
    }

    /**
     * 리소스 정리
     */
    destroy(): void {
        this.detach();
        this.shortcuts.clear();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────────────────────────

    private registerDefaults(): void {
        if (this.options.disableUndoRedo) return;

        // Undo: Ctrl+Z (Windows/Linux), Cmd+Z (Mac)
        this.register('ctrl+z', () => {
            if (this.undoStack.undo()) {
                this.triggerRefresh();
            }
        });
        this.register('meta+z', () => {
            if (this.undoStack.undo()) {
                this.triggerRefresh();
            }
        });

        // Redo: Ctrl+Y 또는 Ctrl+Shift+Z (Windows/Linux), Cmd+Shift+Z (Mac)
        this.register('ctrl+y', () => {
            if (this.undoStack.redo()) {
                this.triggerRefresh();
            }
        });
        this.register('ctrl+shift+z', () => {
            if (this.undoStack.redo()) {
                this.triggerRefresh();
            }
        });
        this.register('meta+shift+z', () => {
            if (this.undoStack.redo()) {
                this.triggerRefresh();
            }
        });
    }

    private attach(): void {
        this.container.addEventListener('keydown', this.boundHandler);
    }

    private detach(): void {
        this.container.removeEventListener('keydown', this.boundHandler);
    }

    private handleKeyDown(e: KeyboardEvent): void {
        // 편집 중인 입력 필드에서는 단축키 무시
        const target = e.target as HTMLElement;
        if (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable
        ) {
            return;
        }

        const key = this.normalizeKey(e);
        const handler = this.shortcuts.get(key);

        if (handler) {
            e.preventDefault();
            e.stopPropagation();
            handler();
        }
    }

    private normalizeKey(e: KeyboardEvent): string {
        const parts: string[] = [];

        if (e.ctrlKey) parts.push('ctrl');
        if (e.metaKey) parts.push('meta');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');

        // 특수 키 정규화
        let key = e.key.toLowerCase();
        if (key === ' ') key = 'space';
        if (key === 'escape') key = 'esc';

        parts.push(key);
        return parts.join('+');
    }

    /**
     * Refresh 트리거 (콜백 우선, 없으면 DOM 이벤트)
     */
    private triggerRefresh(): void {
        if (this.options.onRefresh) {
            this.options.onRefresh();
        } else {
            // 하위 호환성을 위해 DOM 이벤트도 유지
            this.container.dispatchEvent(
                new CustomEvent('ps:refresh', { bubbles: true })
            );
        }
    }
}
