import { Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { ErrorCode, messageAttachmentSchema, type MessageAttachment } from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { AttachmentsService } from './attachments.service.js';

const uuidSchema = z.uuid();

/** Поля multipart-формы загрузки: size обязателен (клиент знает File.size —
 *  putObject из стрима требует размер заранее; сверка с байтами — в файловом
 *  хранилище), width/height — габариты изображения от клиента (резерв бокса
 *  ленты без сдвига). previewUrl — мок-поле, живой контур игнорирует. */
const uploadFieldsSchema = z.object({
  size: z.coerce.number().int().min(0),
  width: z.coerce.number().int().min(1).optional(),
  height: z.coerce.number().int().min(1).optional(),
  /** Длительность видео от клиента (мс, #250): резерв до ffprobe. */
  durationMs: z.coerce.number().int().min(0).optional(),
});

/**
 * Вложения (`/api/v1/chat/attachments`): загрузка до отправки сообщения
 * (multipart-стрим, без буферизации), отмена из трея композера. Привязка к
 * сообщению — одноразовая при отправке (sendMessage attachmentIds).
 */
@ApiTags('chat')
@ApiBearerAuth()
@RequireFeature('chat')
@Controller('chat/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @Audit({ action: 'chat.attachment_upload', entity: 'attachment' })
  @ApiOperation({
    summary: 'Загрузка вложения (multipart: file + поля size/width/height/durationMs)',
  })
  @ApiCreatedResponse({ standardSchema: messageAttachmentSchema })
  @ApiErrors(400, 401, 403, 404, 413)
  @ApiIdempotencyKey()
  async upload(
    @GetUser() user: { id: string },
    @Req() request: FastifyRequest,
  ): Promise<MessageAttachment> {
    let read: { file: MultipartFile; fields: Record<string, string> };
    try {
      read = await this.readMultipart(request);
    } catch (error) {
      if (error instanceof DomainException) throw error;
      // Бусбой остановил поток по лимиту @fastify/multipart (жёсткий потолок
      // хранилища 200 МБ, ADR-0013) — переводим в доменный код с чат-лимитом.
      throw new DomainException(
        ErrorCode.CHAT_ATTACHMENT_TOO_LARGE,
        'Attachment exceeds file size limit',
        undefined,
        413,
      );
    }
    const { file, fields } = read;
    const parsed = uploadFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      // Стрим не потреблён — сбрасываем, иначе соединение зависнет на
      // непрочитанном теле.
      file.file.resume();
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Validation failed', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    try {
      return await this.attachments.upload(
        user.id,
        {
          name: file.filename || 'file',
          mime: file.mimetype,
          size: parsed.data.size,
          width: parsed.data.width,
          height: parsed.data.height,
          durationMs: parsed.data.durationMs,
        },
        file.file,
      );
    } catch (error) {
      file.file.resume();
      throw error;
    }
  }

  @Delete(':id')
  @Audit({ action: 'chat.attachment_cancel', entity: 'attachment' })
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Отмена неотправленного вложения (трей композера)' })
  @ApiErrors(401, 403, 404)
  async cancel(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) attachmentId: string,
  ): Promise<void> {
    await this.attachments.cancel(user.id, attachmentId);
  }

  /**
   * Первая file-часть + текстовые поля ДО неё. Канон @fastify/multipart:
   * `request.file()` отдаёт в fields только части, идущие РАНЬШЕ файла —
   * поля после файловой части недетерминированы (на маленьких телах busboy
   * успевает спарсить всё, на больших — нет: репро #57, size=NaN на 3 МБ).
   * Поэтому контракт: клиент шлёт текстовые поля ДО файла (зеркально
   * переставлен upload-attachment.ts), сервер читает parts()-итератором.
   */
  private async readMultipart(
    request: FastifyRequest,
  ): Promise<{ file: MultipartFile; fields: Record<string, string> }> {
    const parts = request.parts();
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === 'file') {
        return { file: part, fields };
      }
      if (part.fieldname in fields) continue; // дубль имени — берём первое
      fields[part.fieldname] = String(part.value);
    }
    throw new DomainException(
      ErrorCode.VALIDATION_FAILED,
      'multipart/form-data with a file part is required',
    );
  }
}
