import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { encodeCursor } from '../../../core/pagination/cursor.util.js';
import { CounterpartiesQueryService } from './counterparties-query.service.js';

const ID = '00000000-0000-4000-8000-000000000401';
const OTHER = '00000000-0000-4000-8000-000000000402';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    shortName: 'ООО «Тест»',
    fullName: 'Общество с ограниченной ответственностью «Тест»',
    unp: null,
    address: null,
    email: null,
    phone: null,
    customFields: { note: 'x' },
    archivedAt: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-02T10:00:00.000Z'),
    ...overrides,
  };
}

describe('CounterpartiesQueryService (#460)', () => {
  const counterparties = {
    findPage: vi.fn(),
    countsByIds: vi.fn(),
    findById: vi.fn(),
    findSimilar: vi.fn(),
    letterUsages: vi.fn(),
  };
  const contacts = { countActiveByCounterparties: vi.fn(), findByCounterparty: vi.fn() };
  const letters = { visibleLetterIds: vi.fn(async () => new Set<string>()) };
  const viewer = { id: 'u1', permissions: [] as string[] };
  let service: CounterpartiesQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    counterparties.countsByIds.mockResolvedValue(new Map());
    counterparties.letterUsages.mockResolvedValue([]);
    contacts.countActiveByCounterparties.mockResolvedValue(new Map());
    letters.visibleLetterIds.mockResolvedValue(new Set<string>());
    service = new CounterpartiesQueryService(
      counterparties as never,
      contacts as never,
      letters as never,
    );
  });

  describe('list', () => {
    it('лишняя строка → nextCursor по (shortName, id); счётчики собираются пачкой', async () => {
      counterparties.findPage.mockResolvedValue([
        row(),
        row({ id: OTHER, shortName: 'ООО «Тест-2»' }),
      ]);
      counterparties.countsByIds.mockResolvedValue(
        new Map([[ID, { lettersCount: 3, projectsCount: 1 }]]),
      );
      contacts.countActiveByCounterparties.mockResolvedValue(new Map([[ID, 2]]));

      const page = await service.list({ limit: 1, includeArchived: false }, viewer);

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: ID,
        lettersCount: 3,
        projectsCount: 1,
        contactsCount: 2,
        archivedAt: null,
      });
      expect(page.nextCursor).not.toBeNull();
      expect(counterparties.countsByIds).toHaveBeenCalledWith([ID]);
    });

    it('фильтр архива и поиск уходят в репозиторий; курсор декодируется в (shortName, id)', async () => {
      counterparties.findPage.mockResolvedValue([]);
      await service.list(
        {
          limit: 50,
          includeArchived: true,
          search: 'галургия',
          cursor: encodeCursor({ shortName: 'АО «Галургия»', id: ID }),
        },
        viewer,
      );
      expect(counterparties.findPage).toHaveBeenCalledWith(
        { search: 'галургия', includeArchived: true },
        { shortName: 'АО «Галургия»', id: ID },
        50,
      );
    });

    it('битый курсор → VALIDATION_FAILED', async () => {
      await expect(
        service.list(
          { limit: 50, includeArchived: false, cursor: encodeCursor({ id: ID }) },
          viewer,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(counterparties.findPage).not.toHaveBeenCalled();
    });

    it('конфиденциальное письмо вне участия не считается (#461, Р4)', async () => {
      counterparties.findPage.mockResolvedValue([row()]);
      counterparties.countsByIds.mockResolvedValue(
        new Map([[ID, { lettersCount: 2, projectsCount: 0 }]]),
      );
      counterparties.letterUsages.mockResolvedValue([
        { counterpartyId: ID, sourceId: 'letter-visible' },
        { counterpartyId: ID, sourceId: 'letter-secret' },
      ]);
      letters.visibleLetterIds.mockResolvedValue(new Set(['letter-visible']));

      const page = await service.list({ limit: 50, includeArchived: false }, viewer);

      expect(page.items[0]?.lettersCount).toBe(1);
      expect(letters.visibleLetterIds).toHaveBeenCalledWith(
        ['letter-visible', 'letter-secret'],
        viewer,
      );
    });
  });

  describe('card', () => {
    it('нет записи → NOT_FOUND', async () => {
      counterparties.findById.mockResolvedValue(null);
      await expect(service.card(ID, viewer)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('карточка: customFields, ISO-даты, контакты и счётчики', async () => {
      counterparties.findById.mockResolvedValue(
        row({ archivedAt: new Date('2026-10-03T00:00:00Z') }),
      );
      counterparties.countsByIds.mockResolvedValue(
        new Map([[ID, { lettersCount: 0, projectsCount: 2 }]]),
      );
      contacts.findByCounterparty.mockResolvedValue([
        {
          id: OTHER,
          fullName: 'Иванов Иван',
          position: null,
          email: null,
          phone: null,
          archivedAt: null,
        },
      ]);

      const card = await service.card(ID, viewer);

      expect(card).toMatchObject({
        id: ID,
        customFields: { note: 'x' },
        projectsCount: 2,
        archivedAt: '2026-10-03T00:00:00.000Z',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
      });
      expect(card.contactPersons).toHaveLength(1);
    });
  });

  describe('similar', () => {
    it('пустой запрос — без обращения к БД', async () => {
      expect(await service.similar({ name: 'ООО' })).toEqual([]);
      expect(await service.similar({ name: '  ' })).toEqual([]);
      expect(counterparties.findSimilar).not.toHaveBeenCalled();
    });

    it('точный УНП — matchedBy=unp; имя нормализуется, архивный помечен', async () => {
      counterparties.findSimilar.mockResolvedValue([
        {
          id: ID,
          shortName: 'АО «Галургия»',
          fullName: 'Открытое акционерное общество «Галургия»',
          unp: '100123456',
          archivedAt: new Date('2026-10-04T00:00:00Z'),
          unpMatch: true,
          score: 0.7,
        },
        {
          id: OTHER,
          shortName: 'ООО «Галургея»',
          fullName: 'ООО «Галургея»',
          unp: null,
          archivedAt: null,
          unpMatch: false,
          score: 0.6,
        },
      ]);

      const matches = await service.similar({ name: 'АО «Галургея»', unp: '100123456' });

      expect(counterparties.findSimilar).toHaveBeenCalledWith({
        unp: '100123456',
        name: 'галургея',
        threshold: expect.any(Number),
        limit: 5,
      });
      expect(matches.map((m) => m.matchedBy)).toEqual(['unp', 'name']);
      expect(matches[0]).toMatchObject({ archivedAt: '2026-10-04T00:00:00.000Z' });
      expect(matches[1]).toMatchObject({ archivedAt: null });
    });
  });
});
