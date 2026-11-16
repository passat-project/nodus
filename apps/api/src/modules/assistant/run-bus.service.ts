import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { concat, filter, from, map, mergeMap, type Observable, Subject, tap } from 'rxjs';
import type { AssistantRunEventType } from '@nodus/contracts';

import { AssistantRepository, type EventRow } from './assistant.repository.js';

/** Событие прогона как его видит клиент (SSE `id` = seq). */
export interface RunEvent {
  seq: number;
  type: AssistantRunEventType;
  data: Record<string, unknown>;
  createdAt: string;
}

/** Терминальные события закрывают поток: дальше подписка только читает БД. */
const TERMINAL_EVENTS: ReadonlySet<AssistantRunEventType> = new Set([
  'run.completed',
  'run.error',
  'run.cancelled',
]);

interface Channel {
  subject: Subject<RunEvent>;
  seq: number;
}

/**
 * Рантайм-шина событий прогона (ADR-0043 п. 6): поток в браузер + журнал в БД
 * для восстановления по `Last-Event-ID`.
 *
 * Что ПИШЕТСЯ в БД: вехи (`run.started`, `tool.started/finished`,
 * `message.completed`, `run.completed/error/cancelled`). Дельты текста и
 * размышлений живут только в потоке — иначе тысяча токенов на ответ дала бы
 * тысячу строк в секунду. Потеря дельт при обрыве компенсируется финальным
 * `message.completed` с полным текстом и размышлениями.
 *
 * Нумерация сквозная на прогон: `seq` дельт тоже инкрементирует счётчик,
 * поэтому `id` в потоке монотонен, а выборка `seq > Last-Event-ID` по
 * сохранённым вехам остаётся корректной.
 */
@Injectable()
export class RunBusService {
  private readonly channels = new Map<string, Channel>();

  constructor(
    private readonly repo: AssistantRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RunBusService.name);
  }

  /** Открыть канал прогона (продолжение нумерации — от последнего seq в БД). */
  async open(runId: string): Promise<void> {
    const existing = this.channels.get(runId);
    if (existing) {
      // Ранний подписчик уже создал канал — НЕ заменяем subject, иначе его
      // подписка осиротеет и поток клиента закончится пустым.
      existing.seq = await this.repo.maxEventSeq(runId);
      return;
    }
    const start = await this.repo.maxEventSeq(runId);
    this.channels.set(runId, { subject: new Subject<RunEvent>(), seq: start });
  }

  isLive(runId: string): boolean {
    return this.channels.has(runId);
  }

  /**
   * Опубликовать событие: `persist` — сохранить веху в журнал прогона.
   * Возвращает событие с назначенным seq (для записи в БД ничего не нужно).
   */
  async publish(
    runId: string,
    type: AssistantRunEventType,
    data: Record<string, unknown>,
    options: { persist?: boolean } = {},
  ): Promise<RunEvent> {
    const channel = this.channels.get(runId);
    const seq = channel ? ++channel.seq : (await this.repo.maxEventSeq(runId)) + 1;
    if (channel) channel.seq = seq;
    const event: RunEvent = { seq, type, data, createdAt: new Date().toISOString() };
    if (options.persist !== false) {
      try {
        await this.repo.appendEvent(runId, seq, type, data);
      } catch (error) {
        // Журнал не должен ронять идущий ответ: событие уже уйдёт в поток.
        this.logger.error({ err: error, runId, type }, 'Run event persist failed');
      }
    }
    channel?.subject.next(event);
    if (TERMINAL_EVENTS.has(type)) this.close(runId);
    return event;
  }

  /** Синхронная публикация дельт: без записи в БД и без await в горячем пути. */
  publishDelta(runId: string, type: AssistantRunEventType, text: string): void {
    const channel = this.channels.get(runId);
    if (!channel) return;
    const seq = ++channel.seq;
    channel.subject.next({ seq, type, data: { text }, createdAt: new Date().toISOString() });
  }

  /**
   * Поток прогона: сначала сохранённые события после `lastEventId`, затем
   * живые.
   *
   * Гонка «подписка раньше старта»: клиент получает `runId` и подписывается
   * ДО того, как прогон открыл канал. Для незавершённого прогона канал
   * создаётся здесь — иначе поток закрылся бы пустым, а первые события
   * потерялись бы. Завершённый прогон и канала нет — отдаём журнал и
   * закрываемся (клиент увидит финал).
   */
  stream(runId: string, lastEventId: number, options: { terminal: boolean }): Observable<RunEvent> {
    if (!this.channels.has(runId) && !options.terminal) {
      this.channels.set(runId, { subject: new Subject<RunEvent>(), seq: 0 });
    }
    const channel = this.channels.get(runId);
    let lastReplayed = lastEventId;
    const replay$ = from(this.repo.eventsAfter(runId, lastEventId)).pipe(
      mergeMap((rows) => from(rows)),
      map(toRunEvent),
      tap((event) => {
        lastReplayed = Math.max(lastReplayed, event.seq);
      }),
    );
    if (!channel) return replay$;
    // Нумерация раннего канала начинается с 0 — синхронизируем со счётчиком
    // событий, чтобы seq не повторились и фильтр не отбросил живые.
    channel.seq = Math.max(channel.seq, lastReplayed);
    const live$ = channel.subject.asObservable().pipe(filter((event) => event.seq > lastReplayed));
    return concat(replay$, live$);
  }

  /** Закрыть канал: подписчики получают complete, память освобождается. */
  close(runId: string): void {
    const channel = this.channels.get(runId);
    if (!channel) return;
    this.channels.delete(runId);
    channel.subject.complete();
  }
}

function toRunEvent(row: EventRow): RunEvent {
  return {
    seq: row.seq,
    type: row.type as AssistantRunEventType,
    data: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}
