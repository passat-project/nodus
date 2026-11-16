import type { Server } from 'socket.io';
import type { Redis } from 'ioredis';
import {
  DOMAIN_EVENTS_STREAM,
  realtimeEnvelopeSchema,
  type RealtimeEnvelope,
} from '@nodus/contracts';

import type { MembershipStore } from './membership.ts';
import { routeEnvelope } from './route-envelope.ts';
import {
  pruneOrphanConsumers,
  reclaimIdlePending,
  type StreamRecoveryOptions,
} from './stream-recovery.ts';

/** Consumer group gateway в стриме событий чата. */
const CONSUMER_GROUP = 'nodus:gateway';
const CONSUMER_BATCH = 100;
const CONSUMER_BLOCK_MS = 5_000;
const RETRY_DELAY_MS = 1_000;
/** Период обслуживания группы: перехват брошенных pending + GC сирот. */
const MAINTENANCE_INTERVAL_MS = 30_000;
/** Pending без ACK дольше минуты — брошен (живая обработка записи — миллисекунды). */
const RECLAIM_MIN_IDLE_MS = 60_000;
/** Consumer без pending и без попыток чтения 10 минут — сирота (живой BLOCK-reader — секунды). */
const ORPHAN_IDLE_MS = 10 * 60_000;
/** Порог деградации для `/health` (AUD-021): чтение потока не удаётся дольше
 *  него — 503. Согласован с healthcheck gateway в docker-compose.yml
 *  (interval 10s × retries 5 + start_period 10s): 503 успевает перевести
 *  контейнер в unhealthy, а краткий сбой Redis короче порога рестарта не даёт. */
const UNHEALTHY_READ_MS = 30_000;

export interface ChatEventsConsumerOptions {
  /** Имя consumer group (по умолчанию nodus:gateway); тесты подставляют своё. */
  group?: string;
}

function logError(scope: string, error: unknown): void {
  // TODO(core): структурное логирование (pino) — issue #2/#3.
  console.error(`[gateway] ${scope}:`, error);
}

