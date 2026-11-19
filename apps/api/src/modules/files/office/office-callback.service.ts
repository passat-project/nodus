import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ErrorCode, FILE_EVENTS, type FileVersionCreatedPayload } from '@nodus/contracts';

/** Потолок скачивания собранной копии из кэша DS (#182): с избытком покрывает
 * офисные документы (лимит загрузки вложений — 100 МБ), защищает память api. */
const SAVE_DOWNLOAD_CAP_BYTES = 128 * 1024 * 1024;

import { AuditRepository } from '../../../core/audit/audit.repository.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { FilesRepository } from '../files.repository.js';
import { DerivativesQueue } from '../derivatives/derivatives.queue.js';
import { MinioStorageDriver } from '../storage/minio-storage.driver.js';
import { OFFICE_CONFIG, type OfficeConfig } from './office.config.js';
import { OfficeSessionsStore } from './office-sessions.store.js';
import { registeredEditorsCheck } from './office-save-guard.js';
import { OfficeTokenService } from './office-token.service.js';
import { parseHttpUrl } from './office-url.js';

/** Тело колбэка документ-сервера (протокол DS, не наш контракт):
 *  api.onlyoffice.com/docs/docs-api/usage-api/callback-handler/. */
export interface OfficeCallbackBody {
  status: number;
  key: string;
  url?: string;
  filetype?: string;
  users?: string[];
  actions?: { type: number; userid: string }[];
  lastsave?: string;
  forcesavetype?: number;
  notmodified?: boolean;
  /** JWT в теле (при JWT_IN_BODY у DS); обычно токен приходит в заголовке. */
  token?: string;
}

/**
 * Обработка колбэков сохранений ONLYOFFICE (#138): статус 2 (закрытие с
 * изменениями) и 6 (forcesave) скачивают собранный файл и создают новую
 * FileVersion (+ указатель file_objects + событие outbox + аудит, одной
 * транзакцией). Дедуп: повторная доставка того же сохранения (тот же
 * document key + lastsave) не плодит версии.
 */
