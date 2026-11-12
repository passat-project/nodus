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

export interface ChatEventsConsumerOptions {
  /** Имя consumer group (по умолчанию nodus:gateway); тесты подставляют своё. */
  group?: string;
}

function logError(scope: string, error: unknown): void {
  // TODO(core): структурное логирование (pino) — issue #2/#3.
  console.error(`[gateway] ${scope}:`, error);
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
    try {
      await this.redis.xgroup('CREATE', DOMAIN_EVENTS_STREAM, this.group, '$', 'MKSTREAM');
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) {
        throw error;
      }
    }
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
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
      logError('stream maintenance', error);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
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
        if (!result) {
          continue; // BLOCK истёк без записей
        }
        const entries = result[0]?.[1] ?? [];
        for (const [id, fields] of entries) {
          await this.processEntry(id, fields);
        }
      } catch (error) {
        if (!this.running) {
          return;
        }
        logError('stream consumer', error);
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
      reason: 'missing' | 'json' | 'schema';
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
  return { kind: 'envelope', envelope: parsed.data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
