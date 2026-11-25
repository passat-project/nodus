import { COPY_TEXT_MAX_CHARS } from '@nodus/contracts';

import { getDesktopBridge } from './desktop-bridge-global.js';

/**
 * Команды безрамочного окна (ADR-0055, эпик #1038) и буфер обмена: секция
 * вынесена из desktop-bridge (лимит строк, I5) — одна ответственность,
 * единый огонь-и-забыть-профиль опциональных методов.
 */

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
