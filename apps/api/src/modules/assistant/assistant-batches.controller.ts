import { Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assistantBatchDecisionSchema,
  assistantContinueResponseSchema,
  Permission,
  type AssistantBatchDecision,
  type AssistantContinueResponse,
  type AuthUser,
} from '@nodus/contracts';
import { z } from 'zod';

import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { AssistantContinuationService } from './agent/continuation.service.js';
import { AssistantBatchesService } from './assistant-batches.service.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

/**
 * Пачка карточек одного хода (#916): «Выполнить все», «Отменить все» и
 * «Продолжить сейчас». Пачка адресуется сообщением ассистента; доступ —
 * только владельцу (чужая — 404).
 *
 * Автопродолжение после последнего решения запускается сервером в том же
 * запросе; клиент получает `continuationRunId` и подписывается на поток.
 * Закрытое окно продолжение не отменяет — ответ сохраняется в истории.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.ASSISTANT_USE)
@Controller('assistant/messages')
export class AssistantBatchesController {
  constructor(
    private readonly batches: AssistantBatchesService,
    private readonly continuation: AssistantContinuationService,
  ) {}

  @Post(':id/actions/execute-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Выполнить все карточки пачки (очередью, без дублей)' })
  @ApiOkResponse({ standardSchema: assistantBatchDecisionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  executeAll(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantBatchDecision> {
    return this.batches.executeAll(user, id, authorization ?? '');
  }

  @Post(':id/actions/cancel-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отменить нерешённые карточки пачки и подвести итог' })
  @ApiOkResponse({ standardSchema: assistantBatchDecisionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  cancelAll(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantBatchDecision> {
    return this.batches.cancelAll(user, id, authorization ?? '');
  }

  @Post(':id/continue')
  @HttpCode(202)
  @ApiOperation({ summary: 'Продолжить сейчас: агент отвечает с принятыми решениями' })
  @ApiOkResponse({ standardSchema: assistantContinueResponseSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  async continue(
    @GetUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AssistantContinueResponse> {
    const runId = await this.continuation.continueNow(user, id, authorization ?? '');
    return { runId };
  }
}