@Injectable()
export class OfficeCallbackService {
  constructor(
    private readonly repository: FilesRepository,
    private readonly driver: MinioStorageDriver,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly audit: AuditRepository,
    private readonly tokens: OfficeTokenService,
    private readonly derivativesQueue: DerivativesQueue,
    @Inject(OFFICE_CONFIG) private readonly config: OfficeConfig,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    private readonly sessions: OfficeSessionsStore,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfficeCallbackService.name);
  }

  /**
   * Проверка подписи отправителя колбэка: DS подписывает исходящие запросы
   * как { payload: <тело> } секретом движка — Bearer в заголовке (JWT_IN_BODY
   * выключен), body.token — резерв. Сверка payload.key === body.key привязывает
   * токен к документу. 401 иначе (api.onlyoffice.com/docs/docs-api/
   * additional-api/signature/request/).
   */
  async verifySender(body: OfficeCallbackBody, authorization: string | undefined): Promise<void> {
    const bearer = authorization?.replace(/^Bearer\s+/i, '');
    const decoded = await this.tokens.verify(bearer ?? body.token);
    const inner = decoded?.payload as { key?: string } | undefined;
    if (!decoded || !inner || inner.key !== body.key) {
      throw DomainException.unauthenticated('Document server token is invalid');
    }
  }

  async handle(fileId: string, body: OfficeCallbackBody): Promise<void> {
    // Наблюдаемость колбэков (репро #182): причина каждого «молчаливого»
    // выхода обязана быть видна в логе — иначе диагноз только по DS.
    if (body.status === 2 || body.status === 6) {
      this.logger.info(
        {
          fileId,
          status: body.status,
          key: body.key,
          hasUrl: Boolean(body.url),
          lastsave: body.lastsave ?? null,
          notmodified: body.notmodified ?? null,
          forcesavetype: body.forcesavetype ?? null,
          filetype: body.filetype ?? null,
        },
        'Office save callback received',
      );
    }
    // 1/4 — открытие редактора, 4 — закрытие без изменений, 3/7 — ошибки DS:
    // подтверждаем, версии не касаются (DS повторяет, пока не получит {error:0}).
    if (body.status !== 2 && body.status !== 6) return;
    // 2 без url после forcesave — изменений с прошлого сохранения нет.
    if (!body.url) {
      this.logger.info({ fileId, status: body.status }, 'Office callback without url, skipped');
      return;
    }

    const file = await this.repository.findById(fileId);
    if (!file) {
      this.logger.warn({ fileId, key: body.key }, 'Office callback for missing file');
      return;
    }
    // Вторая линия после drop (#356): если в документ правили только
    // уволенные — версию не создаём (см. office-save-guard.ts).
    const check = await registeredEditorsCheck(this.sessions, this.userProfiles, body.key);
    if (check.kind === 'unavailable') {
      this.logger.warn(
        { fileId, key: body.key, err: check.error },
        'Office save: session registry unavailable, editor status check skipped',
      );
    }
    if (check.kind === 'ok' && check.allDeactivated) {
      this.logger.warn(
        { fileId, key: body.key, users: check.editors },
        'Office save rejected: all registered editors are deactivated',
      );
      await this.audit.append({
        actorId: null,
        action: 'files.office_save_rejected',
        entityType: 'file',
        entityId: file.id,
        details: { key: body.key, reason: 'editors_deactivated', editors: check.editors },
      });
      return;
    }
    const versions = await this.repository.findVersions(file.id);
    const latest = versions[0];

    // Сессия DS живёт под документ-ключом. После forcesave DS продолжает
    // редактирование под ТЕМ ЖЕ ключом, хотя текущая версия уже ушла вперёд:
    // принимаем колбэки ключа текущей версии И ключа, породившего её.
    const currentKey = `${file.id}.v${file.version}`;
    const continuesLatest = latest?.sourceKey === body.key;
    if (body.key !== currentKey && !continuesLatest) {
      this.logger.info(
        { fileId, key: body.key, current: file.version },
        'Office callback for outdated document key',
      );
      return;
    }

    const incomingLastsave = this.toLastsaveMs(body.lastsave);
    const storedLastsave = latest?.sourceLastsave ?? null;
    if (
      latest?.sourceKey === body.key &&
      incomingLastsave !== null &&
      storedLastsave === incomingLastsave
    ) {
      this.logger.info({ fileId, key: body.key }, 'Office callback deduplicated (same lastsave)');
      return; // повторная доставка того же сохранения (forcesave → закрытие)
    }

    const nextVersion = file.version + 1;
    // Идемпотентность приёмника (I7): lastsave-дедуп выше не покрывает ретраи
    // DS без lastsave. Быстрая проверка до скачивания; авторитетный дедуп и
    // номер версии считаются в транзакции под замком строки файла (AUD-015).
    const existing = await this.repository.findVersion(file.id, nextVersion);
    if (existing?.sourceKey === body.key) {
      this.logger.info(
        { fileId: file.id, version: nextVersion },
        'Office save already stored (unique-key dedup)',
      );
      return;
    }
    // Ключ уникален для ПОПЫТКИ (AUD-015, #866): два параллельных колбэка
    // больше не пишут один объект — у каждой версии свой объект, содержимое
    // всегда соответствует строке. Номер в ключе — снимок до замка;
    // авторитетный номер версии вычисляется в транзакции (хранение в
    // file_versions.key — читатели берут ключ строки, не шаблон).
    const key = `files/${file.id}/v${nextVersion}-${randomUUID()}`;
    const { bytes } = await this.downloadTo(body.url, key, file.mime, file.name);

    // Загрузка объекта остаётся ВНЕ транзакции (замок строки не держим на
    // время скачивания). Непривязанный объект снимается компенсацией.
    let savedVersion: number | null;
    try {
      savedVersion = await this.saveUnderLock(file.id, body, key, bytes, incomingLastsave);
    } catch (error) {
      await this.removeAttemptObject(key);
      throw error;
    }
    if (savedVersion === null) {
      await this.removeAttemptObject(key);
      return;
    }
    await this.audit.append({
      actorId: null,
      action: 'files.office_save',
      entityType: 'file',
      entityId: file.id,
      details: { version: savedVersion, status: body.status, users: body.users ?? [] },
    });
    // Конвейер производных (#139): новая версия → перегенерация PDF-копии
    // (очередь; best-effort — не блокирует подтверждение колбэка).
    await this.derivativesQueue.enqueuePdf(file.id, savedVersion);
    this.logger.info(
      { fileId, version: savedVersion, status: body.status },
      'Office version saved',
    );
  }

  /**
   * Запись версии под замком строки файла (AUD-015, #866): первым шагом
   * транзакции — `FOR UPDATE`, по свежей строке — проверка ключа, дедуп
   * lastsave и номер версии. null — сохранение уже сделано/неактуально:
   * колбэк подтверждается, объект попытки удаляет вызывающий. Нарушение
   * unique(fileObjectId, version) (P2002) — та же семантика «уже сохранено»:
   * гонка проиграна другому сохранению.
   */
  private async saveUnderLock(
    fileId: string,
    body: OfficeCallbackBody,
    key: string,
    bytes: number,
    incomingLastsave: bigint | null,
  ): Promise<number | null> {
    try {
      return await this.txRunner.run(async (tx) => {
        const locked = await this.repository.lockForSave(tx, fileId);
        if (!locked) {
          this.logger.warn(
            { fileId, key: body.key },
            'Office callback file disappeared during save',
          );
          return null;
        }
        const { file, latest } = locked;
        // Устаревший ключ сверяем по СВЕЖЕЙ строке: пока шло скачивание,
        // другое сохранение могло уйти вперёд и закрыть сессию DS.
        const currentKey = `${file.id}.v${file.version}`;
        const continuesLatest = latest?.sourceKey === body.key;
        if (body.key !== currentKey && !continuesLatest) {
          this.logger.info(
            { fileId, key: body.key, current: file.version },
            'Office callback for outdated document key (fresh state)',
          );
          return null;
        }
        if (
          latest?.sourceKey === body.key &&
          incomingLastsave !== null &&
          latest.sourceLastsave === incomingLastsave
        ) {
          this.logger.info(
            { fileId, key: body.key },
            'Office callback deduplicated (same lastsave)',
          );
          return null;
        }
        const version = file.version + 1;
        await this.repository.saveVersion(tx, {
          fileObjectId: file.id,
          version,
          key,
          size: bytes,
          mime: file.mime,
          sourceKey: body.key,
          sourceLastsave: incomingLastsave,
        });
        const payload: FileVersionCreatedPayload = {
          fileId: file.id,
          version,
          size: bytes,
          mime: file.mime,
        };
        await this.eventBus.emit(tx, FILE_EVENTS.VERSION_CREATED, payload, {
          aggregateType: 'file',
          aggregateId: file.id,
        });
        return version;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        this.logger.info(
          { fileId, key: body.key },
          'Office save already stored (unique-version conflict)',
        );
        return null;
      }
      throw error;
    }
  }

  /** Компенсация попытки сохранения (AUD-015): объект, не привязанный к
   *  строке версии, удаляется — сирот в хранилище не остаётся. Сбой уборки
   *  не подменяет исходную ошибку/подтверждение (best-effort). */
  private async removeAttemptObject(key: string): Promise<void> {
    try {
      await this.driver.remove([key]);
    } catch (error) {
      this.logger.warn({ key, err: error }, 'Failed to remove unclaimed office save object');
    }
  }

  /**
   * Скачивание собранного файла из кэша DS. Хост в body.url строится DS от
   * браузерского origin (X-Forwarded-Host) — из сети api он может не
   * резолвиться, поэтому origin подменяется внутренним адресом DS
   * (механизм: getBaseUrl у DS, DocumentServer#2162); путь и подпись
   * md5+expires сохраняются.
   *
   * Заголовки ответа — сверки, не предусловия (#182): тело читается в буфер
   * (потолок 128 МБ — собранные офисные копии заведомо меньше), хранилище
   * получает ТОЧНЫЙ фактический размер: отсутствующий или расходящийся
   * content-length (gzip-декодирование undici, chunked) не валит сохранение
   * (minio-putObject падает на неверном declared — репро валидатора).
   * Подпись md5 в url — внутренняя контрольная сумма кэша DS (формат не
   * документирован): расхождение — предупреждение, не фатал.
   */
  private async downloadTo(
    url: string,
    key: string,
    mime: string,
    fileName: string,
  ): Promise<{ bytes: number }> {
    const internal = this.toInternalUrl(url);
    const response = await fetch(internal);
    if (!response.ok || !response.body) {
      throw new Error(`Office save download failed (${response.status}) for ${fileName}`);
    }
    const declared = Number(response.headers.get('content-length') ?? -1);
    const expectedMd5 = new URL(internal).searchParams.get('md5');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      total += (chunk as Buffer).length;
      if (total > SAVE_DOWNLOAD_CAP_BYTES) {
        throw new Error(`Office save exceeds download cap for ${fileName}`);
      }
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    const { bytes } = await this.driver.put(key, body.length, mime, Readable.from([body]));
    if (declared >= 0 && bytes !== declared) {
      this.logger.warn(
        { fileName, declared, bytes },
        'Office save size differs from content-length; stored by actual bytes',
      );
    }
    if (expectedMd5 && createHash('md5').update(body).digest('base64url') !== expectedMd5) {
      this.logger.warn(
        { fileName, expectedMd5 },
        'Office save DS cache signature differs from body md5 (informational)',
      );
    }
    return { bytes };
  }

  /**
   * Fail-closed (SSRF): скачиваем ТОЛЬКО с внутреннего origin DS — от body.url
   * берутся лишь путь и query. Невалидный url колбэка или кривой
   * OFFICE_INTERNAL_URL — отказ, а не fetch сырого url (иначе подписанный
   * колбэк уводил бы запрос api на произвольный хост).
   */
  private toInternalUrl(url: string): string {
    const base = parseHttpUrl(this.config.internalUrl);
    if (!base) {
      // Ошибка конфигурации, не входа: 500 → DS повторит доставку после починки.
      throw new Error('OFFICE_INTERNAL_URL is not a valid http(s) URL');
    }
    const parsed = parseHttpUrl(url);
    if (!parsed) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Document server callback url is not a valid http(s) URL',
      );
    }
    return `${base.origin}${parsed.pathname}${parsed.search}`;
  }

  /** lastsave колбэка → мс (bigint для file_versions.source_lastsave);
   *  null — отсутствует/мусор: без lastsave дедуп не делаем (риск потерять
   *  реальные изменения важнее риска дубликата-версии). */
  private toLastsaveMs(iso: string | undefined): bigint | null {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? BigInt(ms) : null;
  }
}
