import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  Permission,
  changeTaskTypeBodySchema,
  createSubtaskBodySchema,
  createTaskBodySchema,
  formulaBodySchema,
  formulaResponseSchema,
  listTasksQuerySchema,
  paginatedSchema,
  taskBranchSchema,
  taskBulkBodySchema,
  taskBulkResultSchema,
  taskDetailSchema,
  taskListItemSchema,
  taskStageWithCountSchema,
  taskUpdateBodySchema,
  type AuthUser,
  type ChangeTaskTypeBody,
  type CreateSubtaskBody,
  type CreateTaskBody,
  type FormulaBody,
  type FormulaResponse,
  type ListTasksQuery,
  type Paginated,
  type TaskBranch,
  type TaskBulkBody,
  type TaskBulkResult,
  type TaskDetail,
  type TaskListItem,
  type TaskStageWithCount,
  type TaskUpdateBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { BulkService } from '../bulk/bulk.service.js';
import { TaskTypeChangeService } from '../types/task-type-change.service.js';
import { TaskEditService } from './task-edit.service.js';
import { TaskFormulaService } from './task-formula.service.js';
import { TasksQueryService } from './tasks-query.service.js';
import { TasksService } from './tasks.service.js';

const uuid = new ZodValidationPipe(z.uuid());
const scopeQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  typeId: z.uuid().optional(),
});

/**
 * Задачи (`/api/v1/tasks`, #37): фиды обеих осей, каталоги, CRUD, ветка,
 * подзадачи, массовые операции. Модуль за флагом `tasks` (I10).
 */
