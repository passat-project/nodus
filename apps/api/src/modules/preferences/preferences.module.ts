import { Module } from '@nestjs/common';

import { PreferencesController } from './preferences.controller.js';
import { PreferencesRepository } from './preferences.repository.js';
import { PreferencesService } from './preferences.service.js';

/**
 * Личные настройки интерфейса (#745): `/me/preferences`. Ядро, без
 * фичефлага (I10): настройки нужны каждой карточке. Связность — только
 * `@nodus/contracts`; таблица `user_preferences` принадлежит модулю,
 * users — plain UUID (I3). Мутаций доменных сущностей нет, поэтому событий
 * и outbox нет; запись действия — аудит контроллера.
 */
@Module({
  controllers: [PreferencesController],
  providers: [PreferencesRepository, PreferencesService],
})
export class PreferencesModule {}