/** NOGROUP — группа/стрим чтения исчезли (Redis-ошибка XREADGROUP). */
function isNoGroupError(error: unknown): boolean {
  return /NOGROUP/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Консьюмер Redis Stream доменных событий (`DOMAIN_EVENTS_STREAM` =
 * `nodus:domain:events`, несёт ВСЕ события outbox): consumer group читает только
 * новые записи (`$` на старте — историю в стриме не ретранслируем: клиенты
 * ресинхронизируются рефечем), каждая запись эмитится в комнаты и XACK-ается.
 * Порядок seq может нарушаться поздними коммитами в api — безопасно:
 * клиент применяет события только как сигнал к рефечу.
 * Обслуживание группы (при старте и раз в 30 с, между чтениями — на том же
 * соединении нельзя параллельно: команды встали бы за XREADGROUP BLOCK,
 * gotcha Realtime): перехват брошенных pending (XAUTOCLAIM, idle > 60 с —
 * падение между XREADGROUP и XACK больше не теряет события) и GC
 * consumer'ов-сирот без pending (`stream-recovery.ts`).
 */
export class ChatEventsConsumer {
  private readonly redis: Redis;
  private readonly io: Server;
  private readonly store: MembershipStore;
  private readonly group: string;
  private readonly consumerName: string;
  private running = false;
  private lastMaintenanceAt = 0;
  /** Момент первого неудачного чтения подряд (AUD-021): null — чтение живо. */
  private failingSince: number | null = null;

  constructor(
    redis: Redis,
    io: Server,
    store: MembershipStore,
    options: ChatEventsConsumerOptions = {},
  ) {
    this.redis = redis;
    this.io = io;
    this.store = store;
    this.group = options.group ?? CONSUMER_GROUP;
    this.consumerName = `gateway-${process.pid}`;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    await this.ensureGroup();
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  /**
   * Здоровье доставки для `/health` (AUD-021, #866): 503, когда нет соединения
   * с Redis или чтение потока не удаётся дольше порога. Успешное чтение
   * (включая пустой BLOCK-таймаут) сбрасывает счётчик — после восстановления
   * health снова 200 без перезапуска.
   */
  isHealthy(now = Date.now()): boolean {
    if (this.redis.status !== 'ready') return false;
    return this.failingSince === null || now - this.failingSince < UNHEALTHY_READ_MS;
  }

  /** Создание группы идемпотентно: BUSYGROUP — другой consumer уже создал. */
  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', DOMAIN_EVENTS_STREAM, this.group, '$', 'MKSTREAM');
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  /**
   * Пересоздание потерянной группы чтения (NOGROUP: потеря тома Redis, ручной
   * сброс, восстановление из копии) — без него gateway навсегда молчал бы при
   * зелёном health. Позиция «новые»: события за время простоя в realtime не
   * доставляются, клиент догонит рефечем при переподключении (осознанно,
   * AUD-021). Сбой пересоздания логируется — health уйдёт в 503 по порогу.
   */
  private async recreateGroup(): Promise<void> {
    console.warn(`[gateway] consumer group ${this.group} lost (NOGROUP) — recreating`);
    try {
      await this.ensureGroup();
    } catch (error) {
      logError('group recreate', error);
    }
  }

  /**
   * Обслуживание группы: брошенные pending → штатная обработка (эмит + XACK),
   * затем GC сирот. Сбой обслуживания не останавливает живое чтение.
   */
  async runMaintenance(): Promise<void> {
    this.lastMaintenanceAt = Date.now();
    const options: StreamRecoveryOptions = {
      stream: DOMAIN_EVENTS_STREAM,
      group: this.group,
      consumer: this.consumerName,
      minIdleMs: RECLAIM_MIN_IDLE_MS,
      orphanIdleMs: ORPHAN_IDLE_MS,
      batch: CONSUMER_BATCH,
    };
    try {
      const reclaimed = await reclaimIdlePending(this.redis, options, (id, fields) =>
        this.processEntry(id, fields),
      );
      if (reclaimed > 0) {
        console.warn(`[gateway] reclaimed ${reclaimed} abandoned stream entries`);
      }
      const removed = await pruneOrphanConsumers(this.redis, options);
      if (removed.length > 0) {
        console.warn(`[gateway] orphan consumers removed: ${removed.join(', ')}`);
      }
    } catch (error) {
      if (isNoGroupError(error)) {
        // Группа исчезла — обслуживание без неё бессмысленно, пересоздаём.
        await this.recreateGroup();
      } else {
        logError('stream maintenance', error);
      }
    }
  }

  /**
   * Один цикл чтения: обслуживание группы по таймеру + пачка XREADGROUP.
   * true — чтение состоялось (включая пустой BLOCK), false — сбой (цикл
   * повторит после паузы). Публичен ради unit-теста восстановления группы
   * (AUD-021); в проде вызывается только из loop.
   */
  async pollOnce(): Promise<boolean> {
    if (Date.now() - this.lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
      await this.runMaintenance();
    }
    try {
      const result = (await this.redis.xreadgroup(
        'GROUP',
        this.group,
        this.consumerName,
        'COUNT',
        CONSUMER_BATCH,
        'BLOCK',
        CONSUMER_BLOCK_MS,
        'STREAMS',
        DOMAIN_EVENTS_STREAM,
        '>',
      )) as [string, [string, string[]][]][] | null;
      this.failingSince = null;
      if (!result) {
        return true; // BLOCK истёк без записей
      }
      const entries = result[0]?.[1] ?? [];
      for (const [id, fields] of entries) {
        await this.processEntry(id, fields);
      }
      return true;
    } catch (error) {
      if (isNoGroupError(error)) {
        // Потеря группы лечится сама: пересоздаём и продолжаем доставку.
        await this.recreateGroup();
      } else {
        logError('stream consumer', error);
      }
      // Дата первого сбоя подряд — для порога /health; успешное чтение сбросит.
      this.failingSince ??= Date.now();
      return false;
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const ok = await this.pollOnce();
      if (!ok) {
        if (!this.running) {
          return;
        }
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  private async processEntry(id: string, fields: string[]): Promise<void> {
    const entry = parseStreamEntry(fields);
    if (entry.kind === 'poison') {
      // Битый/неконтрактный envelope: ретрай не поможет, группу не блокируем.
      console.warn(
        `[gateway] poison stream entry skipped: entry=${id} reason=${entry.reason}` +
          ` type=${entry.eventType ?? '-'} conversation=${entry.conversationId ?? '-'}`,
      );
      await this.redis.xack(DOMAIN_EVENTS_STREAM, this.group, id);
      return;
    }
    try {
      await routeEnvelope(this.io, this.store, entry.envelope);
    } catch (error) {
      // Инфраструктурный сбой (membership/Postgres, Redis, исключение
      // маршрутизации) — НЕ ACK (#810): запись остаётся в PEL, maintenance
      // (XAUTOCLAIM, idle > 60 с) перехватит её и доставит после
      // восстановления. Эффекты идемпотентны: клиент дедуплицирует
      // message_sent по message.id, инвалидации кэшей идемпотентны.
      console.warn(
        `[gateway] delivery deferred (infrastructure), entry=${id}` +
          ` type=${entry.envelope.type} payload=${envelopeConversationId(entry.envelope.payload)}` +
          ` reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    await this.redis.xack(DOMAIN_EVENTS_STREAM, this.group, id);
  }
}

/** conversationId из payload (только для лога; payload — unknown). */
function envelopeConversationId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '-';
  const value = (payload as Record<string, unknown>).conversationId;
  return typeof value === 'string' ? value : '-';
}

type StreamEntry =
  | { kind: 'envelope'; envelope: RealtimeEnvelope }
  | {
      kind: 'poison';
      reason: 'missing' | 'json' | 'schema' | 'payload';
      eventType: string | null;
      conversationId: string | null;
    };

/** Разбор записи стрима: контрактный envelope или poison (без ретраев). */
function parseStreamEntry(fields: string[]): StreamEntry {
  const index = fields.indexOf('envelope');
  const raw = index >= 0 ? fields[index + 1] : undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { kind: 'poison', reason: 'missing', eventType: null, conversationId: null };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'poison', reason: 'json', eventType: null, conversationId: null };
  }
  const parsed = realtimeEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    const record =
      typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
    const payload =
      typeof record.payload === 'object' && record.payload !== null
        ? (record.payload as Record<string, unknown>)
        : {};
    return {
      kind: 'poison',
      reason: 'schema',
      eventType: typeof record.type === 'string' ? record.type : null,
      conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : null,
    };
  }
  // `payload: z.unknown()` пропускает скаляры/null, но маршрутизация читает
  // поля объекта (`'audience' in payload` → TypeError) — детерминированный
  // сбой, ретрай не поможет: poison, а не «инфраструктура» (#810-ревью).
  if (typeof parsed.data.payload !== 'object' || parsed.data.payload === null) {
    return {
      kind: 'poison',
      reason: 'payload',
      eventType: parsed.data.type,
      conversationId: null,
    };
  }
  return { kind: 'envelope', envelope: parsed.data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
