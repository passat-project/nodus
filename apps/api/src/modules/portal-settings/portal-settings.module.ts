import { Module } from '@nestjs/common';

import { PortalSettingsController } from './portal-settings.controller.js';
import { PortalSettingsRepository } from './portal-settings.repository.js';
import { PortalSettingsService } from './portal-settings.service.js';

/**
 * Настройки портала (#558, эпик #869): `portal_settings` ключ-значение.
 * Ядро без фичефлага (I10) — настройки нужны всем срезам портала; связность
 * только через `@nodus/contracts`. Мутаций доменных сущностей нет, поэтому
 * событий/outbox нет; запись действия — аудит контроллера.
 */
@Module({
  controllers: [PortalSettingsController],
  providers: [PortalSettingsRepository, PortalSettingsService],
})
export class PortalSettingsModule {}
