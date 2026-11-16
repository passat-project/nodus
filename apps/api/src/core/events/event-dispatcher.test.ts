import { describe, expect, it, vi } from 'vitest';
import { DIRECTORY_EVENTS, type DomainEvent } from '@nodus/contracts';

import type { PrismaService } from '../database/prisma.service.js';
import { EventDispatcher } from './event-dispatcher.js';

const EVENT = {
  id: 'e1',
  type: 'task.created',
  actorId: null,
  payload: { id: 't1' },
  createdAt: new Date().toISOString(),
} as unknown as DomainEvent;

class TestHandler {
  static readonly eventType = 'task.created';
  handle = vi.fn().mockResolvedValue(undefined);
}

class SecondHandler {
  static readonly eventType = 'task.created';
  handle = vi.fn().mockResolvedValue(undefined);
}

class ThirdHandler {
  static readonly eventType = 'task.created';
  handle = vi.fn().mockResolvedValue(undefined);
}

class DeactivatedHandler {
  static readonly eventType = DIRECTORY_EVENTS.USER_DEACTIVATED;
  handle = vi.fn().mockResolvedValue(undefined);
}

class RoleAccessHandler {
  static readonly eventType = DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED;
  handle = vi.fn().mockResolvedValue(undefined);
}

class UserUpdatedHandler {
  static readonly eventType = DIRECTORY_EVENTS.USER_UPDATED;
  handle = vi.fn().mockResolvedValue(undefined);
}

