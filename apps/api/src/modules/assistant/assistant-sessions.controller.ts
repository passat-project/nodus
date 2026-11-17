import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  assistantMessageListSchema,
  assistantSessionListSchema,
  assistantSessionSchema,
  createAssistantSessionBodySchema,
  Permission,
  sendAssistantMessageBodySchema,
  sendAssistantMessageResponseSchema,
  updateAssistantSessionBodySchema,
  type AssistantMessageList,
  type AssistantSession,
  type AssistantSessionList,
  type CreateAssistantSessionBody,
  type SendAssistantMessageBody,
  type SendAssistantMessageResponse,
  type UpdateAssistantSessionBody,
} from '@nodus/contracts';
import type { AuthUser } from '@nodus/contracts';
import { z } from 'zod';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { AssistantSessionsService } from './assistant-sessions.service.js';

/** Path-параметр: не-UUID — 400 `VALIDATION_FAILED`, не 500 из Prisma. */
const uuidPipe = new ZodValidationPipe(z.uuid());

/**
 * Диалоги ИИ-ассистента (`/api/v1/assistant`, эпик #889, ADR-0043).
 *
 * Флаг `assistant` (I10) + право `assistant.use` (I8) — на весь контроллер:
 * без права инструмент не попадает в каталог, а API отвечает 403. Доступ к
 * сессиям — только владельцу (чужая — 404).
 */
@ApiTags('assistant')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.ASSISTANT_USE)
@Controller('assistant')
export class AssistantSessionsController {
  constructor(private readonly sessions: AssistantSessionsService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Диалоги сотрудника (последние 50)' })
  @ApiOkResponse({ standardSchema: assistantSessionListSchema })
  @ApiErrors(401, 403, 404)
  list(@GetUser() user: AuthUser): Promise<AssistantSessionList> {
    return this.sessions.list(user);
  }

  @Post('sessions')
  @Audit({ action: 'assistant.session_create', entity: 'assistant_session' })
  @ApiOperation({ summary: 'Новый диалог' })
  @ApiOkResponse({ standardSchema: assistantSessionSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  create(
    @GetUser() user: AuthUser,
    @Body({
      schema: createAssistantSessionBodySchema,
      pipes: [new ZodValidationPipe(createAssistantSessionBodySchema)],
    })
    body: CreateAssistantSessionBody,
  ): Promise<AssistantSession> {
    return this.sessions.create(user, body);
  }

  @Patch('sessions/:id')
  @Audit({ action: 'assistant.session_update', entity: 'assistant_session' })
  @ApiOperation({ summary: 'Переименовать или архивировать диалог' })
  @ApiOkResponse({ standardSchema: assistantSessionSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  update(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Body({
      schema: updateAssistantSessionBodySchema,
      pipes: [new ZodValidationPipe(updateAssistantSessionBodySchema)],
    })
    body: UpdateAssistantSessionBody,
  ): Promise<AssistantSession> {
    return this.sessions.update(user, id, body);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Audit({ action: 'assistant.session_delete', entity: 'assistant_session' })
  @ApiOperation({ summary: 'Удалить диалог (каскад сообщений и прогонов)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404)
  async remove(@GetUser() user: AuthUser, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.sessions.remove(user, id);
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: 'История диалога с вызовами инструментов' })
  @ApiOkResponse({ standardSchema: assistantMessageListSchema })
  @ApiErrors(401, 403, 404)
  messages(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
  ): Promise<AssistantMessageList> {
    return this.sessions.messages(user, id);
  }

  @Post('sessions/:id/messages')
  @HttpCode(202)
  @Audit({ action: 'assistant.message_send', entity: 'assistant_session' })
  @ApiOperation({ summary: 'Отправить сообщение: 202 { runId, messageId }, ответ — в SSE' })
  @ApiOkResponse({ standardSchema: sendAssistantMessageResponseSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  send(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body({
      schema: sendAssistantMessageBodySchema,
      pipes: [new ZodValidationPipe(sendAssistantMessageBodySchema)],
    })
    body: SendAssistantMessageBody,
  ): Promise<SendAssistantMessageResponse> {
    // Токен сотрудника живёт только в памяти прогона: инструменты идут от его имени.
    return this.sessions.sendMessage(user, id, body, authorization ?? '');
  }
}
