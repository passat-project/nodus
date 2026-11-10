import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  pressExecuteResultSchema,
  pressExcludeBodySchema,
  pressReturnBodySchema,
  pressSubmitBodySchema,
  type AuthUser,
  type PressExcludeBody,
  type PressExecuteResult,
  type PressReturnBody,
  type PressSubmitBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { TaskTransitionsService } from '../workflow/task-transitions.service.js';
import { PressAdminService } from './press-admin.service.js';
import { PressService } from './press.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/**
 * Сбор отметок (#434): сдача своей отметки и отзыв. Тело — личные разделы
 * окна кнопки (TransitionFormInput), ответ — карточка с новым прогрессом и
 * пересчитанными кнопками. Кворум проверяется в той же транзакции; при нём
 * движок выполняет обычный переход кнопки, поэтому `press` в ответе — null.
 */
@ApiTags('tasks')
@ApiBearerAuth()
@RequireFeature('tasks')
@Controller('tasks')
export class TaskPressController {
  constructor(
    private readonly press: PressService,
    private readonly admin: PressAdminService,
    private readonly query: TasksQueryService,
    private readonly transitions: TaskTransitionsService,
  ) {}

  @Post(':id/press/submit')
  @HttpCode(200)
  @Audit({ action: 'task.press_submit', entity: 'task' })
  @ApiOperation({ summary: 'Сдать отметку сбора (ввод окна кнопки)' })
  @ApiOkResponse({ standardSchema: pressExecuteResultSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  async submit(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: pressSubmitBodySchema,
      pipes: [new ZodValidationPipe(pressSubmitBodySchema)],
    })
    body: PressSubmitBody,
  ): Promise<PressExecuteResult> {
    await this.query.visibleRow(user, id);
    await this.press.submit(user, id, body);
    return this.result(user, id);
  }

  @Post(':id/press/withdraw')
  @HttpCode(200)
  @Audit({ action: 'task.press_withdraw', entity: 'task' })
  @ApiOperation({ summary: 'Отозвать свою отметку до кворума' })
  @ApiOkResponse({ standardSchema: pressExecuteResultSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  async withdraw(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<PressExecuteResult> {
    await this.query.visibleRow(user, id);
    await this.press.withdraw(user, id);
    return this.result(user, id);
  }

  @Post(':id/press/return')
  @HttpCode(200)
  @Audit({ action: 'task.press_return', entity: 'task' })
  @ApiOperation({ summary: 'Вернуть выбранные отметки на доработку (ответственный)' })
  @ApiOkResponse({ standardSchema: pressExecuteResultSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  async returnSelected(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: pressReturnBodySchema,
      pipes: [new ZodValidationPipe(pressReturnBodySchema)],
    })
    body: PressReturnBody,
  ): Promise<PressExecuteResult> {
    await this.query.visibleRow(user, id);
    await this.admin.returnEntries(user, id, body);
    return this.result(user, id);
  }

  @Post(':id/press/exclude')
  @HttpCode(200)
  @Audit({ action: 'task.press_exclude', entity: 'task' })
  @ApiOperation({ summary: 'Снять участников с открытого сбора (ответственный)' })
  @ApiOkResponse({ standardSchema: pressExecuteResultSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  async excludeSelected(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: pressExcludeBodySchema,
      pipes: [new ZodValidationPipe(pressExcludeBodySchema)],
    })
    body: PressExcludeBody,
  ): Promise<PressExecuteResult> {
    await this.query.visibleRow(user, id);
    await this.admin.excludeEntries(user, id, body);
    return this.result(user, id);
  }

  private async result(user: AuthUser, id: string): Promise<PressExecuteResult> {
    const [task, transitions] = await Promise.all([
      this.query.detail(user, id),
      this.transitions.listFor(user, id),
    ]);
    return { press: task.press ?? null, task, transitions };
  }
}
