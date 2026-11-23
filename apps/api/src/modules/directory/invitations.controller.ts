import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  createInvitationSchema,
  invitationCreatedSchema,
  issuePasswordResetResponseSchema,
  Permission,
  type AuthUser,
  type CreateInvitationDto,
  type InvitationCreated,
  type IssuePasswordResetResponse,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Админские действия с приглашением и сбросом пароля (#101), право
 * `directory.manage` (I8). Идентификатор в ответе — id сотрудника (тело или
 * `:id`): журнал аудита получает связь с сущностью.
 */
@ApiTags('directory')
@ApiBearerAuth()
@Controller('directory')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('invitations')
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.invitation.create', entity: 'user' })
  @ApiOperation({ summary: 'Пригласить сотрудника по одноразовой ссылке (7 дней)' })
  @ApiCreatedResponse({ standardSchema: invitationCreatedSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  create(
    @Body({
      schema: createInvitationSchema,
      pipes: [new ZodValidationPipe(createInvitationSchema)],
    })
    dto: CreateInvitationDto,
    @GetUser() actor: AuthUser,
  ): Promise<InvitationCreated> {
    return this.invitations.createInvitation(dto, actor);
  }

  @Post('invitations/:id/reissue')
  @HttpCode(200)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.invitation.reissue', entity: 'user' })
  @ApiOperation({ summary: 'Перевыпуск ссылки-приглашения (прежняя гаснет)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: invitationCreatedSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  reissue(@Param('id') id: string, @GetUser() actor: AuthUser): Promise<InvitationCreated> {
    return this.invitations.reissueInvitation(id, actor);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.invitation.cancel', entity: 'user' })
  @ApiOperation({ summary: 'Отменить приглашение (ссылка гаснет, строка исчезает/«Уволен»)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  cancel(@Param('id') id: string, @GetUser() actor: AuthUser): Promise<void> {
    return this.invitations.cancelInvitation(id, actor);
  }

  @Post('users/:id/password-reset')
  @HttpCode(200)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.user.password_reset', entity: 'user' })
  @ApiOperation({ summary: 'Ссылка сброса пароля на 24 часа (действующий/уволенный)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: issuePasswordResetResponseSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  issuePasswordReset(
    @Param('id') id: string,
    @GetUser() actor: AuthUser,
  ): Promise<IssuePasswordResetResponse> {
    return this.invitations.issuePasswordReset(id, actor);
  }
}
