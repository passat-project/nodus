/**
 * Глобальная инъекция оболочки — ядро моста (ADR-0019): сигнатура
 * `window.nodusDesktop` (инициализационный скрипт bridge.rs), геттер и
 * гвард «мы внутри оболочки». Отдельным файлом, чтобы секции моста
 * (команды окна, файлы/загрузки) импортировали ядро без циклов.
 */

/** Сигнатура инъекции оболочки (инициализационный скрипт bridge.rs). */
interface NodusDesktopGlobal {
  readonly shellVersion: string;
  readonly platform: string;
  showPopup(payload: unknown): Promise<void>;
  logPopupDecision(payload: unknown): Promise<void>;
  setUnreadBadge(count: number | null): Promise<void>;
  flashTaskbar(critical: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Путь на файловом сервере (#558): только новые оболочки — старая не
   *  знает команд, веб показывает «Скопировать путь». */
  openUncPath?(path: string, servers: readonly string[]): Promise<void>;
  revealUncPath?(path: string, servers: readonly string[]): Promise<void>;
  /** Кнопки окна безрамочной оболочки (ADR-0055): только новые оболочки —
   *  установленная с системным заголовком команд не знает. */
  windowMinimize?(): Promise<void>;
  windowToggleMaximize?(): Promise<void>;
  windowClose?(): Promise<void>;
  windowStartDragging?(): Promise<void>;
  windowIsMaximized?(): Promise<boolean>;
  /** Записать текст в буфер обмена (только запись, ≤ 4096 символов). */
  copyText?(text: string): Promise<void>;
  /** Реестр загрузок (эпик #1038): только новые оболочки — команда реестра;
   *  старая установленная команд не знает, веб показывает пустой список. */
  downloadsList?(): Promise<unknown>;
  downloadReveal?(path: string): Promise<void>;
  dismissPopups(conversationId: string): Promise<void>;
  setUiTheme(theme: 'light' | 'dark'): Promise<void>;
  getShellInfo(): Promise<unknown>;
  getUpdateState(): Promise<unknown>;
  applyUpdate(): Promise<void>;
  shellReady(): Promise<void>;
  onEvent(type: string, fn: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    nodusDesktop?: NodusDesktopGlobal;
    __nodusDesktopInvoke?: (type: string, payload: unknown) => boolean;
  }
}

export function getDesktopBridge(): NodusDesktopGlobal | null {
  return typeof window !== 'undefined' && window.nodusDesktop ? window.nodusDesktop : null;
}

/** Портал открыт внутри десктоп-оболочки (не в браузере). */
export function isDesktopShell(): boolean {
  return getDesktopBridge() !== null;
}
