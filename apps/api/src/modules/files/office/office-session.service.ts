import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, OfficeMode, OfficeSession, OfficeVersionList } from '@nodus/contracts';
import { ErrorCode, fileExtension, isOfficeTextFormat, officeFormat } from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { FileAccessRegistry } from '../../../core/ports/file-access.registry.js';
import type { FileObjectRow } from '../files.repository.js';
import { FilesRepository } from '../files.repository.js';
import { OFFICE_CONFIG, type OfficeConfig } from './office.config.js';
import { OfficeTokenService } from './office-token.service.js';

/**
 * Сессия документа ONLYOFFICE (#138): право контекста (I8) → конфиг для
 * DocsAPI.DocEditor, собранный ЦЕЛИКОМ на сервере и подписанный JWT.
 * Право = владение файлом ИЛИ решение контрибьютора контекста (chat —
 * участник беседы с вложением, letter — видимое письмо; реестр
 * `FileAccessRegistry`, I13).
 */
@Injectable()
export class OfficeSessionService {
  constructor(
    private readonly repository: FilesRepository,
    @Inject(OFFICE_CONFIG) private readonly config: OfficeConfig,
    private readonly tokens: OfficeTokenService,
    private readonly signedUrls: SignedUrlService,
    private readonly fileAccess: FileAccessRegistry,
  ) {}

  /** Общий резолвер прав (сессия и список версий): NOT_FOUND прячет чужие
   *  файлы (не раскрываем существование, как у бесед чата). */
  async resolveAccess(
    fileId: string,
    userId: string,
  ): Promise<{ file: FileObjectRow; canEdit: boolean }> {
    const file = await this.repository.findById(fileId);
    if (!file) throw DomainException.notFound('File not found');
    let canView = file.ownerId === userId;
    let canEdit = file.ownerId === userId;
    let immutable = false;
    let denied = false;
    for (const contributor of this.fileAccess.contributors()) {
      const decision = await contributor.check(fileId, userId);
      if (decision) {
        canView ||= decision.canView;
        canEdit ||= decision.canEdit;
        // Неизменяемость контекста — вето поверх владения (#55): файл письма
        // не правит даже тот, кто его загрузил.
        immutable ||= decision.immutable === true;
        // Явный отказ контекста — вето и на просмотр (#461): владение файлом
        // не обходит круг участников конфиденциального письма.
        denied ||= decision.deny === true;
      }
    }
    if (denied) canView = false;
    if (immutable || denied) canEdit = false;
    if (!canView) throw DomainException.notFound('File not found');
    return { file, canEdit };
  }

  /** Список версий (сохранения DS), новые сверху; права те же, что у сессии. */
  async listVersions(fileId: string, userId: string): Promise<OfficeVersionList> {
    const { file } = await this.resolveAccess(fileId, userId);
    const rows = await this.repository.findVersions(file.id);
    return {
      items: rows.map((row) => ({
        version: row.version,
        size: row.size,
        mime: row.mime,
        createdAt: row.createdAt.toISOString(),
        url: this.signedUrls.fileVersionUrl(file.id, row.version),
      })),
    };
  }

  async createSession(fileId: string, user: AuthUser, mode: OfficeMode): Promise<OfficeSession> {
    if (!this.config.enabled) {
      throw new DomainException(
        ErrorCode.FILE_OFFICE_DISABLED,
        'Office viewer is disabled',
        undefined,
        503,
      );
    }
    const { file, canEdit } = await this.resolveAccess(fileId, user.id);
    if (file.scanStatus === 'infected') {
      throw new DomainException(ErrorCode.FILE_QUARANTINED, 'File is quarantined', undefined, 410);
    }
    const format = officeFormat(file.name);
    if (!format) {
      throw new DomainException(
        ErrorCode.FILE_OFFICE_UNSUPPORTED,
        'Format is not supported by office viewer',
        { extension: fileExtension(file.name) },
      );
    }
    if (file.size > this.config.maxViewBytes) {
      throw new DomainException(
        ErrorCode.FILE_OFFICE_TOO_LARGE,
        'File exceeds office viewer size limit',
        { maxBytes: this.config.maxViewBytes, size: file.size },
        413,
      );
    }

    const canEditFinal = this.config.editEnabled && format.editable && canEdit;
    const effectiveMode: OfficeMode = mode === 'edit' && canEditFinal ? 'edit' : 'view';

    const document = {
      fileType: fileExtension(file.name),
      // Ключ ко-эдитинга: одна версия файла = одна сессия DS для всех
      // зрителей; с сохранением новой версии ключ меняется (кэш DS не
      // смешивает версии). Алфавит ключа DS — 0-9-.a-zA-Z_= (двоеточие
      // запрещено: io.on connection unexpected key — репро #138).
      key: `${file.id}.v${file.version}`,
      title: file.name,
      // Абсолютный внутренний URL: документ скачивает КОНТЕЙНЕР DS, не браузер.
      // Текстовые форматы — c office=1: контент-эндпоинт отдаст UTF-8+BOM,
      // иначе DS повисает на невидимом диалоге выбора кодировки (29.09).
      url: `${this.config.apiInternalUrl}${this.signedUrls.fileContentUrl(file.id)}${
        isOfficeTextFormat(file.name) ? '&office=1' : ''
      }`,
      permissions: { edit: effectiveMode === 'edit', download: true, print: true },
    };
    const editorConfig = {
      mode: effectiveMode,
      lang: 'ru',
      callbackUrl: `${this.config.apiInternalUrl}/api/v1/files/${file.id}/office-callback`,
      user: { id: user.id, name: user.displayName },
      customization: {
        forcesave: effectiveMode === 'edit',
        compactHeader: true,
        // «О продукте» — ссылка на разработчика (ONLYOFFICE); реклама
        // (feedback, маркетплейс плагинов, AI-кнопки) — выключена (29.09).
        about: true,
        feedback: false,
        plugins: false,
      },
    };
    const token = await this.tokens.sign({ document, editorConfig });

    return {
      fileId: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      version: file.version,
      mode: effectiveMode,
      canEdit: canEditFinal,
      documentType: format.documentType,
      document,
      editorConfig,
      token,
    };
  }
}
