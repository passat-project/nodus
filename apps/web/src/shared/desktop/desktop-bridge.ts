import {
  COPY_TEXT_MAX_CHARS,
  DESKTOP_BRIDGE_EVENTS,
  downloadEntrySchema,
  openConversationEventSchema,
  openLetterEventSchema,
  popupDiagnosticSchema,
  popupPayloadSchema,
  popupReplyEventSchema,
  shellFocusEventSchema,
  shellInfoSchema,
  shellUpdateStateSchema,
  shellVisibilityEventSchema,
  type DownloadEntry,
  type OpenConversationEvent,
  type OpenLetterEvent,
  type PopupReplyEvent,
  type ShellUpdateState,
} from '@nodus/contracts';
import { setShellFocused, setShellVisible } from '../attention/attention-store.js';

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

/**
 * Видимость и фокус оболочки (#770, ADR-0038) живут в единой модели внимания
 * (`shared/attention/attention-store.ts`): скрытие в трей и свёрнутость
 * окна WebView2 может не отражать в `document.hidden`/`hasFocus` — события
 * оболочки корректируют модель. В браузере оба флага остаются true.
 */
export function setShellVisibleFromShell(visible: boolean): void {
  setShellVisible(visible);
}

/** Фокус главного окна оболочки (shell-focus; minimize → false). */
export function setShellFocusedFromShell(focused: boolean): void {
  setShellFocused(focused);
}

/**
 * Доставка попапа: `sent` — оболочка приняла (окно создано или в очереди),
 * `invalid` — payload не прошёл контракт (наша ошибка, не показываем),
 * `unavailable` — моста нет (браузер). Rejection моста (Rust Err) летит
 * вызывающему — это отдельный случай `rejected` в диагностике (#811).
 */
export type DesktopPopupDelivery = 'sent' | 'invalid' | 'unavailable';

/** Показать попап уведомления в оболочке (валидация контракта — на границе). */
export async function desktopShowPopup(payload: unknown): Promise<DesktopPopupDelivery> {
  const bridge = getDesktopBridge();
  if (!bridge) return 'unavailable';
  const parsed = popupPayloadSchema.safeParse(payload);
  if (!parsed.success) return 'invalid';
  await bridge.showPopup(parsed.data);
  return 'sent';
}

/**
 * Записать решение гейта попапа в лог оболочки (#811): панель `?wsdebug=1`
 * живёт в браузере, а попапы — в оболочке, где URL не принимает query.
 * Best-effort: только id/коды, без текста; ошибка моста не влияет на попапы.
 */
export function desktopLogPopupDecision(payload: unknown): void {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  // Установленная оболочка до 1.0.19 команду не знает: веб обновляется
  // раньше оболочки — вызов undefined уронил бы показ попапа. Диагностика
  // best-effort, старый мост молча пропускаем.
  const log = bridge.logPopupDecision;
  if (typeof log !== 'function') return;
  const parsed = popupDiagnosticSchema.safeParse(payload);
  if (!parsed.success) return;
  try {
    void log.call(bridge, parsed.data).catch(() => undefined);
  } catch {
    // закрытый/старый мост — диагностика не критична
  }
}

/** Счётчик непрочитанных: бейдж трея и панели задач (0/null — снять). */ export async function desktopSetUnreadBadge(
  count: number | null,
): Promise<void> {
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
 * Итог команды пути (#558): `done` — оболочка открыла/показала; `unavailable`
 * — браузер или старая оболочка без команды (веб оставляет «Скопировать
 * путь»); `error` — стабильный код отказа Rust (`not_found`,
 * `server_not_allowed`, `reveal_only`, …) для понятного сообщения.
 */
export type DesktopUncPathResult =
  { status: 'done' } | { status: 'unavailable' } | { status: 'error'; code: string };

/** Есть ли в установленной оболочке команды пути (старая — нет). */
export function desktopPathCommandsAvailable(): boolean {
  const bridge = getDesktopBridge();
  return (
    bridge !== null &&
    typeof bridge.openUncPath === 'function' &&
    typeof bridge.revealUncPath === 'function'
  );
}

function uncPathErrorCode(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'unknown';
}

/**
 * Открыть файл с сетевого сервера системным приложением (#558). Список
 * разрешённых папок приходит из «Настроек портала»; Rust независимо
 * проверяет путь и принадлежность списку — мост не доверяет веб-контенту.
 */
export async function desktopOpenUncPath(
  path: string,
  servers: readonly string[],
): Promise<DesktopUncPathResult> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.openUncPath !== 'function') return { status: 'unavailable' };
  try {
    await bridge.openUncPath(path, [...servers]);
    return { status: 'done' };
  } catch (error) {
    return { status: 'error', code: uncPathErrorCode(error) };
  }
}

/** Показать файл в проводнике с выделением (#558). */
export async function desktopRevealUncPath(
  path: string,
  servers: readonly string[],
): Promise<DesktopUncPathResult> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.revealUncPath !== 'function') return { status: 'unavailable' };
  try {
    await bridge.revealUncPath(path, [...servers]);
    return { status: 'done' };
  } catch (error) {
    return { status: 'error', code: uncPathErrorCode(error) };
  }
}

