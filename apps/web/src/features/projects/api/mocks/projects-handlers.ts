import { projectCatalogHandlers } from './project-catalog-handlers.js';
import { projectMutationHandlers } from './project-mutation-handlers.js';
import { projectReadHandlers } from './project-read-handlers.js';
import { structureHandlers } from './structure-handlers.js';

/**
 * Агрегат мок-хендлеров модуля проектов (#52, #467). Порядок важен:
 * справочники и структура (`/projects/types`, `/projects/groups`,
 * `/projects/node-kinds`) — ДО параметрического `/projects/:id`
 * (MSW матчит по порядку массива — gotcha msw-query).
 */
export const projectsHandlers = [
  ...projectCatalogHandlers,
  ...structureHandlers,
  ...projectReadHandlers,
  ...projectMutationHandlers,
];
