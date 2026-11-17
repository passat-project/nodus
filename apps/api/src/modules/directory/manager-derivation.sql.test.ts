import { describe, expect, it, vi } from 'vitest';

import { backfillManagerIds } from './manager-derivation.sql.js';

/** Полный бэкфилл (#923): используется сидом после назначения глав отделов —
 *  один параметризованный UPDATE по всем сотрудникам. Семантику CTE проверяет
 *  интеграционный тест и миграция; здесь — форма вызова. */
describe('backfillManagerIds (#923)', () => {
  it('исполняет один UPDATE и возвращает число изменённых строк', async () => {
    const client = {
      $executeRaw: vi.fn<(query: unknown) => Promise<number>>(async () => 3),
    };

    await expect(backfillManagerIds(client as never)).resolves.toBe(3);
    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    const query = client.$executeRaw.mock.calls[0]?.[0] as unknown as { sql?: string };
    expect(query.sql).toContain('UPDATE users');
    expect(query.sql).toContain('manager_id');
  });
});
