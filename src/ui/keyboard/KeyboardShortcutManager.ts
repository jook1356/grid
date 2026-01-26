/**
 * KeyboardShortcutManager - 단축키 관리
 *
 * Undo/Redo 등 키보드 단축키를 처리합니다.
 *
 * @example
 * const manager = new KeyboardShortcutManager(container, {
 *   onUndo: () => grid.undo(),
 *   onRedo: () => grid.redo(),
 * });
 *
 * // 커스텀 단축키 등록
 * manager.register('ctrl+s', () => saveChanges());
 *
 * // 정리
 * manager.destroy();
 */

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
    /** Undo 실행 콜백 (PureSheet.undo() 호출용) */
    onUndo?: () => void;
    /** Redo 실행 콜백 (PureSheet.redo() 호출용) */
    onRedo?: () => void;
}

/**
 * 키보드 단축키 관리자
 */
export class KeyboardShortcutManager {
    private shortcuts: Map<string, ShortcutHandler> = new Map();
    private boundHandler: (e: KeyboardEvent) => void;

    constructor(
        private readonly container: HTMLElement,
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

        const { onUndo, onRedo } = this.options;

        // Undo: Ctrl+Z (Windows/Linux), Cmd+Z (Mac)
        if (onUndo) {
            this.register('ctrl+z', onUndo);
            this.register('meta+z', onUndo);
        }

        // Redo: Ctrl+Y 또는 Ctrl+Shift+Z (Windows/Linux), Cmd+Shift+Z (Mac)
        if (onRedo) {
            this.register('ctrl+y', onRedo);
            this.register('ctrl+shift+z', onRedo);
            this.register('meta+shift+z', onRedo);
        }
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
}
