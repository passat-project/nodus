import { chatTools } from './definitions/chat.tools.js';
import { dictionariesTools } from './definitions/dictionaries.tools.js';
import { directoryTools } from './definitions/directory.tools.js';
import { lettersTools } from './definitions/letters.tools.js';
import { projectsTools } from './definitions/projects.tools.js';
import { systemTools } from './definitions/system.tools.js';
import { tasksTools } from './definitions/tasks.tools.js';
import { workflowsTools } from './definitions/workflows.tools.js';
import type { AssistantToolDefinition } from './tool-definition.js';

/**
 * Каталог инструментов ИИ-агента (ADR-0043): один список — три потребителя
 * (внутренний чат, будущий MCP-сервер, подсказки в UI). Состав Ф1 —
 * только чтение.
 *
 * Фильтры каталога — единственное место выдачи инструментов сотруднику:
 * 1) read-only предохранитель: `kind: write` НЕ регистрируется (жёсткая
 *    проверка, не в промпте);
 * 2) право инструмента (сверх `assistant.use`): нет права — нет инструмента;
 * 3) флаг модуля-владельца: выключенный модуль не отдаёт свои инструменты.
 */
export const ALL_TOOLS: readonly AssistantToolDefinition[] = [
  ...tasksTools,
  ...projectsTools,
  ...lettersTools,
  ...chatTools,
  ...directoryTools,
  ...dictionariesTools,
  ...workflowsTools,
  ...systemTools,
];

export interface CatalogFilters {
  /** Права сотрудника (`AuthUser.permissions`); `assistant.use` уже проверен. */
  permissions: readonly string[];
  /** Включённые модули портала (`AuthUser.modules`) — для флагов I10. */
  features: readonly string[];
}

/** Доступные сотруднику инструменты: права, флаги и read-only. */
export function buildCatalog(filters: CatalogFilters): AssistantToolDefinition[] {
  return ALL_TOOLS.filter((tool) => {
    // Жёсткий предохранитель режима «Смотреть» (ADR-0043 п. 5).
    if (tool.kind !== 'read') return false;
    if (tool.permission && !filters.permissions.includes(tool.permission)) return false;
    if (tool.featureFlag && !filters.features.includes(tool.featureFlag)) return false;
    return true;
  });
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
