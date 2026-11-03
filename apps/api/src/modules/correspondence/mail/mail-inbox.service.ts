import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { CORRESPONDENCE_EVENTS } from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { MAIL_CLIENT, type MailClient } from './mail-client.port.js';
import { MailLetterWriter } from './mail-letter-writer.js';
import { MailSyncLock } from './mail-lock.service.js';
import { MAIL_RECEPTION_CONFIG, type MailReceptionConfig } from './mail-reception.config.js';
import { MailSourcesRepository } from './mail-sources.repository.js';

/** Код ящика (сид миграции #56): один общий ящик до #477. */
export const CHANCERY_SOURCE_CODE = 'chancery';

/** Порог молчания ящика (В4): N неудачных циклов → уведомление. */
const FAILURE_THRESHOLD = 3;
/** Троттлинг уведомления о молчании. */
const NOTIFY_EVERY_MS = 24 * 60 * 60 * 1000;
/** Дебаунс IDLE-exists (Р4): пара секунд между письмами одного захода. */
const IDLE_DEBOUNCE_MS = 2000;
/** Реконнект: 5 с → 30 с → 5 мин (jitter ±20%). */
const RECONNECT_STEPS_MS = [5_000, 30_000, 300_000] as const;
/** Отказ авторизации — НЕ сетевой сбой: пробуем не чаще раза в 15 минут
 *  (правило владельца 28.10: серия неудач включает анти-брутфорс Kerio и
 *  банит весь хост; частые ретраи продлевают бан). */
const AUTH_RETRY_MS = 15 * 60_000;

export interface SyncResult {
  /** Цикл отработал (не «пропущен из-за флага/занятости»). */
  ran: boolean;
  created: number;
  skipped: boolean;
}

/**
 * Цикл приёма почты (#56, Р3/Р4, ADR-0035): armed = флаг `mail-reception` И
 * настроенный IMAP — флаг перепроверяется КАЖДЫЙ цикл (выключили — suspend и
 * разрыв, включили — resume, без рестарта, I10). Мгновенность — IDLE-exists
 * (imapflow сам держит INBOX выбранным) с дебаунсом; фолбэк — Job Scheduler
 * (mail-poll.job) тем же sync (идемпотентен курсором). Смена UIDVALIDITY —
 * полный переобход под дедупом Message-ID; надгробия спама держат удалённое
 * удалённым. Неудачные циклы копятся: ≥3 → `correspondence.mail_sync_failed`
 * (раз в 24 ч), успех сбрасывает счётчик.
 */
