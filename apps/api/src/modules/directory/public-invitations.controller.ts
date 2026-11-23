import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  acceptInvitationSchema,
  acceptPasswordResetSchema,
  acceptResponseSchema,
  invitationInfoSchema,
  passwordResetInfoSchema,
  type AcceptInvitationDto,
  type AcceptPasswordResetDto,
  type AcceptResponse,
  type InvitationInfo,
  type PasswordResetInfo,
} from '@nodus/contracts';

import { Public } from '../../core/decorators/public.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { InvitationAcceptService } from './invitation-accept.service.js';

/**
 * Публичные страницы приглашения и сброса пароля (#101): без аутентификации,
 * токен в пути — одноразовый, одноразовый расход и троттлинг в сервисе.
 * Публичные префиксы исключены из idempotency-кэша (сырой токен не должен
 * лежать в Redis): повтор accept с тем же телом отвергается кодом
 * `INVITATION_ALREADY_USED`.
 */
@Public()
@ApiTags('directory')
@Controller()
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationAcceptService) {}

  @Get('invitations/:token')
  @ApiOperation({ summary: 'Информация приглашения по одноразовой ссылке' })
  @ApiParam({ name: 'token', description: 'Одноразовый токен из ссылки' })
  @ApiOkResponse({ standardSchema: invitationInfoSchema })
  @ApiErrors(400, 409, 429)
  invitationInfo(@Param('token') token: string): Promise<InvitationInfo> {
    return this.invitations.invitationInfo(token);
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Принятие приглашения: сверка почты, пароль, активация' })
  @ApiParam({ name: 'token', description: 'Одноразовый токен из ссылки' })
  @ApiOkResponse({ standardSchema: acceptResponseSchema })
  @ApiErrors(400, 409, 429)
  acceptInvitation(
    @Param('token') token: string,
    @Body({
      schema: acceptInvitationSchema,
      pipes: [new ZodValidationPipe(acceptInvitationSchema)],
    })
    dto: AcceptInvitationDto,
  ): Promise<AcceptResponse> {
    return this.invitations.acceptInvitation(token, dto);
  }

  @Get('password-resets/:token')
  @ApiOperation({ summary: 'Информация сброса пароля по одноразовой ссылке' })
  @ApiParam({ name: 'token', description: 'Одноразовый токен из ссылки' })
  @ApiOkResponse({ standardSchema: passwordResetInfoSchema })
  @ApiErrors(400, 409, 429)
  passwordResetInfo(@Param('token') token: string): Promise<PasswordResetInfo> {
    return this.invitations.passwordResetInfo(token);
  }

  @Post('password-resets/:token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Новый пароль по ссылке сброса (авто-вход на фронте)' })
  @ApiParam({ name: 'token', description: 'Одноразовый токен из ссылки' })
  @ApiOkResponse({ standardSchema: acceptResponseSchema })
  @ApiErrors(400, 409, 429)
  acceptPasswordReset(
    @Param('token') token: string,
    @Body({
      schema: acceptPasswordResetSchema,
      pipes: [new ZodValidationPipe(acceptPasswordResetSchema)],
    })
    dto: AcceptPasswordResetDto,
  ): Promise<AcceptResponse> {
    return this.invitations.acceptPasswordReset(token, dto);
  }
}
