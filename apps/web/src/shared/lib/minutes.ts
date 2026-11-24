/**
 * Ввод длительности в деловой форме (учёт времени, плановое время, #311):
 * «1ч 30м», «1 ч», «45м», «1:30», «1.5»/«1,5» (часы), «90» (минуты — голое
 * целое больше 12 — минуты, до 12 включительно — часы: «2» = 2 часа, как в
 * Битрикс24/Jira «2h»). null — не распознано, ноль или больше предела.
 */

/** Предел планового времени, минут — тот же, что в серверных схемах задачи
 *  и окна перехода (`task.schemas.ts`, `transition-form.schemas.ts`): клиент
 *  не должен отправлять значение, которое сервер отклонит (#1009). */
export const MAX_PLANNED_MINUTES = 100_000;

export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(',', '.');
  if (!text) return null;

  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (clock) return positive(Number(clock[1]) * 60 + Number(clock[2]));

  const units =
    /^(?:(\d+(?:\.\d+)?)\s*(?:ч|h|час|часа|часов))?\s*(?:(\d+)\s*(?:м|m|мин|минут|минуты))?$/.exec(
      text,
    );
  if (units && (units[1] || units[2])) {
    return positive(Math.round(Number(units[1] ?? 0) * 60) + Number(units[2] ?? 0));
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    return positive(Number.isInteger(n) && n > 12 ? n : Math.round(n * 60));
  }
  return null;
}

function positive(minutes: number): number | null {
  return Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_PLANNED_MINUTES ? minutes : null;
}

/** «1 ч 30 м» / «45 м» / «2 ч» — для подписей (таблицы — formatMinutes «1:30»). */
export function formatDuration(minutes: number, h: string, m: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${m}`;
  return rest === 0 ? `${hours} ${h}` : `${hours} ${h} ${rest} ${m}`;
}
