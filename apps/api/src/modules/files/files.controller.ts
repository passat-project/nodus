import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ErrorCode,
  Permission,
  fileTextResponseSchema,
  type AuthUser,
  type FileTextResponse,
} from '@nodus/contracts';

import { SignedUrlService } from '../../core/crypto/signed-url.service.js';
import { Audit } from '../../core/decorators/audit.decorator.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { Public } from '../../core/decorators/public.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { FilesRepository } from './files.repository.js';
import { DerivativesRepository } from './derivatives/derivatives.repository.js';
import { MinioStorageDriver } from './storage/minio-storage.driver.js';
import { decideContentRange } from './content-range.js';
import { needsTextNormalization, normalizeTextForOffice } from './office/text-normalizer.js';
import { FileTextService } from './text/file-text.service.js';

const contentQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
  /** Конкретная версия (история просмотрщика, #138); без v — текущая. */
  v: z.coerce.number().int().min(1).optional(),
  /** Контекст движка ONLYOFFICE: txt/csv/tsv отдаются UTF-8+BOM (DS сам не
   * детектит кодировку — диалог выбора висит невидимым, репро 29.09). */
  office: z.literal('1').optional(),
});

const derivativeQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * CSP-песочница пользовательского контента (#1005, security-ревью): прямая
 * навигация по подписной ссылке не исполняет активный контент на origin
 * портала (там refresh-cookie), даже если sniffing когда-нибудь обойдут.
 */
const USER_CONTENT_CSP = "default-src 'none'; sandbox";

/**
 * Отдача файлов (`/api/v1/files`): контент по HMAC-подписи (ADR-0013).
 * `@Public`: ссылку открывают <img>/«скачать»/новая вкладка — Authorization-
 * заголовка нет; подпись = виза, выданная при формировании DTO вложения
 * (лента сообщений уже проверила членство в беседе). Заражённые (scan_status
 * = infected) не отдаются с первого дня — 410 FILE_QUARANTINED. Версии
 * неизменяемы (ключ = f(id, version)) — ETag даёт честный 304.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly repository: FilesRepository,
    private readonly derivatives: DerivativesRepository,
    private readonly driver: MinioStorageDriver,
    private readonly signedUrls: SignedUrlService,
    private readonly fileText: FileTextService,
  ) {}

  /**
   * Текст вложения для ИИ-агента (#922): PDF с текстовым слоем и DOCX.
   * НЕ по подписи: обычная авторизация сотрудника + резолвер прав контекста
   * (владение, участник беседы, видимое письмо). Текст в лог не пишется.
   * Маршрут живёт под фичефлагом `assistant` (I10): без ассистента это лишняя
   * поверхность чтения документов; конфиденциальные письма — 403.
   */
  @Get(':id/text')
  @RequireFeature('assistant')
  @RequirePermissions(Permission.ASSISTANT_USE)
  // Текст документа — чувствительные данные: не кэшируется прокси и общими
  // профилями браузера; чтение фиксируется в audit_logs (I7, ADR-0050 п. 8).
  @Header('Cache-Control', 'no-store')
  @Audit({ action: 'files.text_read', entity: 'file' })
  @ApiOperation({ summary: 'Текст вложения (PDF/DOCX) для ответов ассистента' })
  @ApiOkResponse({ standardSchema: fileTextResponseSchema })
  @ApiErrors(401, 403, 404, 410, 413, 415, 422, 429, 504)
  text(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @GetUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FileTextResponse> {
    // Обрыв клиента останавливает разбор: worker уничтожается, если результат
    // больше никто не ждёт (security-ревью 18.11.2026).
    const controller = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.on('close', onClose);
    return this.fileText.extract(id, user.id, controller.signal).finally(() => {
      reply.raw.off('close', onClose);
    });
  }

  @Public()
  @Get(':id/content')
  @ApiOperation({
    summary:
      'Контент файла по подписанной ссылке (inline для изображений/видео, Range/206 для перемотки медиа)',
  })
  @ApiErrors(401, 404, 410, 416, 429)
  async content(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query({
      schema: contentQuerySchema,
      pipes: [new ZodValidationPipe(contentQuerySchema)],
    })
    query: z.infer<typeof contentQuerySchema>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Ресурс подписи включает версию: ссылка на v2 не открывает v3.
    const resourceId = query.v ? `${id}:v${query.v}` : id;
    if (!this.signedUrls.verify(resourceId, query.exp, query.sig)) {
      throw DomainException.unauthenticated('File link is invalid or expired');
    }
    const file = await this.repository.findById(id);
    if (!file) {
      throw DomainException.notFound('File not found');
    }
    if (file.scanStatus === 'infected') {
      throw new DomainException(ErrorCode.FILE_QUARANTINED, 'File is quarantined', undefined, 410);
    }

    // Текущая версия — по указателю file_objects.key; запрошенная — из истории.
    let key = file.key;
    let version = file.version;
    let size = file.size;
    if (query.v && query.v !== file.version) {
      const row = await this.repository.findVersion(file.id, query.v);
      if (!row) throw DomainException.notFound('File version not found');
      key = row.key;
      version = row.version;
      size = row.size;
    }

    const etag = `"${file.id}-v${version}"`;
    // 304 — только для запросов БЕЗ Range (#1005): медиаэлемент приходит с
    // диапазоном и ждёт 206 или полный файл; «возьми из кэша» на Range-запрос
    // отдаёт клиенту решение по частичному кэшу.
    if (!request.headers.range && request.headers['if-none-match'] === etag) {
      void reply.status(304).send();
      return;
    }

    // Контекст DS: текстовые форматы нормализуются (UTF-8+BOM) буфером —
    // размер тела меняется, отдаём посчитанный.
    if (query.office && needsTextNormalization(file.name, size)) {
      const chunks: Buffer[] = [];
      for await (const chunk of await this.driver.get(key)) {
        chunks.push(chunk as Buffer);
      }
      const body = normalizeTextForOffice(Buffer.concat(chunks));
      void reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Length', body.length)
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('ETag', etag)
        .send(body);
      return;
    }

    // Перемотка видео (#1005): браузер запрашивает байтовый диапазон и
    // считает поток seekable только после 206 + Content-Range. If-Range:
    // срез применяем, только если клиент кэшировал ЭТУ версию, иначе отдаём
    // файл целиком — склейка срезов разных версий даёт битый ролик.
    const ifRange = request.headers['if-range'];
    const rangeDecision = decideContentRange(
      ifRange === undefined || ifRange === etag ? request.headers.range : undefined,
      size,
    );
    if (rangeDecision.kind === 'unsatisfiable') {
      // 416 обязан нести полный размер ресурса (RFC 9110 §15.5.17).
      void reply.header('Content-Range', `bytes */${size}`);
      throw new DomainException(
        ErrorCode.FILE_RANGE_NOT_SATISFIABLE,
        'Requested range is not satisfiable',
        { size },
      );
    }
    const range = rangeDecision.kind === 'partial' ? rangeDecision.range : undefined;
    // Заголовки собираем ДО открытия потока: битое имя (одиночный суррогат)
    // или mime, который Fastify отвергнет, не должны оставить соединение
    // к хранилищу открытым (security-ревью #1005).
    // Inline — ТОЛЬКО whitelist неисполняемых форматов: mime приходит от
    // клиента и не валидируется, а SVG (и пр. активный контент) в «новой
    // вкладке» исполняет скрипты на origin портала → refresh-cookie жертвы
    // (валидация #57: stored XSS). Изображения и видео-контейнеры (стикеры
    // #143, кинозал #787, перемотка #1005) — inline; остальное — attachment;
    // на всё — nosniff + CSP-песочница пользовательского контента.
    const INLINE_MIME = new Set([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/bmp',
      'video/webm',
      'video/mp4',
      'video/quicktime',
      'video/ogg',
      'video/x-matroska',
      'video/mpeg',
      'video/x-msvideo',
      'video/3gpp',
    ]);
    const disposition = INLINE_MIME.has(file.mime) ? 'inline' : 'attachment';
    const headers: Record<string, string | number> = {
      'Content-Type': file.mime,
      // Длина — тела ответа: у 206 это срез, у 200 — весь файл.
      'Content-Length': range ? range.end - range.start + 1 : size,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': USER_CONTENT_CSP,
      'Cache-Control': 'private, max-age=3600',
      ETag: etag,
    };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    // HEAD: тело не нужно — поток из хранилища не открываем вовсе. Заголовки
    // пишем напрямую: `reply.send()` без тела обнулил бы Content-Length,
    // а HEAD обязан повторять заголовки GET (RFC 9110 §9.3.2).
    if (request.method === 'HEAD') {
      reply.hijack();
      reply.raw.writeHead(range ? 206 : 200, headers);
      reply.raw.end();
      return;
    }
    // Поток открываем ПОСЛЕ сборки заголовков: сбой хранилища уходит в единый
    // конверт ошибки без медиа-заголовков (`inline`, кеш, ETag) на ответе
    // (security-ревью #1005). Бросок на выставлении заголовков (негодный
    // mime/имя) не должен оставить соединение с хранилищем открытым.
    const stream = await this.driver.get(key, range);
    try {
      void reply
        .status(range ? 206 : 200)
        .headers(headers)
        .send(stream);
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  /**
   * Производная файла (конвейер #139): PDF-копия офисного документа для
   * fallback-просмотра. Подпись = visa, выданная в DTO (тот же механизм,
   * что content); ссылка детерминирована (fileId, kind) — неготовая
   * производная честно отвечает 404 (фронт уходит в карточку скачивания).
   * Заражённые оригиналы не отдаются (410, карантин).
   */
  @Public()
  @Get(':id/derivative/:kind')
  @ApiOperation({ summary: 'Производная файла по подписанной ссылке (pdf-копия)' })
  async derivative(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Param('kind', new ZodValidationPipe(z.enum(['pdf']))) kind: 'pdf',
    @Query({
      schema: derivativeQuerySchema,
      pipes: [new ZodValidationPipe(derivativeQuerySchema)],
    })
    query: z.infer<typeof derivativeQuerySchema>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!this.signedUrls.verify(`${id}:deriv:${kind}`, query.exp, query.sig)) {
      throw DomainException.unauthenticated('File link is invalid or expired');
    }
    const file = await this.repository.findById(id);
    if (!file) throw DomainException.notFound('File not found');
    if (file.scanStatus === 'infected') {
      throw new DomainException(ErrorCode.FILE_QUARANTINED, 'File is quarantined', undefined, 410);
    }
    const derivative = await this.derivatives.find(id, file.version, kind);
    if (derivative?.status !== 'ready' || !derivative.key) {
      throw DomainException.notFound('File derivative is not ready');
    }
    const etag = `"${id}-v${file.version}-deriv-${kind}"`;
    // Заголовки (и кодирование имени) — до открытия потока, как в content:
    // бросок не оставляет соединение с хранилищем открытым (security-ревью
    // #1005). CSP-песочница — та же, что у пользовательского контента.
    const headers: Record<string, string | number> = {
      'Content-Type': derivative.mime,
      'Content-Length': derivative.size,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${file.name}.pdf`)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': USER_CONTENT_CSP,
      'Cache-Control': 'private, max-age=3600',
      ETag: etag,
    };
    const stream = await this.driver.get(derivative.key);
    void reply.headers(headers).send(stream);
  }
}
