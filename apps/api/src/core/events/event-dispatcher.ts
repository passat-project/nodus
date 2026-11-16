import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import type { DomainEvent, DomainEventHandler } from '@nodus/contracts';

import { PrismaService } from '../database/prisma.service.js';

/** Размер батча и период опроса outbox. */
const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 1_000;

/** Бэкофф упорно падающего события: первые попытки — каждый опрос (сбой
 *  обычно транзиентный: блокировка, рестарт Redis), затем экспонента до
 *  потолка. Событие НЕ выбрасывается — повтор идёт, пока не отработают все
 *  обработчики, но не забивает голову батча и не спамит лог каждую секунду
 *  (ядовитое FK-событие #267). */
const FREE_RETRIES = 2;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** С этой попытки упавший обработчик снимается с повторов этого события:
 *  error-запись с id события и именем обработчика — сигнал оператору, а
 *  доставка фиксируется в `event_deliveries`, чтобы событие завершилось. */
const POISON_ATTEMPTS = 8;

type HandlerInstance = DomainEventHandler & { constructor: { eventType?: string; name: string } };

interface RetryState {
  attempts: number;
  retryAt: number;
}

/**
 * Диспетчер outbox: поллер читает неопубликованные события из `events`
 * и вызывает подписанные обработчики (регистрация при bootstrap по
 * `static readonly eventType`, декораторы подписки запрещены — patterns.md).
 *
 * Доставка at-least-once, прогресс — ПО ОБРАБОТЧИКУ: успешный обработчик
 * сразу фиксирует доставку в `event_deliveries` (event_id, handler), и при
 * падении соседа не перевызывается; событие помечается published, когда все
 * обработчики отметились. Ошибка одного обработчика не прерывает цикл —
 * остальные получают событие в том же проходе (AUD-012), а упавший
 * повторяется бэкоффом один; после `POISON_ATTEMPTS` он снимается с
 * повторов (error-запись с id события и именем обработчика), и событие
 * завершается. Обработчик исполняется ВНЕ транзакции диспетчера:
 * у него свои транзакции (TransactionRunner), а обёртка лишь держала бы
 * второе соединение пула и убивала медленный обработчик tx-таймаутом.
 * Обработчик обязан быть идемпотентным (крэш между его коммитом и записью
 * доставки → повторный вызов).
 *
 * Порядок выборки — `seq` (глобальная последовательность БД, парциальный
 * индекс `events_dispatch_pending_idx`). Событие с неотработанным
 * обработчиком уходит в бэкофф (in-memory, сбрасывается рестартом) и
 * исключается из выборки, чтобы пачка ядовитых событий не заблокировала
 * голову очереди для остальных.
 *
 * Монолит single-process (I1): конкуренции поллеров нет, SKIP LOCKED не нужен.
 * При выносе диспетчера в отдельный воркер — добавить claim через
 * `FOR UPDATE SKIP LOCKED` (см. README core).
 */
