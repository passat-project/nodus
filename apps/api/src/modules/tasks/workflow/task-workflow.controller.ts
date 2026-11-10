import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  executeTransitionBodySchema,
  executeTransitionResultSchema,
  personalStageCreateBodySchema,
  personalStageUpdateBodySchema,
  taskStageSchema,
  taskStageWithCountSchema,
  workflowTransitionSchema,
  type AuthUser,
  type ExecuteTransitionBody,
  type ExecuteTransitionResult,
  type PersonalStageCreateBody,
  type PersonalStageUpdateBody,
  type TaskStage,
  type TaskStageWithCount,
  type WorkflowTransition,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { PersonalStagesService } from '../personal/personal-stages.service.js';
import { TaskTransitionsService } from './task-transitions.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/**
 * Маршрут задачи (кнопки переходов, ADR-0020) и колонки «Моего плана»
 * (ADR-0008). Пути personal-stages статичны — Fastify ставит их выше `:id`.
 */
@ApiTags('tasks')
@ApiBearerAuth()
@RequireFeature('tasks')
@Controller('tasks')
export class TaskWorkflowController {
  constructor(
    private readonly transitions: TaskTransitionsService,
    private readonly personal: PersonalStagesService,
  ) {}

  @Get('personal-stages')
  @ApiOperation({ summary: 'Колонки «Моего плана» со счётчиками' })
  @ApiOkResponse({ standardSchema: z.array(taskStageWithCountSchema) })
  @ApiErrors(401)
  personalStages(@GetUser() user: AuthUser): Promise<TaskStageWithCount[]> {
    return this.personal.list(user);
  }

  @Post('personal-stages')
  @Audit({ action: 'task.personal_stage_create', entity: 'workflow_stage' })
  @ApiOperation({ summary: 'Новая колонка «Моего плана»' })
  @ApiCreatedResponse({ standardSchema: taskStageSchema })
  @ApiErrors(400, 401)
  @ApiIdempotencyKey()
  createStage(
    @GetUser() user: AuthUser,
    @Body({
      schema: personalStageCreateBodySchema,
      pipes: [new ZodValidationPipe(personalStageCreateBodySchema)],
    })
    body: PersonalStageCreateBody,
  ): Promise<TaskStage> {
    return this.personal.create(user, body);
  }

  @Patch('personal-stages/:stageId')
  @HttpCode(200)
  @Audit({ action: 'task.personal_stage_update', entity: 'workflow_stage' })
  @ApiOperation({ summary: 'Правка колонки (имя, цвет, состояние, порядок)' })
  @ApiOkResponse({ standardSchema: taskStageSchema })
  @ApiErrors(400, 401, 404, 409)
  @ApiIdempotencyKey()
  updateStage(
    @GetUser() user: AuthUser,
    @Param('stageId', uuid) stageId: string,
    @Body({
      schema: personalStageUpdateBodySchema,
      pipes: [new ZodValidationPipe(personalStageUpdateBodySchema)],
    })
    body: PersonalStageUpdateBody,
  ): Promise<TaskStage> {
    return this.personal.update(user, stageId, body);
  }

  @Delete('personal-stages/:stageId')
  @HttpCode(200)
  @Audit({ action: 'task.personal_stage_archive', entity: 'workflow_stage' })
  @ApiOperation({ summary: 'Удаление колонки (архивация; задачи — в соседнюю того же состояния)' })
  @ApiOkResponse({
    standardSchema: z.object({ ok: z.literal(true), movedToStageId: z.uuid().optional() }),
  })
  @ApiErrors(400, 401, 404, 409)
  @ApiIdempotencyKey()
  archiveStage(
    @GetUser() user: AuthUser,
    @Param('stageId', uuid) stageId: string,
  ): Promise<{ ok: true; movedToStageId?: string }> {
    return this.personal.archive(user, stageId);
  }

  @Get(':id/transitions')
  @ApiOperation({ summary: 'Доступные переходы маршрута (с причинами блокировки)' })
  @ApiOkResponse({ standardSchema: z.array(workflowTransitionSchema) })
  @ApiErrors(400, 401, 404)
  available(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<WorkflowTransition[]> {
    return this.transitions.listFor(user, id);
  }

  @Post(':id/actions/:actionId/press')
  @HttpCode(200)
  @Audit({ action: 'task.action', entity: 'task' })
  @ApiOperation({ summary: 'Нажать действие маршрута: данные окна, статус не меняется' })
  @ApiOkResponse({ standardSchema: executeTransitionResultSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  press(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('actionId', uuid) actionId: string,
    @Body({
      schema: executeTransitionBodySchema,
      pipes: [new ZodValidationPipe(executeTransitionBodySchema)],
    })
    body: ExecuteTransitionBody,
  ): Promise<ExecuteTransitionResult> {
    return this.transitions.pressActionFor(user, id, actionId, body);
  }

  @Post(':id/transitions/:transitionId')
  @HttpCode(200)
  @Audit({ action: 'task.transition', entity: 'task' })
  @ApiOperation({ summary: 'Выполнить переход (окно — form; обход — override + reason)' })
  @ApiOkResponse({ standardSchema: executeTransitionResultSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  execute(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('transitionId', uuid) transitionId: string,
    @Body({
      schema: executeTransitionBodySchema,
      pipes: [new ZodValidationPipe(executeTransitionBodySchema)],
    })
    body: ExecuteTransitionBody,
  ): Promise<ExecuteTransitionResult> {
    return this.transitions.executeFor(user, id, transitionId, body);
  }
}
