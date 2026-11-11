import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateUserPreferencesBodySchema,
  userPreferencesResponseSchema,
  type AuthUser,
  type UpdateUserPreferencesBody,
  type UserPreferencesResponse,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { PreferencesService } from './preferences.service.js';

/**
 * Личные настройки интерфейса (`/api/v1/me/preferences`, #745): навигация
 * и раскладка карточек сотрудника. Субъект — САМ пользователь: id берётся
 * из access-токена (`@GetUser`), из тела/query его взять нельзя; чужие
 * настройки недоступны (I8, IDOR). Мутация — полная замена, идемпотентна
 * (PUT), last-write-wins; доменных событий нет — это не изменение сущности.
 */
@ApiTags('preferences')
@ApiBearerAuth()
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Личные настройки сотрудника (навигация и раскладка карточек)' })
  @ApiOkResponse({ standardSchema: userPreferencesResponseSchema })
  @ApiErrors(401)
  get(@GetUser() user: AuthUser): Promise<UserPreferencesResponse> {
    return this.preferences.get(user.id);
  }

  @Put()
  @HttpCode(200)
  @Audit({ action: 'preferences.update' })
  @ApiOperation({ summary: 'Заменить личные настройки (last-write-wins)' })
  @ApiOkResponse({ standardSchema: userPreferencesResponseSchema })
  @ApiErrors(400, 401, 413)
  @ApiIdempotencyKey()
  put(
    @GetUser() user: AuthUser,
    @Body({
      schema: updateUserPreferencesBodySchema,
      pipes: [new ZodValidationPipe(updateUserPreferencesBodySchema)],
    })
    body: UpdateUserPreferencesBody,
  ): Promise<UserPreferencesResponse> {
    return this.preferences.put(user.id, body.preferences);
  }
}
