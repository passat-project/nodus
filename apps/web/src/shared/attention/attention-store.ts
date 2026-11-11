/**
 * Единый источник «внимание пользователя» (#770, ADR-0038): один ответ на
 * вопрос «человек действительно смотрит?» для квитанций прочтения, попапов и
 * догона ленты. Раньше каждый гейт собирал своё: планировщик квитанций знал
 * только `document.visibilityState`, оболочка — только скрытие в трей, а
 * попапы — `document.hasFocus()`; WebView2 при minimize/трее может оставлять
 * вкладку «видимой», и ушедший домой пользователь «читал» всю переписку.
 *
 * Три уровня (внешняя сверка — Telegram/Element/Cinny/TalkJS, тело #770):
 *  - `windowAttentive` = вкладка видима + окно в фокусе + оболочка видима и
 *    в фокусе (свёрнута ≠ фокус) — «окно на виду»;
 *  - `userActive` = `windowAttentive` + ввод (клик/клавиша/колесо/движение
 *    мыши) за 30 с — ТОЛЬКО это даёт право ставить «прочитано»;
 *  - `presenceActive` = приложение видимо + ввод за 5 мин (статус «отошёл»,
 *    #772; фокус не обязателен — окно может быть за другим приложением).
 *
 * Возврат фокуса считается активностью (свежий ввод): «вернулся и смотрю» —
 * видимое дочитывается сразу. Потеря внимания — сигнал квитанциям
 * зафиксировать увиденное ДО ухода, а не копить новое в фоне.
 *
 * Стор без React: подписчики — обычные колбэки (переходы `windowAttentive` /
 * `userActive`), события — passive-слушатели. Пороги и событие ввода —
 * константы; UI-строк здесь нет.
 */

/** Окно «пользователь действует»: ввод не старше 30 с. */
export const USER_ACTIVE_WINDOW_MS = 30_000;
/** Окно присутствия («отошёл»): ввод не старше 5 мин (#772). */
export const PRESENCE_ACTIVE_WINDOW_MS = 5 * 60_000;
/** Троттл `pointermove`: движение мыши не чаще раза в секунду. */
export const POINTER_MOVE_THROTTLE_MS = 1_000;

export interface AttentionSnapshot {
  /** Вкладка видима (`document.visibilityState`). */
  visible: boolean;
  /** Окно браузера/оболочки в фокусе (`document.hasFocus()`/focus-blur). */
  focused: boolean;
  /** Оболочка не скрыта в трей (в браузере всегда true). */
  shellVisible: boolean;
  /** Оболочка не свёрнута и главное окно в фокусе (shell-focus). */
  shellFocused: boolean;
  /** Момент последнего замеченного ввода (ms, Date.now). */
  lastInputAt: number;
}