function createPrisma(options: { delivered?: Set<string>; events?: () => DomainEvent[] } = {}) {
  const delivered = options.delivered ?? new Set<string>();
  return {
    event: {
      findMany: vi
        .fn()
        .mockImplementation(async () => (options.events ? options.events() : [EVENT])),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventDelivery: {
      findUnique: vi
        .fn()
        .mockImplementation(async ({ where }) =>
          delivered.has(where.eventId_handler.handler) ? { id: 1 } : null,
        ),
      createMany: vi.fn().mockImplementation(async ({ data }) => {
        for (const row of data) delivered.add(row.handler);
        return { count: 1 };
      }),
    },
  };
}

function createDispatcher(
  handlers: object[],
  prisma = createPrisma(),
): {
  dispatcher: EventDispatcher;
  prisma: ReturnType<typeof createPrisma>;
  logger: {
    setContext: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
} {
  const discovery = { getProviders: () => handlers.map((instance) => ({ instance })) };
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const dispatcher = new EventDispatcher(
    prisma as unknown as PrismaService,
    discovery as never,
    logger as never,
  );
  dispatcher.onModuleInit();
  dispatcher.onModuleDestroy();
  return { dispatcher, prisma, logger };
}

describe('EventDispatcher', () => {
  it('доставляет событие подписанному обработчику и помечает published', async () => {
    const handler = new TestHandler();
    const { dispatcher, prisma } = createDispatcher([handler]);
    await dispatcher.dispatchPending();
    expect(handler.handle).toHaveBeenCalledWith(EVENT);
    expect(prisma.eventDelivery.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'e1', handler: 'TestHandler' }],
      skipDuplicates: true,
    });
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', publishedAt: null },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('выборка — по seq, детерминированно', async () => {
    const { dispatcher, prisma } = createDispatcher([new TestHandler()]);
    await dispatcher.dispatchPending();
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publishedAt: null }, orderBy: { seq: 'asc' } }),
    );
  });

  it('дедупликация: уже доставленное обработчику событие не вызывает его повторно', async () => {
    const handler = new TestHandler();
    const { dispatcher } = createDispatcher(
      [handler],
      createPrisma({ delivered: new Set(['TestHandler']) }),
    );
    await dispatcher.dispatchPending();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('ошибка обработчика → событие остаётся неопубликованным (повтор позже)', async () => {
    const handler = new TestHandler();
    handler.handle.mockRejectedValue(new Error('boom'));
    const { dispatcher, prisma, logger } = createDispatcher([handler]);
    await dispatcher.dispatchPending();
    expect(prisma.event.updateMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('прогресс по обработчику: успешный сосед не перевызывается при падении другого', async () => {
    const ok = new TestHandler();
    const failing = new SecondHandler();
    failing.handle.mockRejectedValueOnce(new Error('boom'));
    const { dispatcher, prisma } = createDispatcher([ok, failing]);

    await dispatcher.dispatchPending(); // ok доставлен, failing упал
    await dispatcher.dispatchPending(); // повтор: только failing

    expect(ok.handle).toHaveBeenCalledTimes(1);
    expect(failing.handle).toHaveBeenCalledTimes(2);
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1);
  });

  it('упорно падающее событие уходит в бэкофф и исключается из выборки', async () => {
    const handler = new TestHandler();
    handler.handle.mockRejectedValue(new Error('poison'));
    const { dispatcher, prisma } = createDispatcher([handler]);

    await dispatcher.dispatchPending(); // попытка 1 — без задержки
    await dispatcher.dispatchPending(); // попытка 2 — без задержки
    await dispatcher.dispatchPending(); // попытка 3 → бэкофф
    expect(handler.handle).toHaveBeenCalledTimes(3);

    await dispatcher.dispatchPending(); // событие в бэкоффе — исключено из выборки
    expect(prisma.event.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { publishedAt: null, id: { notIn: ['e1'] } } }),
    );
  });

  it('FK-ошибка доставки (строку события удалили конкурентно) — тихий скип', async () => {
    const handler = new TestHandler();
    const prisma = createPrisma();
    prisma.eventDelivery.createMany.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }),
    );
    const { dispatcher, logger } = createDispatcher([handler], prisma);
    await dispatcher.dispatchPending();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('конкурентный вызов ДОЖИДАЕТСЯ in-flight прохода и делает свой (не no-op)', async () => {
    // Фоновый тик диспетчера держит проход (медленный хендлер #212),
    // тестовый dispatchPending приходит поверх — обязан дождаться и
    // увидеть результат, а не вернуться «пустым» до записи хендлера.
    const handler = new TestHandler();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    handler.handle.mockImplementation(async () => {
      await gate;
    });
    let findManyCalls = 0;
    const prisma = createPrisma({
      events: () => {
        findManyCalls += 1;
        return findManyCalls === 1 ? [EVENT] : [];
      },
    });
    const { dispatcher } = createDispatcher([handler], prisma);

    const background = dispatcher.dispatchPending(); // «тикер» начал проход
    await vi.waitFor(() => expect(handler.handle).toHaveBeenCalled()); // проход внутри хендла
    const foreground = dispatcher.dispatchPending(); // тестовый вызов поверх
    release(); // хендлер фонового прохода отпущен
    await Promise.all([background, foreground]);

    // Свой проход после чужого — на старом булевом гварде foreground был
    // no-op (findManyCalls остался бы 1) — именно та гонка CI.
    expect(findManyCalls).toBe(2);
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', publishedAt: null },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it.each<[string, number]>([
    ['первым', 0],
    ['в середине', 1],
    ['последним', 2],
  ])('AUD-012: падающий обработчик %s не блокирует остальных', async (_position, failIndex) => {
    const handlers = [new TestHandler(), new SecondHandler(), new ThirdHandler()];
    const failing = handlers[failIndex]!;
    failing.handle.mockRejectedValueOnce(new Error('boom'));
    const { dispatcher, prisma } = createDispatcher(handlers);

    await dispatcher.dispatchPending(); // сбой упавшего + доставка всем остальным
    expect(handlers.map((h) => h.handle.mock.calls.length)).toEqual([1, 1, 1]);
    expect(prisma.event.updateMany).not.toHaveBeenCalled();

    await dispatcher.dispatchPending(); // повтор только упавшего — событие published
    expect(failing.handle).toHaveBeenCalledTimes(2);
    expect(handlers.map((h) => h.handle.mock.calls.length)).toEqual(
      handlers.map((_, index) => (index === failIndex ? 2 : 1)),
    );
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1);
  });

  it('AUD-012: после потолка попыток обработчик снимается с повторов, событие публикуется', async () => {
    const handler = new TestHandler();
    handler.handle.mockRejectedValue(new Error('poison'));
    const { dispatcher, prisma, logger } = createDispatcher([handler]);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await dispatcher.dispatchPending();
    }

    expect(handler.handle).toHaveBeenCalledTimes(8);
    expect(prisma.eventDelivery.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'e1', handler: 'TestHandler' }],
      skipDuplicates: true,
    });
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e1', handler: 'TestHandler' }),
      expect.stringContaining('poison'),
    );

    await dispatcher.dispatchPending(); // дедуп: снятый обработчик не зовётся
    expect(handler.handle).toHaveBeenCalledTimes(8);
  });

  it.each<[string, () => { handle: ReturnType<typeof vi.fn> }]>([
    ['directory.user.deactivated', () => new DeactivatedHandler()],
    ['directory.role.access_changed', () => new RoleAccessHandler()],
    ['directory.user.updated', () => new UserUpdatedHandler()],
  ])('AUD-002: отзыв доступа %s не снимается с повторов после потолка', async (type, make) => {
    const handler = make();
    handler.handle.mockRejectedValue(new Error('redis down'));
    const events = [{ ...EVENT, id: 'e2', type }];
    const { dispatcher, prisma } = createDispatcher(
      [handler],
      createPrisma({ events: () => events }),
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await dispatcher.dispatchPending();
    }

    // Отзыв прав не теряется молча: доставка НЕ фиксируется, событие остаётся
    // в повторах (бэкофф до 5 минут изолирует его от головы батча).
    expect(handler.handle).toHaveBeenCalledTimes(8);
    expect(prisma.eventDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.event.updateMany).not.toHaveBeenCalled();

    await dispatcher.dispatchPending();
    expect(handler.handle).toHaveBeenCalledTimes(9);
  });
});
