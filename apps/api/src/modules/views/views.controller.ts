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
  createListExportBodySchema,
  createListExportResultSchema,
  createSavedViewBodySchema,
  listExportStatusSchema,
  savedViewSchema,
  updateSavedViewBodySchema,
  type AuthUser,
  type CreateListExportBody,
  type CreateListExportResult,
  type CreateSavedViewBody,
  type ListExportStatus,
  type SavedView,
  type UpdateSavedViewBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { ListExportService } from './list-export.service.js';
import { SavedViewsService } from './saved-views.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/** Рамка чтения настроек: журнал / проект / тип (каталог настройщика). */
const viewsQuerySchema = z
  .object({
    journal: z.enum(['true', 'false']).optional(),
    projectId: z.uuid().optional(),
    typeId: z.uuid().optional(),
    entity: z.enum(['task', 'letter', 'folder']).optional(),
  })
  .refine(
    (q) =>
      Number(Boolean(q.journal)) + Number(Boolean(q.projectId)) + Number(Boolean(q.typeId)) === 1,
    {
      message: 'ровно одна рамка: journal | projectId | typeId',
    },
  );

/**
 * Сохранённые настройки списков и выгрузка CSV (`/api/v1/views`, #435).
 * Настройка — не сущность данных: события не эмитируются (I13), мутации — в
 * аудит, удаление физическое. Фичафлага нет: views — платформенная механика
 * списков (ядро), работает при любом наборе модулей (источники сущностей
 * регистрируются своими портами).
 */
@ApiTags('views')
@ApiBearerAuth()
@Controller('views')
export class ViewsController {
  constructor(
    private readonly views: SavedViewsService,
    private readonly exports: ListExportService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Настройки рамки: ?journal=true (личные), ?projectId= (общие + личные + списки типов проекта), ?typeId= (настройщик)',
  })
  @ApiOkResponse({ standardSchema: z.array(savedViewSchema) })
  @ApiErrors(400, 401, 403, 404)
  list(
    @GetUser() user: AuthUser,
    @Query({ schema: viewsQuerySchema, pipes: [new ZodValidationPipe(viewsQuerySchema)] })
    q: z.infer<typeof viewsQuerySchema>,
  ): Promise<SavedView[]> {
    if (q.projectId) {
      return this.views.list(user, {
        kind: 'project',
        projectId: q.projectId,
        ...(q.entity ? { entity: q.entity } : {}),
      });
    }
    if (q.typeId) {
      return this.views.list(user, { kind: 'type', typeId: q.typeId });
    }
    return this.views.list(user, {
      kind: 'journal',
      ...(q.entity ? { entity: q.entity } : {}),
    });
  }

  @Post()
  @Audit({ action: 'saved_view.create', entity: 'saved_view' })
  @ApiOperation({
    summary:
      'Сохранить настройку (личная — участник рамки; проектная общая — руководство; типа — workflow.manage)',
  })
  @ApiCreatedResponse({ standardSchema: savedViewSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  create(
    @GetUser() user: AuthUser,
    @Body({
      schema: createSavedViewBodySchema,
      pipes: [new ZodValidationPipe(createSavedViewBodySchema)],
    })
    body: CreateSavedViewBody,
  ): Promise<SavedView> {
    return this.views.create(user, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @Audit({ action: 'saved_view.update', entity: 'saved_view' })
  @ApiOperation({ summary: 'Правка настройки (владелец/руководство/настройщик; рамку не меняют)' })
  @ApiOkResponse({ standardSchema: savedViewSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  update(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: updateSavedViewBodySchema,
      pipes: [new ZodValidationPipe(updateSavedViewBodySchema)],
    })
    body: UpdateSavedViewBody,
  ): Promise<SavedView> {
    return this.views.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Audit({ action: 'saved_view.delete', entity: 'saved_view' })
  @ApiOperation({ summary: 'Удалить настройку (физически; вид — не данные)' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  remove(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.views.remove(user, id);
  }

  @Post('export')
  @HttpCode(200)
  @Audit({ action: 'saved_view.export', entity: 'saved_view' })
  @ApiOperation({
    summary:
      'Выгрузка CSV (до 1000 строк — done+ссылка сразу; больше — фоновая очередь, статус по exportId)',
  })
  @ApiOkResponse({ standardSchema: createListExportResultSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  export(
    @GetUser() user: AuthUser,
    @Body({
      schema: createListExportBodySchema,
      pipes: [new ZodValidationPipe(createListExportBodySchema)],
    })
    body: CreateListExportBody,
  ): Promise<CreateListExportResult> {
    return this.exports.create(user, body);
  }

  @Get('export/:id')
  @ApiOperation({ summary: 'Статус фоновой выгрузки (done → fileId и ссылка)' })
  @ApiOkResponse({ standardSchema: listExportStatusSchema })
  @ApiErrors(400, 401, 404)
  exportStatus(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ListExportStatus> {
    return this.exports.statusOf(user, id);
  }
}
