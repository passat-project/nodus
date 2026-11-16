import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { readIdempotencyKey } from '../idempotency-key.js';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  forwardMessagesBodySchema,
  messagePinSchema,
  messageReactionToggleBodySchema,
  messageSchema,
  paginatedSchema,
  readConversationBodySchema,
  readConversationResultSchema,
  threadStateListSchema,
  threadWatchResultSchema,
  type ChatMessage,
  type ForwardMessagesBody,
  type MessagePin,
  type MessageReactionToggleBody,
  type ReadConversationBody,
  type ReadConversationResult,
  type ThreadStateList,
  type ThreadWatchResult,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { MessageActionsService } from './message-actions.service.js';
import { MessagePinsService } from './message-pins.service.js';
import { MessageReactionsService } from './message-reactions.service.js';
import { ThreadWatchService } from './thread-watch.service.js';
import { MessageDtoMapper } from './message-dto.mapper.js';
import { MessagesService } from './messages.service.js';

const uuidSchema = z.uuid();

/**
 * Действия над сообщениями: закрепы (`/pins`, `/pin`), реакции (toggle),
 * пересылка (`/forward` — цель в пути, источник в теле), квитанции просмотров
 * (`/read` — видимость в вьюпорте, #102 раунд 2).
 */
@ApiTags('chat')
@ApiBearerAuth()
@RequireFeature('chat')
@Controller('chat/conversations/:id')
export class MessageActionsController {
  constructor(
    private readonly actions: MessageActionsService,
    private readonly pinning: MessagePinsService,
    private readonly reactions: MessageReactionsService,
    private readonly threads: ThreadWatchService,
    private readonly mapper: MessageDtoMapper,
    private readonly messages: MessagesService,
  ) {}

  // ===== Квитанции просмотров =====

  @Post('read')
  @HttpCode(200)
  @Audit({ action: 'chat.message_read_receipt', entity: 'conversation' })
  @ApiOperation({
    summary:
      'Квитанция просмотров: watermark до upToSeq (GREATEST, кламп); threadRootId — квитанция из треда (гасит точку наблюдателя)',
  })
  @ApiOkResponse({ standardSchema: readConversationResultSchema })
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  read(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Body({
      schema: readConversationBodySchema,
      pipes: [new ZodValidationPipe(readConversationBodySchema)],
    })
    dto: ReadConversationBody,
  ): Promise<ReadConversationResult> {
    return this.messages.readConversation(user.id, conversationId, dto.upToSeq, dto.threadRootId);
  }

  // ===== Треды: наблюдение и состояния (раунд 3) =====

  @Get('threads/state')
  @ApiOperation({
    summary: 'Состояния трэдов для текущего пользователя (наблюдаемые + непрочитанные)',
  })
  @ApiOkResponse({ standardSchema: threadStateListSchema })
  @ApiErrors(400, 401, 404)
  threadStates(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
  ): Promise<ThreadStateList> {
    return this.threads.threadStates(user.id, conversationId).then((items) => ({ items }));
  }

  @Post('threads/:rootId/watch')
  @HttpCode(200)
  @Audit({ action: 'chat.thread_watch_toggle', entity: 'message' })
  @ApiOperation({ summary: 'Toggle наблюдения за трэдом (кнопка «Следить»)' })
  @ApiOkResponse({ standardSchema: threadWatchResultSchema })
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  watchThread(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Param('rootId', new ZodValidationPipe(uuidSchema)) rootId: string,
  ): Promise<ThreadWatchResult> {
    return this.threads.watchThread(user.id, conversationId, rootId);
  }

  // ===== Закрепы =====

  @Get('pins')
  @ApiOperation({ summary: 'Лента закрепов беседы (снапшоты сообщений, свежие первыми)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(messagePinSchema) })
  @ApiErrors(400, 401, 404)
  async pins(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
  ): Promise<{ items: MessagePin[]; nextCursor: null }> {
    return { items: await this.pinning.listPins(user.id, conversationId), nextCursor: null };
  }

  @Post('messages/:messageId/pin')
  @Audit({ action: 'chat.message_pin', entity: 'message' })
  @ApiOperation({ summary: 'Закрепить (идемпотентно; любое живое сообщение беседы)' })
  @ApiCreatedResponse({ standardSchema: messagePinSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  async pin(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Param('messageId', new ZodValidationPipe(uuidSchema)) messageId: string,
  ): Promise<MessagePin> {
    const { pin, message, members, pinnedByRef } = await this.pinning.pin(
      user.id,
      conversationId,
      messageId,
    );
    const dto = await this.mapper.toDto(message, { viewerId: user.id, members });
    return { message: dto, pinnedBy: pinnedByRef, pinnedAt: pin.pinnedAt.toISOString() };
  }

  @Delete('messages/:messageId/pin')
  @HttpCode(204)
  @Audit({ action: 'chat.message_unpin', entity: 'message' })
  @ApiOperation({ summary: 'Открепить (откреп незакреплённого — 404)' })
  @ApiNoContentResponse({ description: 'Откреплено' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  unpin(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Param('messageId', new ZodValidationPipe(uuidSchema)) messageId: string,
  ): Promise<void> {
    return this.pinning.unpin(user.id, conversationId, messageId);
  }

  // ===== Реакции =====

  @Post('messages/:messageId/reactions')
  @HttpCode(200)
  @Audit({ action: 'chat.reaction_toggle', entity: 'message' })
  @ApiOperation({ summary: 'Toggle своей реакции (remove=true — снять)' })
  @ApiOkResponse({ standardSchema: messageSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  async toggleReaction(
    @GetUser() user: { id: string },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Param('messageId', new ZodValidationPipe(uuidSchema)) messageId: string,
    @Body({
      schema: messageReactionToggleBodySchema,
      pipes: [new ZodValidationPipe(messageReactionToggleBodySchema)],
    })
    dto: MessageReactionToggleBody,
  ): Promise<ChatMessage> {
    const result = await this.reactions.toggleReaction(user.id, conversationId, messageId, dto);
    return this.mapper.toDto(result.message, { viewerId: user.id, members: result.members });
  }

  // ===== Пересылка =====

  @Post('forward')
  @Audit({ action: 'chat.message_forward', entity: 'message' })
  @ApiOperation({ summary: 'Пересылка копий в эту беседу (комментарий — перед блоком)' })
  @ApiCreatedResponse({ standardSchema: messageSchema, isArray: true })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  async forward(
    @GetUser() user: { id: string; permissions: readonly string[] },
    @Param('id', new ZodValidationPipe(uuidSchema)) conversationId: string,
    @Body({
      schema: forwardMessagesBodySchema,
      pipes: [new ZodValidationPipe(forwardMessagesBodySchema)],
    })
    dto: ForwardMessagesBody,
    @Req() request: FastifyRequest,
  ): Promise<ChatMessage[]> {
    const result = await this.actions.forward(
      user,
      conversationId,
      dto,
      readIdempotencyKey(request),
    );
    return this.mapper.toDtos(result.rows, { viewerId: user.id, members: result.members });
  }
}
