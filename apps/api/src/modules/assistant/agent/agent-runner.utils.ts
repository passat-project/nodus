/**
 * Мелкие помощники агентного цикла (#893, #899): паузы повтора провайдера,
 * причина сокетного сбоя, аргументы вызова, обрезка превью и учёт токенов.
 * Вынесены из `agent-runner.service.ts`, чтобы цикл оставался одной связной
 * машиной состояний и не упирался в лимит I5.
 */

/** Паузы перед повтором провайдера: две попытки после первой (всего три). */
export const PROVIDER_RETRY_DELAYS_MS: readonly number[] = [400, 1200];

/** Причина сокетного сбоя строкой для лога: pino не сериализует `cause`. */
export function describeCause(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof Error)) return undefined;
  const code = (cause as NodeJS.ErrnoException).code;
  return code ? `${code}: ${cause.message}` : cause.message;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted/i.test(error.message))
  );
}

export function addTokens(current: number | null, delta: number | null): number | null {
  if (delta === null) return current;
  return (current ?? 0) + delta;
}

/** Аргументы вызова: строку JSON от модели разбираем молча (мусор → пусто). */
export function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/** Краткий результат для карточки в ленте (полный текст — только модели).
 * Переводы строк СОХРАНЯЮТСЯ: свёрнутая строка вызова вывода не показывает
 * вовсе, а раскрытая показывает список построчно, а не одной простынёй.
 */
export function clipPreview(text: string): string {
  const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  const clipped = lines.slice(0, 12).join('\n').trim();
  return clipped.length > 600 ? `${clipped.slice(0, 600).trimEnd()}…` : clipped;
}
