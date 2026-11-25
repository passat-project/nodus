import { downloadEntrySchema, type DownloadEntry } from '@nodus/contracts';

import { getDesktopBridge } from './desktop-bridge-global.js';

/**
 * Файлы и пути через мост: UNC-команды файлового сервера (#558) и реестр
 * загрузок оболочки (эпик #1038). Секция вынесена из desktop-bridge (лимит
 * строк, I5); фан-аут живых записей — здесь, мост дёргает его из
 * `bindDesktopShellEvents`.
 */

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

/** Валидная запись `download-finished` — всем подписчикам реестра. */
export function notifyDownloadFinished(entry: DownloadEntry): void {
  downloadsListeners.forEach((fn) => fn(entry));
}
