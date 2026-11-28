import type { ListGroupBucket, ListTotalValue } from '@nodus/contracts';

/**
 * Группировка строк выдачи (#435): сервер считает группы по всей выборке
 * (listGroupBucketSchema) и выдаёт строки отсортированными по полю группировки
 * первыми — клиент только раскладывает загруженные строки по группам и рендерит
 * заголовки. Строка с несовпавшим ключом (рассинхрон сырых выражений) попадает
 * в импровизированную группу — строки не теряются.
 */

export interface RowGroup<T> {
  key: string | number | null;
  bucket?: ListGroupBucket;
  rows: T[];
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ru');
}

/** Строки по группам сервера (его порядок); «лишние» ключи — между ближайшими
 *  по значению группами (строки уже идут по полю группировки). */
export function bucketRows<T>(
  rows: readonly T[],
  buckets: readonly ListGroupBucket[],
  keyOf: (row: T) => string | number | null,
): RowGroup<T>[] {
  const groups: RowGroup<T>[] = buckets.map((bucket) => ({ key: bucket.key, bucket, rows: [] }));
  const byKey = new Map<string | number, RowGroup<T>>();
  let nullGroup: RowGroup<T> | undefined;
  for (const group of groups) {
    if (group.key === null) nullGroup = group;
    else byKey.set(group.key, group);
  }
  const extra: RowGroup<T>[] = [];
  const extraByKey = new Map<string | number, RowGroup<T>>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = key === null ? nullGroup : byKey.get(key);
    if (group) {
      group.rows.push(row);
      continue;
    }
    if (key === null) {
      // Рассинхрон NULL-ключа (сервер не дал такую группу): строки не теряются.
      if (!nullGroup) {
        nullGroup = { key: null, rows: [] };
        groups.push(nullGroup);
      }
      nullGroup.rows.push(row);
      continue;
    }
    let adHoc = extraByKey.get(key);
    if (!adHoc) {
      adHoc = { key, rows: [] };
      extraByKey.set(key, adHoc);
      extra.push(adHoc);
    }
    adHoc.rows.push(row);
  }
  const result: RowGroup<T>[] = [];
  let pending = extra;
  for (const group of groups) {
    const key = group.key;
    if (key === null) {
      result.push(group);
      continue;
    }
    const before = pending.filter((e) => e.key !== null && compareKeys(e.key, key) < 0);
    result.push(...before);
    pending = pending.filter((e) => !before.includes(e));
    result.push(group);
  }
  result.push(...pending);
  return result;
}

/** Формат значения итога — грамматика существующих сумм списков: минуты —
 *  «ч:мм» (подставляет потребитель по типу колонки), прочие числа — как есть,
 *  null — тире. */
export function formatTotalValue(value: ListTotalValue['value']): string {
  if (value === null) return '—';
  return String(value);
}