@Injectable()
export class EventDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<string, HandlerInstance[]>();
  private readonly retries = new Map<string, RetryState>();
  private timer: NodeJS.Timeout | null = null;
  /** In-flight проход диспетчеризации (null — прохода нет). Параллельный вызов
   *  ЖДЁТ чужой проход и делает свой — а не молча уходит no-op'ом:
   *  ручной прогон конвейера поверх фонового тикера читал «пусто» до
   *  записи хендлеров (гонка интеграционных CI, #212). */
  private pass: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EventDispatcher.name);
  }

  onModuleInit(): void {
    this.registerHandlers();
    this.timer = setInterval(() => {
      // Фоновый тик при живом проходе — пропуск, не очередь (медленный
      // обработчик не копит ожидающие тики); ждёт только ручной вход.
      if (!this.pass) void this.dispatchPending();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Регистрация обработчиков: провайдеры со `static readonly eventType`. */
  private registerHandlers(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as HandlerInstance | undefined;
      const eventType = instance?.constructor?.eventType;
      if (instance && typeof eventType === 'string' && typeof instance.handle === 'function') {
        const list = this.handlers.get(eventType) ?? [];
        list.push(instance);
        this.handlers.set(eventType, list);
      }
    }
  }

  /** Один проход диспетчеризации (также используется интеграционными
   *  тестами). Проходы не накладываются, но конкурентный вызов ДОЖИДАЕТСЯ
   *  чужого прохода и стартует свой — вызов никогда не «пустой». */
  async dispatchPending(): Promise<void> {
    while (this.pass) {
      await this.pass.catch(() => {}); // чужой проход упал — свой всё равно стартует
    }
    this.pass = this.runPass();
    try {
      await this.pass;
    } finally {
      this.pass = null;
    }
  }

  private async runPass(): Promise<void> {
    const deferred = this.deferredIds(Date.now());
    const pending = await this.prisma.event.findMany({
      where: { publishedAt: null, ...(deferred.length > 0 ? { id: { notIn: deferred } } : {}) },
      // Детерминированный порядок (I7): глобальная последовательность БД.
      orderBy: { seq: 'asc' },
      take: BATCH_SIZE,
    });
    for (const row of pending) {
      await this.dispatchOne(row as unknown as DomainEvent);
    }
  }

  /** Id событий, чей бэкофф ещё не истёк (исключаются из выборки). */
  private deferredIds(now: number): string[] {
    const ids: string[] = [];
    for (const [id, state] of this.retries) {
      if (state.retryAt > now) ids.push(id);
    }
    return ids;
  }

  private async dispatchOne(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    const attempts = (this.retries.get(event.id)?.attempts ?? 0) + 1;
    let retryNeeded = false;

    for (const handler of handlers) {
      const handlerId = handler.constructor.name;
      try {
        await this.deliver(event, handler);
      } catch (error) {
        if ((error as { code?: string }).code === 'P2003') {
          // Строка события удалена конкурентно — FK доставки не на что
          // ссылаться: повторять нечего, пропускаем тихо.
          this.logger.debug(
            { eventId: event.id, type: event.type, handler: handlerId },
            'Event row deleted concurrently, skip dispatch',
          );
          this.retries.delete(event.id);
          return;
        }
        if (attempts < POISON_ATTEMPTS) {
          retryNeeded = true;
          this.logger.error(
            { eventId: event.id, type: event.type, handler: handlerId, attempts, err: error },
            'Event handler failed, will retry',
          );
          continue;
        }
        // Потолок попыток (AUD-012): упавший обработчик снимается с повторов
        // этого события, остальные уже отработали или повторятся сами.
        if (!(await this.settlePoisoned(event, handlerId, attempts, error))) {
          retryNeeded = true;
        }
      }
    }

    if (retryNeeded) {
      this.scheduleRetry(event, attempts);
      return;
    }
    // updateMany: строку события могли удалить конкурентно (очистка
    // тестов/retention) — тогда помечать нечего, это не ошибка.
    await this.prisma.event.updateMany({
      where: { id: event.id, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    this.retries.delete(event.id);
  }

  /** Доставка одному обработчику с дедупом по (event_id, handler). */
  private async deliver(event: DomainEvent, handler: HandlerInstance): Promise<void> {
    const handlerId = handler.constructor.name;
    const delivered = await this.prisma.eventDelivery.findUnique({
      where: { eventId_handler: { eventId: event.id, handler: handlerId } },
    });
    if (delivered) {
      return; // дедуп по event id (patterns.md)
    }
    await handler.handle(event);
    await this.prisma.eventDelivery.createMany({
      data: [{ eventId: event.id, handler: handlerId }],
      skipDuplicates: true,
    });
  }

  /** Потолок попыток обработчика (AUD-012): error-запись для разбора и
   *  фиксация доставки в `event_deliveries` — дедуп больше не позовёт этот
   *  обработчик, а событие сможет стать published (отдельной dead-letter-
   *  таблицы нет — разбор по логу и паре event_id–handler в доставках).
   *  false — фиксацию не удалось записать, событие повторим. */
  private async settlePoisoned(
    event: DomainEvent,
    handlerId: string,
    attempts: number,
    error: unknown,
  ): Promise<boolean> {
    this.logger.error(
      { eventId: event.id, type: event.type, handler: handlerId, attempts, err: error },
      'Event handler keeps failing (poison), giving up for this handler',
    );
    try {
      await this.prisma.eventDelivery.createMany({
        data: [{ eventId: event.id, handler: handlerId }],
        skipDuplicates: true,
      });
      return true;
    } catch (settleError) {
      // Строку события удалили конкурентно — фиксировать нечего.
      if ((settleError as { code?: string }).code === 'P2003') return true;
      this.logger.error(
        { eventId: event.id, type: event.type, handler: handlerId, err: settleError },
        'Failed to settle poisoned handler, will retry',
      );
      return false;
    }
  }

  /** Событие остаётся неопубликованным — повтор позже (с бэкоффом). */
  private scheduleRetry(event: DomainEvent, attempts: number): void {
    const delay =
      attempts <= FREE_RETRIES
        ? 0
        : Math.min(BACKOFF_BASE_MS * 2 ** (attempts - FREE_RETRIES - 1), BACKOFF_MAX_MS);
    this.retries.set(event.id, { attempts, retryAt: Date.now() + delay });
  }
}
