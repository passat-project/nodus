import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  cursorQuerySchema,
  paginatedSchema,
  projectMemberAddBodySchema,
  projectMemberSchema,
  type AuthUser,
  type CursorQuery,
  type Paginated,
  type ProjectMember,
  type ProjectMemberAddBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { decodeCursor } from '../../core/pagination/cursor.util.js';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectManualMembersService } from './project-manual-members.service.js';

const idParamSchema = z.uuid();
const membersQuerySchema = cursorQuerySchema;

/**
 * Вкладка «Участники» карточки проекта (#52, Р2): открытый проект — живой
 * состав из задач, вступление своей кнопкой и ручные НАБЛЮДАТЕЛИ; секретный —
 * ручное управление участниками и наблюдателями. Видимость — фильтр сервиса.
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller('projects')
export class ProjectMembersController {
  constructor(
    private readonly members: ProjectMembersService,
    private readonly manual: ProjectManualMembersService,
  ) {}

  @Get(':id/members')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Состав проекта с источниками участия (курсорная пагинация)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(projectMemberSchema) })
  @ApiErrors(400, 401, 404)
  list(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Query({
      schema: membersQuerySchema,
      pipes: [new ZodValidationPipe(membersQuerySchema)],
    })
    query: CursorQuery,
    @GetUser() user: AuthUser,
  ): Promise<Paginated<ProjectMember>> {
    return this.members.members(
      user,
      id,
      query.cursor ? parseCursor(query.cursor) : null,
      query.limit,
    );
  }

  @Post(':id/join')
  @HttpCode(200)
  @Audit({ action: 'project.join', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: '«Присоединиться» (открытый проект, не-участник) — наблюдатель-вступивший',
  })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  join(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.members.join(user, id);
  }

  @Post(':id/leave')
  @HttpCode(200)
  @Audit({ action: 'project.leave', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: '«Покинуть» (свой ряд вступившего наблюдателя)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  leave(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.members.leave(user, id);
  }

  @Post(':id/members')
  @HttpCode(201)
  @Audit({ action: 'project.member_add', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary:
      'Добавить в состав (руководство): секретный — участник/наблюдатель, открытый — наблюдатель',
  })
  @ApiCreatedResponse()
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  add(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: projectMemberAddBodySchema,
      pipes: [new ZodValidationPipe(projectMemberAddBodySchema)],
    })
    dto: ProjectMemberAddBody,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.manual.addManual(user, id, dto.userId, dto.kind);
  }

  @Delete(':id/members/:userId')
  @Audit({ action: 'project.member_remove', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'userId',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary:
      'Убрать ручную роль (руководство): секретный — участника/наблюдателя, открытый — наблюдателя',
  })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404, 422)
  remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('userId', new ZodValidationPipe(idParamSchema)) userId: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.manual.removeManual(user, id, userId);
  }
}

const membersCursorSchema = z.object({ userId: z.uuid(), source: z.string().min(1) });

function parseCursor(cursor: string): { userId: string; source: string } {
  return decodeCursor(cursor, membersCursorSchema);
}