@Injectable()
export class MailInboxService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private flagTimer: NodeJS.Timeout | null = null;
  /** Состояние «вооружено» для лога переходов: таймер 30 с не должен спамить. */
  private armedState: boolean | null = null;

  constructor(
    @Inject(MAIL_CLIENT) private readonly client: MailClient,
    private readonly writer: MailLetterWriter,
    private readonly flags: FeatureFlagService,
    @Inject(MAIL_RECEPTION_CONFIG) private readonly config: MailReceptionConfig,
    private readonly sources: MailSourcesRepository,
    private readonly lock: MailSyncLock,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MailInboxService.name);
  }

  onModuleInit(): void {
    this.client.onClose(() => this.scheduleReconnect());
    this.client.onExists(() => {
      // Метка EXISTS — точка отсчёта «сервер почты увидел письмо» для
      // диагностики задержки (владелец 28.10: «45 секунд» — чей это путь).
      this.logger.info({ at: new Date().toISOString() }, 'IMAP: событие EXISTS');
      this.scheduleIdleSync();
    });
    // Флаг перепроверяется циклом; таймер — только поднять соединение, когда
    // рубильник включили (suspend гасит его сам).
    this.flagTimer = setInterval(() => void this.ensureConnection(), 30_000);
    void this.ensureConnection();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const timer of [this.reconnectTimer, this.debounceTimer, this.flagTimer]) {
      if (timer) clearTimeout(timer);
    }
    await this.client.close();
  }

  private async armed(): Promise<boolean> {
    return this.config.imapReady && (await this.flags.isEnabled('mail-reception'));
  }

  /** Поднять соединение, если вооружено; выключили рубильник — suspend. */
  private async ensureConnection(): Promise<void> {
    if (this.stopped || this.running) return;
    if (!(await this.armed())) {
      const wasConnected = this.client.connected;
      this.reportDisarmed();
      if (wasConnected) await this.client.close();
      return;
    }
    this.armedState = true;
    if (!this.client.connected) {
      try {
        await this.client.connect();
        this.reconnectAttempt = 0;
        this.logger.info('IMAP подключён, приём активен');
        this.scheduleIdleSync();
      } catch (error) {
        const authFailed =
          typeof error === 'object' && error !== null && 'authenticationFailed' in error
            ? (error as { authenticationFailed?: boolean }).authenticationFailed === true
            : false;
        if (authFailed) {
          // Не долбим: серия отказов банит весь хост на 15–30 минут (Kerio).
          this.logger.error({ err: error }, 'IMAP: отказ авторизации — проба через 15 минут');
          this.scheduleAuthRetry();
          return;
        }
        this.logger.warn({ err: error }, 'IMAP недоступен');
        this.scheduleReconnect();
      }
    }
  }

  /** Одна строка на переход «вооружён → выключен» (#577): иначе отсутствие
   *  кред в проде выглядит как тишина — ни писем, ни ошибок. */
  private reportDisarmed(): void {
    if (this.armedState === false) return;
    this.armedState = false;
    if (!this.config.imapReady) {
      this.logger.warn(
        'Приём почты выключен: не заданы MAIL_IMAP_HOST/USER/PASSWORD — письма не приходят',
      );
      return;
    }
    this.logger.warn('Приём почты выключен флагом mail-reception — письма не приходят');
  }

  private scheduleIdleSync(): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.sync('idle'), IDLE_DEBOUNCE_MS);
  }

  /** Отказ авторизации: одна проба через 15 минут, без серии повторов. */
  private scheduleAuthRetry(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempt = 0;
    this.reconnectTimer = setTimeout(() => void this.ensureConnection(), AUTH_RETRY_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const step =
      RECONNECT_STEPS_MS[Math.min(this.reconnectAttempt, RECONNECT_STEPS_MS.length - 1)]!;
    const jitter = step * (0.8 + Math.random() * 0.4);
    this.reconnectAttempt += 1;
    this.logger.warn(
      { attempt: this.reconnectAttempt, inMs: Math.round(jitter) },
      'Реконнект IMAP',
    );
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.ensureConnection(), jitter);
  }

  /** Один цикл приёма. Идемпотентен курсором; конкурентные вызовы (IDLE и
   *  фолбэк-опрос) — in-process мьютекс + advisory lock в БД. */
  async sync(trigger: 'idle' | 'poll'): Promise<SyncResult> {
    if (this.running || this.stopped) return { ran: false, created: 0, skipped: true };
    if (!(await this.armed())) {
      await this.ensureConnection();
      return { ran: false, created: 0, skipped: true };
    }
    await this.ensureConnection();
    if (!this.client.connected) return { ran: false, created: 0, skipped: true };

    this.running = true;
    try {
      return await this.runCycle(trigger);
    } finally {
      this.running = false;
    }
  }

  private async runCycle(trigger: 'idle' | 'poll'): Promise<SyncResult> {
    const startedAt = Date.now();
    if (!(await this.lock.tryAcquire())) {
      // Не молчать (код-ревью #56): цикл занят — виден в логе, а не «пусто».
      this.logger.warn({ trigger }, 'Цикл приёма занят (advisory lock) — пропуск');
      return { ran: false, created: 0, skipped: true };
    }
    try {
      const source = await this.sources.ensure(CHANCERY_SOURCE_CODE);
      const status = await this.client.status();
      let lastUid = source.lastUid ?? 0n;

      // Первый запуск: курсор на потолок — старое не импортируем (В5).
      if (source.uidValidity === null) {
        lastUid = await this.client.maxUid();
        await this.sources.initializeCursor(source.id, status.uidValidity, lastUid);
        this.logger.info({ lastUid: lastUid.toString() }, 'Первый запуск: курсор на максимум UID');
        return { ran: true, created: 0, skipped: false };
      }
      // Ящик пересоздан: полный переобход под дедупом (надгробия держат спам).
      if (source.uidValidity !== status.uidValidity) {
        this.logger.warn(
          { from: source.uidValidity.toString(), to: status.uidValidity.toString() },
          'UIDVALIDITY сменился — полный переобход',
        );
        lastUid = 0n;
        await this.sources.resetCursor(source.id, status.uidValidity);
      }

      const uids = await this.client.searchAfter(lastUid);
      const searchedAt = Date.now();
      let created = 0;
      for (const uid of uids) {
        const outcome = await this.writer.write(this.client, uid, async (tx, done) => {
          await this.sources.advanceCursor(tx, source.id, done);
        });
        if (outcome.advance) lastUid = uid;
        if (outcome.created) created += 1;
      }
      await this.sources.recordSuccess(source.id);
      if (created > 0)
        this.logger.info(
          {
            trigger,
            created,
            searchMs: searchedAt - startedAt,
            writeMs: Date.now() - searchedAt,
            totalMs: Date.now() - startedAt,
          },
          'Приняты письма',
        );
      return { ran: true, created, skipped: false };
    } catch (error) {
      await this.recordFailure(error);
      throw error;
    } finally {
      await this.lock.release();
    }
  }

  /** Аккумулятор порога (В4): «нужно уведомлять после нескольких неудачных
   *  попыток» — ≥3 подряд, не чаще раза в 24 ч. */
  private async recordFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const source = await this.sources.recordFailure(CHANCERY_SOURCE_CODE, message);
    const attempts = source.consecutiveFailures;
    this.logger.error({ err: error, attempts }, 'Цикл приёма не удался');
    if (attempts < FAILURE_THRESHOLD) return;
    const quiet =
      !source.lastNotifiedAt || Date.now() - source.lastNotifiedAt.getTime() > NOTIFY_EVERY_MS;
    if (!quiet) return;
    await this.txRunner.run(async (tx) => {
      await tx.mailSource.update({
        where: { id: source.id },
        data: { lastNotifiedAt: new Date() },
      });
      await this.eventBus.emit(
        tx,
        CORRESPONDENCE_EVENTS.MAIL_SYNC_FAILED,
        { sourceId: source.id, sourceCode: source.code, error: message.slice(0, 200), attempts },
        { aggregateType: 'mail_source', aggregateId: source.id },
      );
    });
  }
}
