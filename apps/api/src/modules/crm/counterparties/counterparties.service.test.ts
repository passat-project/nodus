import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_EVENTS, ErrorCode } from '@nodus/contracts';

import { CounterpartiesService } from './counterparties.service.js';

const ACTOR = {
  id: 'actor',
  email: 'actor@example.test',
  displayName: 'Тест Тест',
  permissions: [] as string[],
};
const ID = '00000000-0000-4000-8000-000000000101';
const OTHER = '00000000-0000-4000-8000-000000000102';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    shortName: 'ООО «Тест»',
    fullName: 'Общество с ограниченной ответственностью «Тест»',
    unp: '100123456',
    address: null,
    email: null,
    phone: null,
    customFields: {},
    archivedAt: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('CounterpartiesService (#460)', () => {
  const repo = {
    findById: vi.fn(),
    findByUnp: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setArchivedAt: vi.fn(),
    hasUsages: vi.fn(),
    deleteWithContacts: vi.fn(),
  };
  const queries = { buildCard: vi.fn() };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn() };
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() };
  let service: CounterpartiesService;

  beforeEach(() => {
    vi.clearAllMocks();
    queries.buildCard.mockImplementation(async (r: unknown) => ({ card: r }));
    service = new CounterpartiesService(
      repo as never,
      queries as never,
      txRunner as never,
      eventBus as never,
      logger as never,
    );
  });

  describe('create', () => {
    it('занятый УНП → CRM_UNP_TAKEN с details (в т.ч. для архивного), без вставки', async () => {
      repo.findByUnp.mockResolvedValue(row({ id: OTHER, archivedAt: new Date() }));
      await expect(
        service.create({ fullName: 'Тест', shortName: 'Тест', unp: '100123456' }, ACTOR),
      ).rejects.toMatchObject({
        code: ErrorCode.CRM_UNP_TAKEN,
        details: { counterpartyId: OTHER, shortName: 'ООО «Тест»', archived: true },
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('создание: tx + событие crm.counterparty_created с aggregateId', async () => {
      repo.findByUnp.mockResolvedValue(null);
      repo.create.mockResolvedValue(row());

      await service.create({ fullName: 'Тест', shortName: 'Тест', unp: '100 123 456' }, ACTOR);

      expect(repo.create).toHaveBeenCalledWith(
        {
          shortName: 'Тест',
          fullName: 'Тест',
          unp: '100 123 456',
          address: null,
          email: null,
          phone: null,
        },
        {},
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        CRM_EVENTS.COUNTERPARTY_CREATED,
        { counterpartyId: ID, shortName: 'ООО «Тест»', unp: '100123456' },
        { actorId: 'actor', aggregateType: 'counterparty', aggregateId: ID },
      );
    });

    it('гонка по УНП (P2002) → тот же CRM_UNP_TAKEN после отката транзакции', async () => {
      repo.findByUnp.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ id: OTHER }));
      repo.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(
        service.create({ fullName: 'Тест', shortName: 'Тест', unp: '100123456' }, ACTOR),
      ).rejects.toMatchObject({
        code: ErrorCode.CRM_UNP_TAKEN,
        details: { counterpartyId: OTHER },
      });
    });
  });

  describe('update', () => {
    it('нет записи → NOT_FOUND; архивная → CRM_COUNTERPARTY_ARCHIVED', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(service.update(ID, { phone: '1' }, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });

      repo.findById.mockResolvedValueOnce(row({ archivedAt: new Date() }));
      await expect(service.update(ID, { phone: '1' }, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CRM_COUNTERPARTY_ARCHIVED,
      });
    });

    it('правка без фактических изменений — карточка без события и записи', async () => {
      repo.findById.mockResolvedValue(row());

      await service.update(ID, { shortName: 'ООО «Тест»' }, ACTOR);

      expect(repo.update).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('правка: в событие уходят только реально изменённые поля', async () => {
      repo.findById.mockResolvedValue(row());
      repo.update.mockResolvedValue(row({ phone: '+375 17 200-11-22' }));

      await service.update(ID, { phone: '+375 17 200-11-22', shortName: 'ООО «Тест»' }, ACTOR);

      expect(repo.update).toHaveBeenCalledWith(ID, { phone: '+375 17 200-11-22' }, {});
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        CRM_EVENTS.COUNTERPARTY_UPDATED,
        { counterpartyId: ID, fields: ['phone'] },
        { actorId: 'actor', aggregateType: 'counterparty', aggregateId: ID },
      );
    });

    it('УНП занят другим контрагентом → CRM_UNP_TAKEN; свой же УНП — не конфликт', async () => {
      repo.findById.mockResolvedValue(row());
      repo.findByUnp.mockResolvedValue(row({ id: OTHER }));
      await expect(service.update(ID, { unp: '190654321' }, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CRM_UNP_TAKEN,
      });

      repo.findByUnp.mockResolvedValue(row({ id: ID }));
      repo.update.mockResolvedValue(row());
      await service.update(ID, { unp: '100123456' }, ACTOR);
      expect(repo.update).not.toHaveBeenCalled(); // значение не изменилось
    });
  });

  describe('удаление (вердикт владельца 25.10.2026)', () => {
    it('нет записи → NOT_FOUND; есть связи → CRM_COUNTERPARTY_IN_USE, удаления нет', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(service.remove(ID, 'actor')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });

      repo.findById.mockResolvedValueOnce(row());
      repo.hasUsages.mockResolvedValueOnce(true);
      await expect(service.remove(ID, 'actor')).rejects.toMatchObject({
        code: ErrorCode.CRM_COUNTERPARTY_IN_USE,
      });
      expect(repo.deleteWithContacts).not.toHaveBeenCalled();
    });

    it('без связей — физическое удаление в транзакции + событие', async () => {
      repo.findById.mockResolvedValue(row());
      repo.hasUsages.mockResolvedValue(false);
      await service.remove(ID, 'actor');
      expect(repo.deleteWithContacts).toHaveBeenCalledWith(ID, {});
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        CRM_EVENTS.COUNTERPARTY_DELETED,
        { counterpartyId: ID, shortName: 'ООО «Тест»' },
        { actorId: 'actor', aggregateType: 'counterparty', aggregateId: ID },
      );
    });
  });

  describe('архив и возврат', () => {
    it('идемпотентно: уже в нужном состоянии — без записи и события', async () => {
      repo.findById.mockResolvedValue(row({ archivedAt: new Date() }));
      await service.setArchived(ID, true, ACTOR);
      expect(repo.setArchivedAt).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('архив ставит метку времени и эмитит crm.counterparty_archived', async () => {
      repo.findById.mockResolvedValue(row());
      repo.setArchivedAt.mockResolvedValue(row({ archivedAt: new Date() }));

      await service.setArchived(ID, true, ACTOR);

      expect(repo.setArchivedAt).toHaveBeenCalledWith(ID, expect.any(Date), {});
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        CRM_EVENTS.COUNTERPARTY_ARCHIVED,
        { counterpartyId: ID },
        { actorId: 'actor', aggregateType: 'counterparty', aggregateId: ID },
      );
    });

    it('возврат снимает метку и эмитит crm.counterparty_restored', async () => {
      repo.findById.mockResolvedValue(row({ archivedAt: new Date() }));
      repo.setArchivedAt.mockResolvedValue(row());

      await service.setArchived(ID, false, ACTOR);

      expect(repo.setArchivedAt).toHaveBeenCalledWith(ID, null, {});
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        CRM_EVENTS.COUNTERPARTY_RESTORED,
        { counterpartyId: ID },
        { actorId: 'actor', aggregateType: 'counterparty', aggregateId: ID },
      );
    });
  });
});
