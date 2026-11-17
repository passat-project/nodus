import { ALL_TOOLS, buildCatalog } from '../tools/catalog.js';
import type { AssistantToolDefinition } from '../tools/tool-definition.js';

/**
 * Каталог для eval (#926): все инструменты, права и флаги — из самих
 * определений. Роль в золотом наборе описывает ФОРМУЛИРОВКИ сотрудника, а не
 * видимость: доступ проверяют `catalog.test.ts` и API-гварды, измеритель
 * оценивает качество выбора на полном каталоге.
 */
export function evalCatalog(): AssistantToolDefinition[] {
  const permissions = new Set<string>(['assistant.use']);
  const features = new Set<string>();
  for (const tool of ALL_TOOLS) {
    if (tool.permission) permissions.add(tool.permission);
    if (tool.featureFlag) features.add(tool.featureFlag);
  }
  return buildCatalog({ permissions: [...permissions], features: [...features] });
}
