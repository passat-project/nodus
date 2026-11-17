import { Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assistantActionDecisionSchema,
  assistantActionSchema,
  Permission,
  type AssistantAction,
  type AssistantActionDecision,
  type AuthUser,
} from '@nodus/contracts';
import { z } from 'zod';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { AssistantContinuationService } from './agent/continuation.service.js';
import { AssistantActionsService } from './assistant-actions.service.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

/**
 * Карточки действий (`/api/v1/assistant/actions`, Ф2 #899, ADR-0048):
 * подтверждение, отказ и отмена выполненного. Доступ — только владельцу
 * карточки (чужая — 404). Запись исполняется от имени сотрудника его же
 * `Authorization`; идемпотентность держит id карточки.
 *
 * Аудит: `assistant.action_execute/cancel/undo` — пометка «через ИИ» рядом с
 * обычным аудитом доменной мутации, которую пишет сам API портала.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.ASSISTANT_USE)
@Controller('assistant/actions')
export class AssistantActionsController {
  constructor(
    private readonly actions: AssistantActionsService,
    private readonly continuation: AssistantContinuationService,
  ) {}

  @Post(':id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Выполнить карточку действия (повторный клик — без дубля)' })
  @ApiOkResponse({ standardSchema: assistantActionDecisionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  async execute(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantActionDecision> {
    const action = await this.actions.execute(user.id, id, authorization ?? '');
    // Последнее решение пачки запускает ОДНО продолжение (#916) — в том же
    // запросе, чтобы клиент сразу подписался на поток.
    const continuationRunId = await this.continuation.afterDecision(
      user,
      authorization ?? '',
      action.messageId,
    );
    return { action, continuationRunId };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Audit({ action: 'assistant.action_cancel', entity: 'assistant_action' })
  @ApiOperation({ summary: 'Отклонить карточку: записей в портале не появляется' })
  @ApiOkResponse({ standardSchema: assistantActionDecisionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  async cancel(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantActionDecision> {
    const action = await this.actions.cancel(user.id, id);
    const continuationRunId = await this.continuation.afterDecision(
      user,
      authorization ?? '',
      action.messageId,
    );
    return { action, continuationRunId };
  }

  @Post(':id/undo')
  @HttpCode(200)
  @Audit({ action: 'assistant.action_undo', entity: 'assistant_action' })
  @ApiOperation({ summary: 'Отменить выполненное (удалить созданное), где API позволяет' })
  @ApiOkResponse({ standardSchema: assistantActionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  undo(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantAction> {
    return this.actions.undo(user.id, id, authorization ?? '');
  }
}
