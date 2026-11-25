import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { Prisma } from '../../generated/prisma/client.js';
import { DOMAIN_EVENTS_STREAM, type RealtimeEnvelope } from '@nodus/contracts';

import { PrismaService } from '../database/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/** Период опроса outbox: бюджет p95 доставки <200 мс (НФТ #104); раунд 2 —
 * 50 мс (вдвое лучше бюджет доставки «commit → браузер», владелец видел
 * задержки; приборная правда была <200 мс, но запас не лишний). */
const POLL_INTERVAL_MS = 50;
/** Страница чтения: 500 сообщ/мин пик — с запасом на пачки правок/прочтений. */
const BATCH_LIMIT = 200;
/** Хвост стрима: история в стриме не нужна (клиент ресинхронизируется рефечем). */
const STREAM_MAXLEN = 100_000;

interface PendingEventRow {
  id: string;
  seq: bigint;
  type: string;
  payload: unknown;
  createdAt: Date;
  /** Автор действия (`events.actor_id`); null — системное событие. */
  actorId: string | null;
}

/**
 * Издатель realtime-фанута (#104, #100): читает хвост outbox `events` со ВСЕМИ
 * доменными событиями (фильтр `chat.%` снят #100 — модуль notifications
 * расходует тот же конвейер; gateway неизвестные ему типы игнорирует) и
 * публикует их в Redis Stream `nodus:domain:events` (consumer — WS-gateway).
 * Это отдельный лёгкий поллер, а не EventDispatcher: тот доставляет события
 * внутрибоксовым обработчикам (1 с), здесь бюджет — <200 мс до браузера.
 *
 * Курсор — множество строк с `fanout_at IS NULL`, а НЕ `seq > checkpoint`:
 * seq выделяется последовательностью БД ВНУТРИ незакоммиченной транзакции,
 * поэтому событие, закоммиченное позже соседа с большим seq, seq-курсор
 * перепрыгивает навсегда («отправил, а не пришло» без следов в логах —
 * аудит #123). Метка `fanout_at` ставится ПОСЛЕ успешного XADD: поздно
 * закоммиченное событие подберётся следующим тиком, а нормальные идут с
 * бюджетом 50 мс. Порядок выдачи — по seq; инверсию порядка приёма клиент
 * ловит «дырой» seq и откатывается к рефечу (ws-apply).
 *
 * Гарантии: at-least-once (крэш между XADD и меткой → повторная публикация
 * батча; дубли для gateway безвредны). Bootstrap: история до max(seq)
 * помечается опубликованной разом — в стрим льётся только живой хвост;
 * закоммиченное «в щель» bootstrap-а событие метки не получает и доедет.
 */
@Injectable()
export class RedisStreamPublisher implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** In-flight проход публикации (null — прохода нет). Параллельный вызов
   *  ЖДЁТ чужой проход и делает свой, а не уходит молча no-op'ом: ручной
   *  прогон поверх фонового тикера читал «пусто» до записи свежих событий —
   *  тот же класс гонки, что у диспетчера (#212), флейк интеграционных CI
   *  (#358). */
  private pass: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RedisStreamPublisher.name);
  }

  async onModuleInit(): Promise<void> {
    const marked = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE events SET fanout_at = now()
                 WHERE fanout_at IS NULL AND seq <= (SELECT max(seq) FROM events)`,
    );
    this.logger.info({ marked }, 'fanout bootstrap: history marked published');
    this.timer = setInterval(() => {
      // Фоновый тик при живом проходе — пропуск, не очередь: иначе при
      // зависшем Redis (offline-очередь ioredis) копились бы тысячи
      // ожидающих тиков. Ждёт чужой проход только ручной вход (тесты).
      if (!this.pass) void this.publishPending();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Один проход публикации (также используется интеграционными тестами).
   *  Проходы не накладываются, но конкурентный вызов ДОЖИДАЕТСЯ чужого прохода
   *  и стартует свой — вызов никогда не «пустой». */
  async publishPending(): Promise<void> {
    while (this.pass) {
      await this.pass;
    }
    this.pass = this.runPass();
    try {
      await this.pass;
    } finally {
      this.pass = null;
    }
  }

  private async runPass(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<PendingEventRow[]>(
        Prisma.sql`SELECT id, seq, type, payload, created_at AS "createdAt", actor_id AS "actorId"
                   FROM events
                   WHERE fanout_at IS NULL
                   ORDER BY seq ASC
                   LIMIT ${BATCH_LIMIT}`,
      );
      if (rows.length === 0) {
        return;
      }
      const pipeline = this.redis.multi();
      for (const row of rows) {
        const envelope: RealtimeEnvelope = {
          type: row.type,
          payload: row.payload,
          seq: Number(row.seq),
          ts: row.createdAt.toISOString(),
          ...(row.actorId ? { actorId: row.actorId } : {}),
        };
        pipeline.xadd(
          DOMAIN_EVENTS_STREAM,
          'MAXLEN',
          '~',
          STREAM_MAXLEN,
          '*',
          'envelope',
          JSON.stringify(envelope),
        );
      }
      const results = await pipeline.exec();
      const failed = results?.findIndex(([err]) => err !== null) ?? -1;
      if (failed >= 0) {
        // Метки не ставим: батч повторится целиком (дубликаты отстреляют
        // в gateway как лишние инвалидации — безвредно).
        throw results![failed]![0];
      }
      const ids = rows.map((row) => row.id);
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE events SET fanout_at = now()
                   WHERE id = ANY(${ids}::uuid[]) AND fanout_at IS NULL`,
      );
    } catch (error) {
      this.logger.error({ err: error }, 'chat fanout publish failed, will retry');
    }
  }
}
