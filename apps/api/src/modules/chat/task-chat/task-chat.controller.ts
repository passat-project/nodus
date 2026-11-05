import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  conversationListItemSchema,
  type AuthUser,
  type ConversationListItem,
} from '@nodus/contracts';

import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { TaskChatService } from './task-chat.service.js';

/** Чат задачи (#252): find-or-create беседы задачи для карточки. */
@ApiTags('chat')
@ApiBearerAuth()
@RequireFeature('chat')
@Controller('chat/conversations')
export class TaskChatController {
  constructor(
    private readonly taskChat: TaskChatService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get('by-task/:taskId')
  @ApiOperation({
    summary:
      'Беседа задачи (создаётся при первом открытии); участник или решающий шага (#433, read-only) — иначе 404',
  })
  @ApiOkResponse({ standardSchema: conversationListItemSchema })
  @ApiErrors(400, 401, 404)
  async byTask(
    @GetUser() user: AuthUser,
    @Param('taskId', new ZodValidationPipe(z.uuid())) taskId: string,
  ): Promise<ConversationListItem> {
    const conversationId = await this.taskChat.openForUser(taskId, user);
    return this.conversations.item(conversationId, user.id);
  }
}
