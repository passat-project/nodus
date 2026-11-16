import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  fileServersBodySchema,
  fileServersResponseSchema,
  Permission,
  type FileServersBody,
  type FileServersResponse,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { PortalSettingsService } from './portal-settings.service.js';

/**
 * Настройки портала (`/api/v1/settings`, эпик #869): первая версия —
 * «Файловые серверы» (#558), разрешённые папки для действий с путём в
 * десктоп-приложении. Чтение — всем аутентифицированным (веб решает,
 * показывать ли «Открыть»); запись — правом `portal.settings.manage`
 * (I8; выдаётся матрицей «Права доступа»).
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class PortalSettingsController {
  constructor(private readonly settings: PortalSettingsService) {}

  @Get('file-servers')
  @ApiOperation({ summary: 'Разрешённые файловые серверы (папки \\\\server\\share)' })
  @ApiOkResponse({ standardSchema: fileServersResponseSchema })
  @ApiErrors(401)
  getFileServers(): Promise<FileServersResponse> {
    return this.settings.getFileServers();
  }

  @Put('file-servers')
  @HttpCode(200)
  @RequirePermissions(Permission.PORTAL_SETTINGS_MANAGE)
  @Audit({ action: 'settings.file_servers_update' })
  @ApiOperation({ summary: 'Заменить список файловых серверов' })
  @ApiOkResponse({ standardSchema: fileServersResponseSchema })
  @ApiErrors(400, 401, 403, 413)
  @ApiIdempotencyKey()
  putFileServers(
    @Body({
      schema: fileServersBodySchema,
      pipes: [new ZodValidationPipe(fileServersBodySchema)],
    })
    body: FileServersBody,
  ): Promise<FileServersResponse> {
    return this.settings.putFileServers(body.servers);
  }
}
