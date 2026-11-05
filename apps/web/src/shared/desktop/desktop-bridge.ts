import {
  DESKTOP_BRIDGE_EVENTS,
  openConversationEventSchema,
  openLetterEventSchema,
  popupPayloadSchema,
  popupReplyEventSchema,
  shellInfoSchema,
  shellUpdateStateSchema,
  shellVisibilityEventSchema,
  type OpenConversationEvent,
  type OpenLetterEvent,
  type PopupReplyEvent,
  type ShellUpdateState,
} from '@nodus/contracts';
import { flushOnShellHidden } from './shell-hidden.js';

/**
 * Мост «портал ↔ десктоп-оболочка» (ADR-0019): веб-приложение при наличии
 * `window.nodusDesktop` (инъекция оболочки) командует дисплеем — попапы,
 * бейдж непрочитанных, мигание таскбара. Логика уведомлений (правила M8,
 * непрочитанные, фокус беседы) живёт ЗДЕСЬ, в веб-приложении; оболочка не
 * хранит токены — команды несут только данные для показа. Обратное
 * направление — события `__nodusDesktopInvoke` (eval из Rust).
 */

/** Сигнатура инъекции оболочки (инициализационный скрипт bridge.rs). */
interface NodusDesktopGlobal {
  readonly shellVersion: string;
  readonly platform: string;
  showPopup(payload: unknown): Promise<void>;
  setUnreadBadge(count: number | null): Promise<void>;
  flashTaskbar(critical: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
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

/**
 * Видимость оболочки: окно спрятано в трей → портал должен вести себя как
 * фоновая вкладка (WebView2 может не менять document.hidden при hide).
 * Дефолт true — в браузере портал всегда «видим», гейты остаются штатными.
 */
let shellVisible = true;
const visibilityListeners = new Set<(visible: boolean) => void>();

export function getShellVisible(): boolean {
  return shellVisible;
}

function setShellVisible(visible: boolean): void {
  if (shellVisible === visible) return;
  shellVisible = visible;
  for (const fn of visibilityListeners) fn(visible);
}

export function onShellVisibility(fn: (visible: boolean) => void): () => void {
  visibilityListeners.add(fn);
  return () => visibilityListeners.delete(fn);
}

/** Портал считается «фоновым» для гейтов уведомлений (браузер или трей). */
export function isPortalBackground(): boolean {
  return document.hidden || !shellVisible;
}

/** Показать попап уведомления в оболочке (валидация контракта — на границе). */
export async function desktopShowPopup(payload: unknown): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  const parsed = popupPayloadSchema.safeParse(payload);
  if (!parsed.success) return;
  await bridge.showPopup(parsed.data);
}

/** Счётчик непрочитанных: бейдж трея и панели задач (0/null — снять). */
export async function desktopSetUnreadBadge(count: number | null): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.setUnreadBadge(count);
}

/** Мигание значка на панели задач (важное — критичный режим до фокуса). */
export async function desktopFlashTaskbar(critical: boolean): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.flashTaskbar(critical);
}

/** Внешняя ссылка — в системный браузер (гвард навигации оболочки). */
export async function desktopOpenExternal(url: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.openExternal(url);
}

/**
 * Погасить попапы беседы: хост чата зовёт при открытии беседы (модель
 * Telegram unlinkHistory — открыл чат, его уведомления больше не висят).
 */
export async function desktopDismissPopups(conversationId: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.dismissPopups(conversationId);
}

/**
 * Тема приложения для попапов оболочки: попап-мини-UI не знает выбора
 * пользователя — шлём при старте и каждой смене (фидбек владельца 08.10:
 * «тема попапов зависит от темы приложения, не Windows»).
 */
export async function desktopSetUiTheme(theme: 'light' | 'dark'): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.setUiTheme(theme);
}

/** Диагностика: версия и платформа оболочки. */
export async function getShellInfo(): Promise<{ version: string; platform: string } | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  const parsed = shellInfoSchema.safeParse(await bridge.getShellInfo());
  return parsed.success ? parsed.data : null;
}

/**
 * Состояние автообновления оболочки (пассивный поток #263): null вне оболочки.
 */
export async function getShellUpdateState(): Promise<ShellUpdateState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  const parsed = shellUpdateStateSchema.safeParse(await bridge.getUpdateState());
  return parsed.success ? parsed.data : null;
}

/**
 * Применить скачанное обновление: passive-установка и перезапуск оболочки
 * (процесс завершает установщик, он же возвращает приложение). Ложь — обновле-
 * ния нет или мост недоступен.
 */
export async function desktopApplyUpdate(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  try {
    await bridge.applyUpdate();
    return true;
  } catch {
    return false;
  }
}

/** Установка видимости оболочки (событие bridge; тесты — напрямую). */
export function setShellVisibleFromShell(visible: boolean): void {
  setShellVisible(visible);
  // Сокрытие в трей: WebView2 не меняет document.hidden — квитанции
  // просмотров чата дозаписываем немедленно, иначе хвост непрочитанного
  // оставался «зомби-бейджем» до следующей активности (фидбек 08.10).
  if (!visible) {
    flushOnShellHidden();
  }
}

/**
 * Подписка на события оболочки с zod-фильтром по контракту: слушатель зовётся
 * только для валидного payload'а (кривой формат = шум за границей приложения).
 */
export function onDesktopEvent<T>(
  type: (typeof DESKTOP_BRIDGE_EVENTS)[keyof typeof DESKTOP_BRIDGE_EVENTS],
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  fn: (payload: T) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge) return () => undefined;
  return bridge.onEvent(type, (raw) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) fn(parsed.data);
  });
}

/**
 * Регистрация слушателей моста «оболочка → веб» и сигнал готовности:
 * оболочка доставляет отложенный deep link только после shellReady.
 * Вызывается хостом (app-shell) после монтирования всех слушателей.
 */
export function bindDesktopShellEvents(handlers: {
  onPopupReply: (payload: PopupReplyEvent) => void;
  onOpenConversation: (payload: OpenConversationEvent) => void;
  onOpenLetter: (payload: OpenLetterEvent) => void;
}): () => void {
  const unsubs = [
    onDesktopEvent(DESKTOP_BRIDGE_EVENTS.popupReply, popupReplyEventSchema, handlers.onPopupReply),
    onDesktopEvent(
      DESKTOP_BRIDGE_EVENTS.openConversation,
      openConversationEventSchema,
      handlers.onOpenConversation,
    ),
    // Клик по попапу «Поступило письмо» (#618) — карточка письма.
    onDesktopEvent(DESKTOP_BRIDGE_EVENTS.openLetter, openLetterEventSchema, handlers.onOpenLetter),
    // Скрытие в трей: WebView2 может не трогать document.hidden — сигнал
    // оболочки переключает портал в «фон» для гейтов уведомлений.
    onDesktopEvent(DESKTOP_BRIDGE_EVENTS.shellVisibility, shellVisibilityEventSchema, (payload) =>
      setShellVisible(payload.visible),
    ),
  ];
  // Оболочка доставляет отложенный deep link только после этого сигнала.
  void getDesktopBridge()?.shellReady();
  return () => unsubs.forEach((u) => u());
}
