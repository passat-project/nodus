import { Module } from '@nestjs/common';

import { AiSettingsController } from './providers/ai-settings.controller.js';
import { AiSettingsRepository } from './providers/ai-settings.repository.js';
import { AiSettingsService } from './providers/ai-settings.service.js';

/**
 * ИИ-агент портала (#889, ADR-0043/0044): Ф1 — только чтение.
 *
 * Связность: инструмент = вызов API портала от имени сотрудника через
 * Fastify `inject` (его `Authorization`: те же guard-ы, права и валидация).
 * Чужие модули не импортируются (I3/I6) — второй бизнес-логики нет.
 *
 * Флаг `assistant` (I10) + право `assistant.use` (I8) ставятся на
 * контроллеры диалога; настройки провайдеров — право `portal.settings.manage`.
 */
@Module({
  controllers: [AiSettingsController],
  providers: [AiSettingsRepository, AiSettingsService],
})
export class AssistantModule {}
