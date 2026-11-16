/**
 * Чистая логика разрешения персонального порядка (концепт #4): два слоя —
 * системный дефолт реестра ← личный; действует личный, если задан.
 * Общий скоуп компании локально не применяется (AUD-032: переключателя
 * «для всех» нет, серверного хранения общих настроек ещё нет). Слияние без
 * миграций: из сохранённого порядка берутся только известные коду id, новые
 * id (появились в реестре после сохранения) дописываются в конец в системном
 * порядке.
 */

/** Порядок id: личный ?? системный; неизвестные отбрасываются,
 *  новые — в конец в системном порядке. */
export function resolveOrder(systemIds: string[], personal?: string[]): string[] {
  const stored = personal?.length ? personal : undefined;
  if (!stored) return systemIds;
  const known = stored.filter((id) => systemIds.includes(id));
  const fresh = systemIds.filter((id) => !known.includes(id));
  return [...known, ...fresh];
}

/** Скрытые id: только личные; отбрасываются неизвестные коду. */
export function resolveHidden(systemIds: string[], personal?: string[]): string[] {
  if (!personal) return [];
  return personal.filter((id) => systemIds.includes(id));
}
