import { Module } from '@nestjs/common';

import { AgentRunnerService } from './agent/agent-runner.service.js';
import { AssistantRepository } from './assistant.repository.js';
import { AssistantRunsController } from './assistant-runs.controller.js';
import { AssistantRunsService } from './assistant-runs.service.js';
import { AssistantSessionsController } from './assistant-sessions.controller.js';
import { AssistantSessionsService } from './assistant-sessions.service.js';
import { AiSettingsController } from './providers/ai-settings.controller.js';
import { AiSettingsRepository } from './providers/ai-settings.repository.js';
import { AiSettingsService } from './providers/ai-settings.service.js';
import { McpSettingsController } from './mcp/mcp-settings.controller.js';
import { McpSettingsRepository } from './mcp/mcp-settings.repository.js';
import { McpSettingsService } from './mcp/mcp-settings.service.js';
import { RunBusService } from './run-bus.service.js';
import { ToolExecutorService } from './tools/tool-executor.service.js';

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
  controllers: [
    AssistantSessionsController,
    AssistantRunsController,
    AiSettingsController,
    McpSettingsController,
  ],
  providers: [
    AssistantRepository,
    RunBusService,
    AssistantSessionsService,
    AssistantRunsService,
    AgentRunnerService,
    ToolExecutorService,
    AiSettingsRepository,
    AiSettingsService,
    McpSettingsRepository,
    McpSettingsService,
  ],
})
export class AssistantModule {}
