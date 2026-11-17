import { chatTools } from './definitions/chat.tools.js';
import { chatWriteTools } from './definitions/chat-write.tools.js';
import { dictionariesTools } from './definitions/dictionaries.tools.js';
import { directoryTools } from './definitions/directory.tools.js';
import { filesTools } from './definitions/files.tools.js';
import { lettersTools } from './definitions/letters.tools.js';
import { lettersWriteTools } from './definitions/letters-write.tools.js';
import { meTools } from './definitions/me.tools.js';
import { memoryTools } from './definitions/memory.tools.js';
import { projectsTools } from './definitions/projects.tools.js';
import { projectsWriteTools } from './definitions/projects-write.tools.js';
import { systemTools } from './definitions/system.tools.js';
import { tasksTools } from './definitions/tasks.tools.js';
import { tasksTransitionTools } from './definitions/tasks-transition.tools.js';
import { tasksWriteTools } from './definitions/tasks-write.tools.js';
import { workflowsTools } from './definitions/workflows.tools.js';
import type { AssistantToolDefinition } from './tool-definition.js';

/**
 * Каталог инструментов ИИ-агента (ADR-0043): один список — три потребителя
 * (внутренний чат, будущий MCP-сервер, подсказки в UI). Ф2 добавила запись —
 * она попадает к модели, но исполняется ТОЛЬКО карточкой подтверждения
 * (ADR-0048), а не прямым вызовом из цикла.
 *
 * Фильтры каталога — единственное место выдачи инструментов сотруднику:
 * 1) у `kind: write` обязательна карточка подтверждения — инструмент без
 *    неё в каталог не попадает (жёсткая проверка, не в промпте);
 * 2) право инструмента (сверх `assistant.use`): нет права — нет инструмента;
 * 3) флаг модуля-владельца: выключенный модуль не отдаёт свои инструменты.
 */
export const ALL_TOOLS: readonly AssistantToolDefinition[] = [
  ...tasksTools,
  ...tasksTransitionTools,
  ...tasksWriteTools,
  ...projectsTools,
  ...projectsWriteTools,
  ...lettersTools,
  ...lettersWriteTools,
  ...chatTools,
  ...chatWriteTools,
  ...directoryTools,
  ...meTools,
  ...dictionariesTools,
  ...filesTools,
  ...workflowsTools,
  ...systemTools,
  ...memoryTools,
];

export interface CatalogFilters {
  /** Права сотрудника (`AuthUser.permissions`); `assistant.use` уже проверен. */
  permissions: readonly string[];
  /** Включённые модули портала (`AuthUser.modules`) — для флагов I10. */
  features: readonly string[];
}

/** Доступные сотруднику инструменты: права, флаги и полнота карточки записи. */
export function buildCatalog(filters: CatalogFilters): AssistantToolDefinition[] {
  return ALL_TOOLS.filter((tool) => {
    // Запись без карточки подтверждения непредставима: такая ошибка
    // регистрации не должна доехать до прогона (ADR-0048, фьюз).
    if (tool.kind === 'write' && !tool.card) return false;
    if (tool.permission && !filters.permissions.includes(tool.permission)) return false;
    if (tool.featureFlag && !filters.features.includes(tool.featureFlag)) return false;
    return true;
  });
}

/** Инструмент каталога по id среди ВСЕХ определений (исполнение карточки:
 *  права перепроверяет API портала, а не ослабленный список прогона). */
export function findAnyTool(id: string): AssistantToolDefinition | null {
  return ALL_TOOLS.find((tool) => tool.id === id) ?? null;
}

/** Горячая полка: инструменты, которые всегда в промпте (ADR-0043 п. 4). */
export function hotTools(catalog: readonly AssistantToolDefinition[]): AssistantToolDefinition[] {
  return catalog.filter((tool) => tool.hot);
}

/** Инструмент по имени (после фильтров — вызывать можно только из каталога). */
export function findTool(
  catalog: readonly AssistantToolDefinition[],
  id: string,
): AssistantToolDefinition | null {
  return catalog.find((tool) => tool.id === id) ?? null;
}
