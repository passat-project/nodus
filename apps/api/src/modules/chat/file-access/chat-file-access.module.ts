import { Global, Module } from '@nestjs/common';

import { ChatFileAccess } from './chat-file-access.provider.js';
import { ChatFileAccessRepository } from './chat-file-access.repository.js';

/**
 * @Global-мост прав chat → files (#138, I3/I6): контрибьютор объявляет
 * маркер `fileAccessContext = 'chat'`, реестр `FileAccessRegistry` находит
 * его через DiscoveryService (с #55 вместо multi-токена). Самодостаточен
 * (свой репозиторий на PrismaService из @Global DatabaseModule) —
 * провайдеров ChatModule не тянет.
 *
 * #433: доступ решающего к вложениям задачи — отдельный контрибьютор в
 * ChatModule (`TaskDeciderFileAccess`): здесь нельзя зависеть от TasksPorts,
 * иначе модуль перестаёт быть самодостаточным.
 *
 * exports ОБЯЗАТЕЛЕН: глобальны только ЭКСПОРТИРОВАННЫЕ провайдеры @Global-
 * модуля (урок 29.09: без exports реестр не видел контрибьютора и доступ
 * падал до owner-only — Regress-замок в chat-file-access.module.test.ts).
 */
@Global()
@Module({
  providers: [ChatFileAccessRepository, ChatFileAccess],
  exports: [ChatFileAccess],
})
export class ChatFileAccessModule {}
