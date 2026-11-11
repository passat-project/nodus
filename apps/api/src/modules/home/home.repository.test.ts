import { describe, expect, it, vi } from 'vitest';

import { HomeRepository } from './home.repository.js';

/**
 * Счёт карточки «Сотрудники» (#723): витрина считает только `status=active` —
 * тем же определением штата, что и раздел «Сотрудники»; деактивированные
 * учётки в число не входят (иначе Главная показывала бы число меньше
 * справочника на количество уволенных).
 */
describe('HomeRepository.countActiveEmployees (#723)', () => {
  it('передаёт в Prisma фильтр status=active и возвращает счёт', async () => {
    const user = { count: vi.fn(async () => 12) };
    const repository = new HomeRepository({ user } as never);

    await expect(repository.countActiveEmployees()).resolves.toBe(12);
    expect(user.count).toHaveBeenCalledWith({ where: { status: 'active' } });
  });
});
