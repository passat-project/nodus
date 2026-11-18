import { describe, expect, it, vi } from 'vitest';

import { LettersRepository } from './letters.repository.js';

/** #582: уборка ключа удалённого атрибута из `letters.custom_fields`. */

const FIELD = '58200000-0000-4000-8000-000000000001';

function makeRepo() {
  const prisma = { $executeRaw: vi.fn() };
  const repo = new LettersRepository(prisma as never);
  return { repo, prisma };
}

describe('LettersRepository.removeCustomFieldValues (#582)', () => {
  it('чистит пачками, пока есть строки; возвращает общее число', async () => {
    const { repo, prisma } = makeRepo();
    prisma.$executeRaw.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await repo.removeCustomFieldValues(FIELD)).toBe(3);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('значений нет — один запрос и 0', async () => {
    const { repo, prisma } = makeRepo();
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await repo.removeCustomFieldValues(FIELD)).toBe(0);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('LettersRepository.findIdsBySearch (#956)', () => {
  it('ищет живые письма по номеру/теме, экранирует LIKE-метасимволы', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'letter-1' }]);
    const repo = new LettersRepository({ letter: { findMany } } as never);

    await expect(repo.findIdsBySearch('100%', 200)).resolves.toEqual(['letter-1']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [
            { regNumber: { contains: '100\\%', mode: 'insensitive' } },
            { subject: { contains: '100\\%', mode: 'insensitive' } },
          ],
        },
        take: 200,
      }),
    );
  });
});