export interface AttentionFlags {
  windowAttentive: boolean;
  userActive: boolean;
  presenceActive: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotified: AttentionFlags;

function initialSnapshot(): AttentionSnapshot {
  if (typeof document === 'undefined') {
    return {
      visible: true,
      focused: false,
      shellVisible: true,
      shellFocused: true,
      lastInputAt: 0,
    };
  }
  const focused = document.hasFocus();
  return {
    visible: document.visibilityState !== 'hidden',
    focused,
    shellVisible: true,
    shellFocused: true,
    // Открытие/возврат в приложение — действие пользователя: окно, которое
    // уже в фокусе в момент старта, считаем активностью (иначе первые 30 с
    // не читались бы вообще).
    lastInputAt: focused ? Date.now() : 0,
  };
}

let state: AttentionSnapshot = initialSnapshot();

/** Текущий снимок внимания (без производных флагов). */
export function getAttention(): AttentionSnapshot {
  return state;
}

/** Производные флаги на момент `now` (Date.now по умолчанию). */
export function attentionFlags(now: number = Date.now()): AttentionFlags {
  const windowAttentive =
    state.visible && state.focused && state.shellVisible && state.shellFocused;
  const activeFor = now - state.lastInputAt;
  return {
    windowAttentive,
    userActive: windowAttentive && activeFor <= USER_ACTIVE_WINDOW_MS,
    presenceActive: state.visible && state.shellVisible && activeFor <= PRESENCE_ACTIVE_WINDOW_MS,
  };
}

/** Окно на виду: вкладка, фокус окна и оболочки, не трей. */
export function isWindowAttentive(now: number = Date.now()): boolean {
  return attentionFlags(now).windowAttentive;
}

/** Право ставить «прочитано»: окно на виду + ввод за последние 30 с. */
export function isUserActive(now: number = Date.now()): boolean {
  return attentionFlags(now).userActive;
}

/** Присутствие («отошёл» — #772): видимо + ввод за 5 мин, фокус не нужен. */
export function isPresenceActive(now: number = Date.now()): boolean {
  return attentionFlags(now).presenceActive;
}

lastNotified = attentionFlags();
// Активность истекает сама по себе — будильник ставится и на холодном старте.
scheduleExpiry();

/** Подписка на переходы `windowAttentive`/`userActive` (не каждый ввод). */
export function subscribeAttention(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function scheduleExpiry(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  // Активность истекает и БЕЗ событий — будильник на границе окна 30 с.
  if (!state.visible || !state.focused || !state.shellVisible || !state.shellFocused) return;
  const remaining = state.lastInputAt + USER_ACTIVE_WINDOW_MS - Date.now();
  if (remaining >= 0) {
    expiryTimer = setTimeout(refresh, remaining + 1);
  }
}

function refresh(): void {
  scheduleExpiry();
  const next = attentionFlags();
  if (
    next.windowAttentive === lastNotified.windowAttentive &&
    next.userActive === lastNotified.userActive
  ) {
    return;
  }
  lastNotified = next;
  for (const fn of [...listeners]) fn();
}

function commit(patch: Partial<AttentionSnapshot>, activity = false): void {
  state = {
    ...state,
    ...patch,
    ...(activity ? { lastInputAt: Date.now() } : {}),
  };
  refresh();
}

/** Видимость/фокус оболочки — от моста (в браузере остаются true). */
export function setShellVisible(visible: boolean): void {
  if (state.shellVisible === visible) return;
  commit({ shellVisible: visible });
}

/** Фокус/свёрнутость главного окна оболочки (событие shell-focus). */
export function setShellFocused(focused: boolean): void {
  if (state.shellFocused === focused) return;
  commit({ shellFocused: focused });
}

function noteInput(): void {
  commit({}, true);
}

let lastPointerMoveAt = 0;

function onPointerMove(): void {
  const now = Date.now();
  if (now - lastPointerMoveAt < POINTER_MOVE_THROTTLE_MS) return;
  lastPointerMoveAt = now;
  noteInput();
}

function onVisibilityChange(): void {
  commit({ visible: document.visibilityState !== 'hidden' });
}

function onFocus(): void {
  // Возврат фокуса = активность: «вернулся и смотрю» дочитывает видимое.
  commit({ focused: true }, true);
}

function onBlur(): void {
  commit({ focused: false });
}

let installed: (() => void) | null = null;

/**
 * Начать слежение за вводом/видимостью (идемпотентно; зовётся хостом
 * приложения при монтировании). Слушатели passive — ничего не отменяют.
 */
export function startAttentionTracking(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  lastPointerMoveAt = 0;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  const options: AddEventListenerOptions = { passive: true };
  const inputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  for (const type of inputEvents) window.addEventListener(type, noteInput, options);
  window.addEventListener('pointermove', onPointerMove, options);
  installed = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    for (const type of inputEvents) window.removeEventListener(type, noteInput);
    window.removeEventListener('pointermove', onPointerMove);
  };
}

/**
 * Сброс состояния (только тесты): детерминированные входные флаги без
 * зависимости от quirks jsdom (hasFocus/visibilityState).
 */
export function resetAttentionForTests(overrides: Partial<AttentionSnapshot> = {}): void {
  if (installed !== null) {
    installed();
    installed = null;
  }
  started = false;
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  listeners.clear();
  lastPointerMoveAt = 0;
  state = {
    visible: true,
    focused: true,
    shellVisible: true,
    shellFocused: true,
    lastInputAt: Date.now(),
    ...overrides,
  };
  lastNotified = attentionFlags();
  scheduleExpiry();
}
