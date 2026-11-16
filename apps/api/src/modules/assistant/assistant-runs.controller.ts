import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { assistantRunSchema, Permission, type AssistantRun } from '@nodus/contracts';
import type { AuthUser } from '@nodus/contracts';
import { map, type Observable } from 'rxjs';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { AssistantRunsService } from './assistant-runs.service.js';
import type { RunEvent } from './run-bus.service.js';

/**
 * Прогоны ассистента (`/api/v1/assistant/runs`, эпик #889): поток SSE,
 * статус и отмена. Поток — нативный `@Sse`: клиент читает его через
 * fetch-stream с Bearer-токеном (EventSource не умеет заголовки).
 *
 * Восстановление после обрыва — `Last-Event-ID` (стандартный заголовок SSE;
 * клиент может продублировать query-параметром `lastEventId`).
 */
@ApiTags('assistant')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.ASSISTANT_USE)
@Controller('assistant/runs')
export class AssistantRunsController {
  constructor(private readonly runs: AssistantRunsService) {}

  @Sse(':runId/stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: 'Поток событий прогона (SSE): дельты, вызовы, финал' })
  @ApiErrors(401, 403, 404)
  async stream(
    @GetUser() user: AuthUser,
    @Param('runId') runId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const stream = await this.runs.stream(user, runId, Number(lastEventId ?? 0));
    return stream.pipe(
      map((event: RunEvent): MessageEvent => ({
        id: String(event.seq),
        type: event.type,
        data: { ...event.data, type: event.type, seq: event.seq },
      })),
    );
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Статус прогона (fallback без потока)' })
  @ApiOkResponse({ standardSchema: assistantRunSchema })
  @ApiErrors(401, 403, 404)
  get(@GetUser() user: AuthUser, @Param('runId') runId: string): Promise<AssistantRun> {
    return this.runs.get(user, runId);
  }

  @Post(':runId/cancel')
  @HttpCode(200)
  @Audit({ action: 'assistant.run_cancel', entity: 'assistant_run' })
  @ApiOperation({ summary: 'Остановить прогон (провайдер и инструменты получают AbortSignal)' })
  @ApiOkResponse({ standardSchema: assistantRunSchema })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  cancel(@GetUser() user: AuthUser, @Param('runId') runId: string): Promise<AssistantRun> {
    return this.runs.cancel(user, runId);
  }
}
