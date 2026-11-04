import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  letterDetailSchema,
  letterRelationCreateBodySchema,
  letterTreeResponseSchema,
  Permission,
  type AuthUser,
  type LetterDetail,
  type LetterRelationCreateBody,
  type LetterTreeResponse,
} from '@nodus/contracts';
import { z } from 'zod';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { LettersRelationService } from './letters-relation.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/**
 * Связи писем (#461, Р1/Р2): «ответ на» и «вложено в», дерево «ёлочки».
 * Чтение дерева — по видимости письма (невидимый корень — 404 без оракула,
 * дочерние узлы фильтруются той же функцией); мутации — только канцелярия
 * (`correspondence.register`), идемпотентные и аудируемые. Префикс — тот же
 * `/api/v1/letters`, что у карточки.
 */
@ApiTags('correspondence')
@ApiBearerAuth()
@RequireFeature('correspondence')
@Controller('letters')
export class LetterRelationsController {
  constructor(private readonly relations: LettersRelationService) {}

  @Get(':id/tree')
  @ApiOperation({ summary: 'Дерево связей письма: «ответ на» и вложенные (ёлочка)' })
  @ApiOkResponse({ standardSchema: letterTreeResponseSchema })
  @ApiErrors(400, 401, 404)
  tree(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<LetterTreeResponse> {
    return this.relations.treeOf(user, id);
  }

  @Post(':id/relations')
  @HttpCode(200)
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_relation_link', entity: 'letter' })
  @ApiOperation({ summary: 'Связать письма: «ответ на»/«вложено в» (замена — replace)' })
  @ApiOkResponse({ standardSchema: letterDetailSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  link(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: letterRelationCreateBodySchema,
      pipes: [new ZodValidationPipe(letterRelationCreateBodySchema)],
    })
    body: LetterRelationCreateBody,
  ): Promise<LetterDetail> {
    return this.relations.link(user, id, body);
  }

  @Delete(':id/relations/:relationId')
  @HttpCode(204)
  @RequirePermissions(Permission.CORRESPONDENCE_REGISTER)
  @Audit({ action: 'correspondence.letter_relation_unlink', entity: 'letter' })
  @ApiOperation({ summary: 'Снять связь письма (идемпотентно)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  unlink(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('relationId', uuid) relationId: string,
  ): Promise<void> {
    return this.relations.unlink(user, id, relationId);
  }
}