@ApiTags('tasks')
@ApiBearerAuth()
@RequireFeature('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly edit: TaskEditService,
    private readonly query: TasksQueryService,
    private readonly bulk: BulkService,
    private readonly typeChange: TaskTypeChangeService,
    private readonly formulas: TaskFormulaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список/фид колонки задач (курсор, видимость, фильтры)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(taskListItemSchema) })
  @ApiErrors(400, 401)
  list(
    @GetUser() user: AuthUser,
    @Query({ schema: listTasksQuerySchema, pipes: [new ZodValidationPipe(listTasksQuerySchema)] })
    q: ListTasksQuery,
  ): Promise<Paginated<TaskListItem>> {
    return this.query.list(user, q);
  }

  @Get('stages')
  @ApiOperation({
    summary: 'Стадии со счётчиками: ?typeId= — одного типа; без — всех живых типов',
  })
  @ApiOkResponse({ standardSchema: z.array(taskStageWithCountSchema) })
  @ApiErrors(400, 401)
  stages(
    @GetUser() user: AuthUser,
    @Query({ schema: scopeQuery, pipes: [new ZodValidationPipe(scopeQuery)] })
    q: z.infer<typeof scopeQuery>,
  ): Promise<TaskStageWithCount[]> {
    return this.query.stages(user, q.scope, q.typeId);
  }

  @Post(':id/type')
  @HttpCode(200)
  @Audit({ action: 'task.type_change', entity: 'task' })
  @ApiOperation({
    summary: 'Смена типа (право правки; без текущего статуса в новом маршруте — stageId)',
  })
  @ApiOkResponse({ standardSchema: taskListItemSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  changeType(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: changeTaskTypeBodySchema,
      pipes: [new ZodValidationPipe(changeTaskTypeBodySchema)],
    })
    body: ChangeTaskTypeBody,
  ): Promise<TaskListItem> {
    return this.typeChange.change(user, id, body);
  }

  @Post()
  @RequirePermissions(Permission.TASK_CREATE)
  @Audit({ action: 'task.create', entity: 'task' })
  @ApiOperation({ summary: 'Создание задачи (проект и колонка необязательны)' })
  @ApiCreatedResponse({ standardSchema: taskListItemSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  create(
    @GetUser() user: AuthUser,
    @Body({ schema: createTaskBodySchema, pipes: [new ZodValidationPipe(createTaskBodySchema)] })
    body: CreateTaskBody,
  ): Promise<TaskListItem> {
    return this.tasks.create(user, body);
  }

  @Post('bulk')
  @HttpCode(200)
  @Audit({ action: 'task.bulk', entity: 'task' })
  @ApiOperation({ summary: 'Массовая операция (до 100 задач, результат по каждой)' })
  @ApiOkResponse({ standardSchema: taskBulkResultSchema })
  @ApiErrors(400, 401)
  @ApiIdempotencyKey()
  runBulk(
    @GetUser() user: AuthUser,
    @Body({ schema: taskBulkBodySchema, pipes: [new ZodValidationPipe(taskBulkBodySchema)] })
    body: TaskBulkBody,
  ): Promise<TaskBulkResult> {
    return this.bulk.run(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка задачи' })
  @ApiOkResponse({ standardSchema: taskDetailSchema })
  @ApiErrors(400, 401, 404)
  detail(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<TaskDetail> {
    return this.query.detail(user, id);
  }

  @Patch(':id')
  @HttpCode(200)
  @Audit({ action: 'task.update', entity: 'task' })
  @ApiOperation({ summary: 'Правка полей и перенос по осям (перенос = переход маршрута)' })
  @ApiOkResponse({ standardSchema: taskListItemSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  update(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({ schema: taskUpdateBodySchema, pipes: [new ZodValidationPipe(taskUpdateBodySchema)] })
    body: TaskUpdateBody,
  ): Promise<TaskListItem> {
    return this.edit.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Audit({ action: 'task.delete', entity: 'task' })
  @ApiOperation({ summary: 'Удаление задачи (мягкое; подзадачи поднимаются к деду)' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  remove(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.tasks.remove(user, id);
  }

  @Get(':id/custom-fields/:fieldId/formula')
  @ApiOperation({ summary: 'Эффективная формула ячейки атрибута (своя или типа)' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 404)
  formula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
  ): Promise<FormulaResponse> {
    return this.formulas.read(user, id, fieldId);
  }

  @Put(':id/custom-fields/:fieldId/formula')
  @HttpCode(200)
  @Audit({ action: 'custom_field.formula_set', entity: 'task' })
  @ApiOperation({ summary: 'Поставить формулу в ячейку атрибута задачи' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  setFormula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body({ schema: formulaBodySchema, pipes: [new ZodValidationPipe(formulaBodySchema)] })
    body: FormulaBody,
  ): Promise<FormulaResponse> {
    return this.formulas.save(user, id, fieldId, body.ast);
  }

  @Delete(':id/custom-fields/:fieldId/formula')
  @HttpCode(204)
  @Audit({ action: 'custom_field.formula_remove', entity: 'task' })
  @ApiOperation({ summary: 'Снять формулу (значение-снимок остаётся)' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeFormula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
  ): Promise<void> {
    return this.formulas.remove(user, id, fieldId);
  }

  @Get(':id/branch')
  @ApiOperation({ summary: 'Ветка задачи от корневого предка' })
  @ApiOkResponse({ standardSchema: taskBranchSchema })
  @ApiErrors(400, 401, 404)
  branch(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<TaskBranch> {
    return this.query.branch(user, id);
  }

  @Post(':id/subtasks')
  @RequirePermissions(Permission.TASK_CREATE)
  @Audit({ action: 'task.create', entity: 'task' })
  @ApiOperation({ summary: 'Подзадача (ответственный по умолчанию — постановщик)' })
  @ApiCreatedResponse({ standardSchema: taskListItemSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  subtask(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: createSubtaskBodySchema,
      pipes: [new ZodValidationPipe(createSubtaskBodySchema)],
    })
    body: CreateSubtaskBody,
  ): Promise<TaskListItem> {
    return this.tasks.create(user, { ...body, parentId: id });
  }
}
