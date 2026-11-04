import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  addLetterParticipantBodySchema,
  createLetterFieldsSchema,
  executeLetterTransitionResultSchema,
  executeTransitionBodySchema,
  letterDetailSchema,
  letterHistoryEntrySchema,
  letterListItemSchema,
  letterResolversSchema,
  listLettersQuerySchema,
  paginatedSchema,
  Permission,
  setLetterMainDocumentBodySchema,
  updateLetterBodySchema,
  workflowTransitionSchema,
  type AddLetterParticipantBody,
  type AuthUser,
  type CreateLetterFields,
  type ExecuteLetterTransitionResult,
  type ExecuteTransitionBody,
  type SetLetterMainDocumentBody,
  type UpdateLetterBody,
  type LetterDetail,
  type LetterHistoryEntry,
  type LetterListItem,
  type LetterResolvers,
  type ListLettersQuery,
  type Paginated,
  type WorkflowTransition,
} from '@nodus/contracts';
import type { FastifyRequest } from 'fastify';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { ErrorCode } from '@nodus/contracts';
import { LetterHistoryService } from '../history/letter-history.service.js';
import { LettersMainDocumentService } from './letters-main-document.service.js';
import { LettersManualCreateService } from './letters-manual-create.service.js';
import { LettersMutationService } from './letters-mutation.service.js';
import { LettersQueryService } from './letters-query.service.js';
import { readLetterMultipart } from './letter-upload.js';
import { LetterTransitionsService } from '../workflow/letter-transitions.service.js';

const uuid = new ZodValidationPipe(z.uuid());
const historyQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * Письма (`/api/v1/letters`, #55): «Новые», «Входящие», «Исходящие»,
 * карточка, ручное создание (multipart), правка реквизитов (редизайн #56 —
 * и незарегистрированного по месту в карточке), спам, присоединение к
 * обсуждению и приглашение коллег, личный признак «просмотрено», кнопки
 * маршрута и история. Связи «ответ на»/«вложено в» и дерево «ёлочки» (#461) —
 * отдельный `LetterRelationsController` того же префикса. Модуль за флагом
 * `correspondence` (I10).
 */
@ApiTags('correspondence')
@ApiBearerAuth()
@RequireFeature('correspondence')
@Controller('letters')
export class LettersController {
  constructor(
    private readonly query: LettersQueryService,
    private readonly mutations: LettersMutationService,
    private readonly manualCreate: LettersManualCreateService,
    private readonly mainDocument: LettersMainDocumentService,
    private readonly transitions: LetterTransitionsService,
    private readonly history: LetterHistoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список писем: box=new|incoming|outgoing, поиск, курсор' })
  @ApiOkResponse({ standardSchema: paginatedSchema(letterListItemSchema) })
  @ApiErrors(400, 401, 403)
  list(
    @GetUser() user: AuthUser,
    @Query({
      schema: listLettersQuerySchema,
      pipes: [new ZodValidationPipe(listLettersQuerySchema)],
    })
    q: ListLettersQuery,
  ): Promise<Paginated<LetterListItem>> {
    return this.query.list(user, q);
  }

  @Get('resolvers')
  @ApiOperation({ summary: 'Адресаты «Принимают решения» (держатели correspondence.resolve)' })
  @ApiOkResponse({ standardSchema: letterResolversSchema })
  @ApiErrors(401)
  resolvers(): Promise<LetterResolvers> {
    return this.query.resolvers();
  }

  @Post()
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_create', entity: 'letter' })
  @ApiOperation({ summary: 'Ручное создание входящего (multipart: typeId, mainIndex, файлы)' })
  @ApiCreatedResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 403, 404, 413)
  @ApiIdempotencyKey()
  async create(@GetUser() user: AuthUser, @Req() request: FastifyRequest): Promise<LetterDetail> {
    const body = await readLetterMultipart(request);
    try {
      const parsed = createLetterFieldsSchema.safeParse(body.fields);
      if (!parsed.success) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid letter fields', {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      }
      const fields: CreateLetterFields = parsed.data;
      return await this.manualCreate.create(user, fields, body.files);
    } finally {
      await body.cleanup();
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка письма' })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 404)
  detail(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<LetterDetail> {
    return this.query.detail(user, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_update', entity: 'letter' })
  @ApiOperation({ summary: 'Правка реквизитов письма (адресат — только до регистрации)' })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  update(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: updateLetterBodySchema,
      pipes: [new ZodValidationPipe(updateLetterBodySchema)],
    })
    body: UpdateLetterBody,
  ): Promise<LetterDetail> {
    return this.mutations.update(user, id, body);
  }

  @Post(':id/main-document')
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_main_document', entity: 'letter' })
  @ApiOperation({
    summary: 'Выбрать основной документ (звезда, только до регистрации; идемпотентно)',
  })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  setMainDocument(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: setLetterMainDocumentBodySchema,
      pipes: [new ZodValidationPipe(setLetterMainDocumentBodySchema)],
    })
    body: SetLetterMainDocumentBody,
  ): Promise<LetterDetail> {
    return this.mainDocument.set(user, id, body.attachmentId);
  }

  @Post(':id/view')
  @HttpCode(204)
  @ApiOperation({ summary: 'Отметить письмо просмотренным (личный признак, идемпотентно)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 404)
  view(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.mutations.markViewed(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_spam_deleted', entity: 'letter' })
  @ApiOperation({ summary: 'Удалить как спам (только «Новое», физически)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  remove(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.mutations.deleteSpam(user, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  @Audit({ action: 'correspondence.letter_join', entity: 'letter' })
  @ApiOperation({ summary: 'Присоединиться к обсуждению (идемпотентно)' })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  join(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<LetterDetail> {
    return this.mutations.join(user, id);
  }

  @Post(':id/participants')
  @HttpCode(200)
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_participants_add', entity: 'letter' })
  @ApiOperation({ summary: 'Пригласить коллегу в обсуждение (идемпотентно)' })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  addParticipant(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: addLetterParticipantBodySchema,
      pipes: [new ZodValidationPipe(addLetterParticipantBodySchema)],
    })
    body: AddLetterParticipantBody,
  ): Promise<LetterDetail> {
    return this.mutations.addParticipants(user, id, body.userIds);
  }

  @Get(':id/transitions')
  @ApiOperation({ summary: 'Кнопки маршрута письма (условия и окна)' })
  @ApiOkResponse({ standardSchema: z.array(workflowTransitionSchema) })
  @ApiErrors(400, 401, 404)
  available(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<WorkflowTransition[]> {
    return this.transitions.available(user, id);
  }

  @Post(':id/transitions/:transitionId')
  @HttpCode(200)
  @Audit({ action: 'correspondence.letter_transition', entity: 'letter' })
  @ApiOperation({ summary: 'Выполнить переход (регистрация выдаёт номер)' })
  @ApiOkResponse({ standardSchema: executeLetterTransitionResultSchema })
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
  ): Promise<ExecuteLetterTransitionResult> {
    return this.transitions.execute(user, id, transitionId, body);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'История письма (event log, курсор)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(letterHistoryEntrySchema) })
  @ApiErrors(400, 401, 404)
  historyPage(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query({ schema: historyQuery, pipes: [new ZodValidationPipe(historyQuery)] })
    q: z.infer<typeof historyQuery>,
  ): Promise<Paginated<LetterHistoryEntry>> {
    return this.history.list(user, id, q.cursor, q.limit);
  }
}
