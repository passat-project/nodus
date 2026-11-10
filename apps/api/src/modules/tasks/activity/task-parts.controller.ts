import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  checklistItemCreateBodySchema,
  checklistItemSchema,
  checklistItemUpdateBodySchema,
  cursorQuerySchema,
  lockReasonQuerySchema,
  paginatedSchema,
  taskDetailSchema,
  taskHistoryItemSchema,
  taskParticipantAddBodySchema,
  taskRelationCreateBodySchema,
  taskRelationSchema,
  taskResultCreateBodySchema,
  taskResultSchema,
  type AuthUser,
  type ChecklistItem,
  type ChecklistItemCreateBody,
  type ChecklistItemUpdateBody,
  type CursorQuery,
  type LockReasonQuery,
  type Paginated,
  type TaskDetail,
  type TaskHistoryItem,
  type TaskParticipantAddBody,
  type TaskRelation,
  type TaskRelationCreateBody,
  type TaskResult,
  type TaskResultCreateBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { ChecklistService } from '../checklist/checklist.service.js';
import { ParticipantsService } from '../participants/participants.service.js';
import { HistoryService } from './history.service.js';
import { RelationsService } from './relations.service.js';
import { ResultsService } from './results.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/** Части карточки задачи: участники, чек-лист, связи, результат, история. */
@ApiTags('tasks')
@ApiBearerAuth()
@RequireFeature('tasks')
@Controller('tasks/:id')
export class TaskPartsController {
  constructor(
    private readonly participants: ParticipantsService,
    private readonly checklist: ChecklistService,
    private readonly relations: RelationsService,
    private readonly results: ResultsService,
    private readonly history: HistoryService,
  ) {}

  @Post('participants')
  @Audit({ action: 'task.participant_add', entity: 'task' })
  @ApiOperation({ summary: 'Добавить соисполнителя/наблюдателя (или сменить роль)' })
  @ApiCreatedResponse({ standardSchema: taskDetailSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  addParticipant(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: taskParticipantAddBodySchema,
      pipes: [new ZodValidationPipe(taskParticipantAddBodySchema)],
    })
    body: TaskParticipantAddBody,
  ): Promise<TaskDetail> {
    return this.participants.add(user, id, body);
  }

  @Delete('participants/:userId')
  @HttpCode(200)
  @Audit({ action: 'task.participant_remove', entity: 'task' })
  @ApiOperation({
    summary: 'Снять участника (наблюдатель — сам себя); null — задача больше не видна',
  })
  @ApiOkResponse({ standardSchema: taskDetailSchema.nullable() })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeParticipant(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Query({
      schema: lockReasonQuerySchema,
      pipes: [new ZodValidationPipe(lockReasonQuerySchema)],
    })
    q: LockReasonQuery,
  ): Promise<TaskDetail | null> {
    return this.participants.remove(user, id, userId, q.lockReason);
  }

  @Post('checklist')
  @Audit({ action: 'task.checklist_add', entity: 'task' })
  @ApiOperation({ summary: 'Пункт чек-листа' })
  @ApiCreatedResponse({ standardSchema: checklistItemSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  addItem(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: checklistItemCreateBodySchema,
      pipes: [new ZodValidationPipe(checklistItemCreateBodySchema)],
    })
    body: ChecklistItemCreateBody,
  ): Promise<ChecklistItem> {
    return this.checklist.add(user, id, body);
  }

  @Patch('checklist/:itemId')
  @HttpCode(200)
  @Audit({ action: 'task.checklist_update', entity: 'task' })
  @ApiOperation({ summary: 'Отметка/правка/перестановка пункта' })
  @ApiOkResponse({ standardSchema: checklistItemSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  updateItem(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body({
      schema: checklistItemUpdateBodySchema,
      pipes: [new ZodValidationPipe(checklistItemUpdateBodySchema)],
    })
    body: ChecklistItemUpdateBody,
  ): Promise<ChecklistItem> {
    return this.checklist.update(user, id, itemId, body);
  }

  @Delete('checklist/:itemId')
  @HttpCode(204)
  @Audit({ action: 'task.checklist_remove', entity: 'task' })
  @ApiOperation({ summary: 'Удалить пункт чек-листа' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeItem(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
  ): Promise<void> {
    return this.checklist.remove(user, id, itemId);
  }

  @Get('relations')
  @ApiOperation({ summary: 'Связи задачи (только с видимыми задачами)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(taskRelationSchema) })
  @ApiErrors(400, 401, 404)
  listRelations(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<Paginated<TaskRelation>> {
    return this.relations.list(user, id);
  }

  @Post('relations')
  @Audit({ action: 'task.relation_add', entity: 'task' })
  @ApiOperation({ summary: 'Связать с задачей' })
  @ApiCreatedResponse({ standardSchema: paginatedSchema(taskRelationSchema) })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  addRelation(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: taskRelationCreateBodySchema,
      pipes: [new ZodValidationPipe(taskRelationCreateBodySchema)],
    })
    body: TaskRelationCreateBody,
  ): Promise<Paginated<TaskRelation>> {
    return this.relations.add(user, id, body);
  }

  @Delete('relations/:relationId')
  @HttpCode(204)
  @Audit({ action: 'task.relation_remove', entity: 'task' })
  @ApiOperation({ summary: 'Убрать связь' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeRelation(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('relationId', uuid) relationId: string,
  ): Promise<void> {
    return this.relations.remove(user, id, relationId);
  }

  @Get('results')
  @ApiOperation({ summary: 'Ревизии результата (свежие первыми)' })
  @ApiOkResponse({ standardSchema: z.array(taskResultSchema) })
  @ApiErrors(400, 401, 404)
  listResults(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<TaskResult[]> {
    return this.results.list(user, id);
  }

  @Post('results')
  @Audit({ action: 'task.result_set', entity: 'task' })
  @ApiOperation({ summary: 'Новая ревизия результата' })
  @ApiCreatedResponse({ standardSchema: taskResultSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  addResult(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: taskResultCreateBodySchema,
      pipes: [new ZodValidationPipe(taskResultCreateBodySchema)],
    })
    body: TaskResultCreateBody,
  ): Promise<TaskResult> {
    return this.results.add(user, id, body);
  }

  @Get('history')
  @ApiOperation({ summary: 'История задачи (event log, курсор)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(taskHistoryItemSchema) })
  @ApiErrors(400, 401, 404)
  listHistory(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query({ schema: cursorQuerySchema, pipes: [new ZodValidationPipe(cursorQuerySchema)] })
    q: CursorQuery,
  ): Promise<Paginated<TaskHistoryItem>> {
    return this.history.list(user, id, q.cursor, q.limit);
  }
}