/** Команды безрамочного окна (ADR-0055): опциональные методы моста. */
type WindowCommand =
  'windowMinimize' | 'windowToggleMaximize' | 'windowClose' | 'windowStartDragging';

/**
 * Кнопки окна безрамочной оболочки: огонь-и-забыть — UI-отклика нет, окно
 * меняет состояние само (иконка □/❐ догоняется `desktopWindowIsMaximized`).
 * Установленная с системным заголовком оболочка команд не знает — вызов
 * молча пропускается (как `logPopupDecision`).
 */
function invokeWindowCommand(command: WindowCommand): void {
  const bridge = getDesktopBridge();
  const fn = bridge?.[command];
  if (typeof fn !== 'function') return;
  try {
    void fn.call(bridge).catch(() => undefined);
  } catch {
    // закрытый/старый мост — команда необязательна
  }
}

/** Свернуть окно оболочки. */
export function desktopWindowMinimize(): void {
  invokeWindowCommand('windowMinimize');
}

/** Развернуть/восстановить окно (двойной клик по пустому месту панели). */
export function desktopWindowToggleMaximize(): void {
  invokeWindowCommand('windowToggleMaximize');
}

/** Закрыть окно оболочки. */
export function desktopWindowClose(): void {
  invokeWindowCommand('windowClose');
}

/** Перетащить окно за пустое место панели (pointerdown кнопкой 0). */
export function desktopWindowStartDragging(): void {
  invokeWindowCommand('windowStartDragging');
}

/**
 * Развёрнуто ли окно (иконка □/❐ панели): null — моста нет или оболочка
 * команду не знает (системный заголовок), состояние остаётся прежним.
 */
export async function desktopWindowIsMaximized(): Promise<boolean | null> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.windowIsMaximized !== 'function') return null;
  try {
    return await bridge.windowIsMaximized();
  } catch {
    return null;
  }
}

/**
 * Записать текст в буфер обмена оболочки (адрес страницы панели): лимит
 * `COPY_TEXT_MAX_CHARS` — зеркало Rust copy_text, длинный текст молча
 * не копируется. Ложь — моста/команды нет или текст сверх лимита.
 */
export async function desktopCopyText(text: string): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.copyText !== 'function') return false;
  if (text.length > COPY_TEXT_MAX_CHARS) return false;
  try {
    await bridge.copyText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Реестр загрузок оболочки (эпик #1038): список последних завершённых
 * загрузок (новые первыми) — оболочка помнит его между запусками.
 * null — браузер или старая оболочка без команды реестра; кривой payload
 * (мимо контракта) тоже null — шум за границей приложения не показываем.
 */
export async function desktopDownloadsList(): Promise<DownloadEntry[] | null> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.downloadsList !== 'function') return null;
  try {
    const parsed = downloadEntrySchema.array().safeParse(await bridge.downloadsList());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * «Показать в папке» для записи реестра (#1038): оболочка сама прогоняет
 * путь через гвард каталога «Загрузки». Ложь — браузер, старая оболочка или
 * отказ Rust (путь чужой/файл пропал).
 */
export async function desktopDownloadReveal(path: string): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.downloadReveal !== 'function') return false;
  try {
    await bridge.downloadReveal(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Живые записи реестра загрузок (эпик #1038): подписчики события
 * `download-finished` — панель «Загрузки» монтируется независимо от хоста
 * моста, поэтому фан-аут идёт через реестр слушателей (в отличие от
 * фиксированных обработчиков `bindDesktopShellEvents`). Возврат — отписка.
 */
const downloadsListeners = new Set<(entry: DownloadEntry) => void>();

export function registerDownloadsListener(fn: (entry: DownloadEntry) => void): () => void {
  downloadsListeners.add(fn);
  return () => {
    downloadsListeners.delete(fn);
  };
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
  // Обёртка обязательна: старая оболочка/стаб без onEvent (или чей onEvent
  // вернул не-функцию) не должен ронять cleanup эффектов — «unsubscribe is
  // not a function» сносил каркас целиком (#1038).
  const off = bridge?.onEvent?.(type, (raw) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) fn(parsed.data);
  });
  return typeof off === 'function' ? off : () => undefined;
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
    // Фокус/свёрнутость главного окна (#770): свёрнутое окно WebView2 может
    // оставаться «видимым» и сохранять hasFocus — внимание корректирует
    // оболочка (WindowEvent::Focused + Resized/is_minimized).
    onDesktopEvent(DESKTOP_BRIDGE_EVENTS.shellFocus, shellFocusEventSchema, (payload) =>
      setShellFocused(payload.focused),
    ),
    // Завершение загрузки (эпик #1038): валидная запись — всем подписчикам
    // реестра (registerDownloadsListener), панель «Загрузки» обновляется живьём.
    onDesktopEvent(DESKTOP_BRIDGE_EVENTS.downloadFinished, downloadEntrySchema, (entry) => {
      downloadsListeners.forEach((fn) => fn(entry));
    }),
  ];
  // Оболочка доставляет отложенный deep link только после этого сигнала.
  void getDesktopBridge()?.shellReady();
  return () => unsubs.forEach((u) => u());
}
