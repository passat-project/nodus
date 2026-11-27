/**
 * Адрес раздела «Автоматизация», вкладка «Процессы»: ПОВЕРХНОСТЬ рамы (что
 * открыто справа) выбирают четыре ключа поиска — `type` (тип задачи или
 * письма), `ptype` (тип проекта), `ftype` (тип папки), `noproject` («Без
 * проекта»). Чтение и приоритеты — `resolveProcessesSurface` во фиче
 * automation; здесь — единственное правило записи: любой переход на другую
 * поверхность идёт через `replaceProcessesSurface`.
 *
 * Выбор в колонке ЗАМЕНЯЕТ поверхность целиком: из прежнего поиска
 * выбрасываются все четыре ключа, прочие (`tab`, `cards`) остаются, затем
 * накладывается патч. Склеивать патч с прежним адресом нельзя: у `ftype`
 * высший приоритет, и после одного выбора типа папки клики по типам задач,
 * писем и проектов ничего не меняли — папка оставалась выделенной, колонка
 * «заклинивалась» до ухода в другой раздел (вердикт владельца).
 */

/** Ключи поверхности рамы — снимаются вместе при любой её замене. */
const SURFACE_KEYS = ['type', 'ptype', 'ftype', 'noproject'] as const;

type SurfaceKey = (typeof SURFACE_KEYS)[number];

/** Поверхность без ключей прежней: `patch` — новые ключи поверхности (пустой
 *  патч — поверхность по умолчанию) и, если нужно, прочие ключи адреса. */
export function replaceProcessesSurface<S extends object>(
  prev: S,
  patch: Record<string, string | undefined>,
): Omit<S, SurfaceKey> & Record<string, string | undefined> {
  const rest = { ...(prev as Record<string, unknown>) };
  for (const key of SURFACE_KEYS) delete rest[key];
  return { ...(rest as Omit<S, SurfaceKey>), ...patch };
}
