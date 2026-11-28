import type { HttpHandler } from 'msw';

import { automationHandlers } from '../features/automation/api/mocks/automation-handlers.js';
import { authHandlers } from '../features/auth/api/mocks/auth-handlers.js';
import { chatHandlers } from '../features/chat/api/mocks/chat-handlers.js';
import { lettersHandlers } from '../features/correspondence/api/mocks/letters-handlers.js';
import { directoryHandlers } from '../features/directory/api/mocks/directory-handlers.js';
import { homeHandlers } from '../features/home/api/mocks/home-handlers.js';
import { notificationsHandlers } from '../features/notifications/api/mocks/notifications-handlers.js';
import { assistantHandlers } from '../features/assistant/api/mocks/assistant-handlers.js';
import { fileServersHandlers } from '../features/settings/api/mocks/file-servers-handlers.js';
import { filesHandlers } from '../shared/files/mocks/files-handlers.js';
import { crmReadHandlers } from '../shared/counterparties/mocks/crm-read-handlers.js';
import { crmWriteHandlers } from '../shared/counterparties/mocks/crm-write-handlers.js';
import { customFieldsHandlers } from '../shared/custom-fields/mocks/custom-fields-handlers.js';
import { dictionariesHandlers } from '../shared/dictionaries/mocks/dictionaries-handlers.js';
import { rolesHandlers } from '../shared/access/mocks/roles-handlers.js';
import { projectsHandlers } from '../features/projects/api/mocks/projects-handlers.js';
import { searchHandlers } from '../features/search/api/mocks/search-handlers.js';
import { tasksHandlers } from '../features/tasks/api/mocks/tasks-handlers.js';
import { viewsHandlers } from '../shared/views/list-ext/mocks/views-handlers.js';
import { API_MOCK_DOMAINS, type ApiMockDomain } from '../shared/api/api-mock-config.js';

/**
 * Агрегат MSW-хендлеров по доменам (#48): хендлеры фич живут в
 * features/<name>/api/mocks (patterns.md, файлы не переносятся), здесь —
 * только карта домен → хендлеры. Record по ApiMockDomain: новый домен в
 * API_MOCK_DOMAINS без хендлеров не скомпилируется.
 */
const domainHandlers: Record<ApiMockDomain, HttpHandler[]> = {
  auth: authHandlers,
  directory: directoryHandlers,
  // automation-хендлеры ПЕРВЫМИ: буквальный /workflows/types должен стоять
  // раньше параметрического /workflows/:id (MSW матчит по порядку массива,
  // специфичность не учитывается — gotcha msw-query).
  tasks: [...automationHandlers, ...tasksHandlers],
  letters: lettersHandlers,
  projects: projectsHandlers,
  chat: chatHandlers,
  home: homeHandlers,
  files: filesHandlers,
  notifications: notificationsHandlers,
  'custom-fields': customFieldsHandlers,
  dictionaries: dictionariesHandlers,
  crm: [...crmReadHandlers, ...crmWriteHandlers],
  roles: rolesHandlers,
  settings: fileServersHandlers,
  // ИИ-ассистент (#889): окно диалога и настройки провайдеров.
  assistant: assistantHandlers,
  // Единый поиск (#952): выдача по демо-миру, контракт как у сервера.
  search: searchHandlers,
  // Сохранённые настройки списков и выгрузка CSV (#435).
  views: viewsHandlers,
};

/** Хендлеры мокаемых доменов (#48): 'all' — все (демо-сборка nodus.by),
 *  иначе — только домены из списка VITE_API_MOCK (живой логин + моки
 *  остальных). Порядок сохраняет специфичность маршрутов MSW. */
export function buildMockHandlers(domains: ReadonlySet<ApiMockDomain> | 'all'): HttpHandler[] {
  const mocked =
    domains === 'all' ? API_MOCK_DOMAINS : API_MOCK_DOMAINS.filter((d) => domains.has(d));
  return mocked.flatMap((domain) => domainHandlers[domain]);
}
