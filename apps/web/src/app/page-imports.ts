import type { ComponentType } from 'react';

/**
 * Импорты страниц разделов — ОДНА таблица для lazy-роутера (`router.tsx`) и
 * загрузки чанков заранее: чанк раздела грузится по тому же спецификатору, и
 * роутер получает уже готовый модуль (#1051). После обновления страницы
 * страница раздела ждала своей очереди за входом (refresh → me), а первый
 * заход в каждый раздел — загрузки своего чанка.
 */
export const PAGE_IMPORTS = {
  login: () =>
    import('../features/auth/pages/login-page.js').then((m) => ({ default: m.LoginPage })),
  inviteAccept: () =>
    import('../features/directory/pages/invite-accept-page.js').then((m) => ({
      default: m.InviteAcceptPage,
    })),
  passwordReset: () =>
    import('../features/directory/pages/password-reset-page.js').then((m) => ({
      default: m.PasswordResetPage,
    })),
  home: () => import('./home-route.js').then((m) => ({ default: m.HomeRoute })),
  tasks: () =>
    import('../features/tasks/pages/tasks-page.js').then((m) => ({ default: m.TasksPage })),
  letters: () =>
    import('../features/correspondence/pages/letters-page.js').then((m) => ({
      default: m.LettersPage,
    })),
  crm: () =>
    import('../features/crm/pages/counterparties-page.js').then((m) => ({
      default: m.CounterpartiesPage,
    })),
  projects: () =>
    import('../features/projects/pages/projects-page.js').then((m) => ({
      default: m.ProjectsPage,
    })),
  chat: () => import('../features/chat/pages/chat-page.js').then((m) => ({ default: m.ChatPage })),
  employees: () =>
    import('../features/directory/pages/employees-page.js').then((m) => ({
      default: m.EmployeesPage,
    })),
  automation: () => import('./automation-route.js').then((m) => ({ default: m.AutomationRoute })),
  settings: () =>
    import('../features/settings/pages/portal-settings-page.js').then((m) => ({
      default: m.PortalSettingsPage,
    })),
} as const satisfies Record<string, () => Promise<{ default: ComponentType }>>;

export type PageImportKey = keyof typeof PAGE_IMPORTS;

/** Первый сегмент пути → страница раздела (адреса — как в дереве роутера;
 *  сверку держит `page-imports.test.ts`). */
const PAGE_BY_SEGMENT: Record<string, PageImportKey> = {
  '/login': 'login',
  '/invite': 'inviteAccept',
  '/reset': 'passwordReset',
  '/home': 'home',
  '/tasks': 'tasks',
  '/letters': 'letters',
  '/crm': 'crm',
  '/projects': 'projects',
  '/chat': 'chat',
  '/employees': 'employees',
  '/automation': 'automation',
  '/settings': 'settings',
};

/** Импорт страницы раздела по адресу — `null` для корня и неизвестных путей. */
export function pageImportForPath(address: string): (() => Promise<unknown>) | null {
  // Адрес целиком (со строкой запроса и якорем) тоже корректен: секция —
  // первый сегмент пути.
  const [path = ''] = address.split(/[?#]/, 1);
  const segment = path.split('/')[1] ?? '';
  const key = PAGE_BY_SEGMENT[`/${segment}`];
  return key ? PAGE_IMPORTS[key] : null;
}

/**
 * Загрузить чанк раздела заранее. Ошибка глотается: после выкатки старый
 * чанк даёт 404 — перезагрузить страницу обязан штатный guard роутера в
 * момент реального входа в раздел, а не фоновая загрузка под руками.
 */
export async function preloadPage(pathname: string): Promise<void> {
  const load = pageImportForPath(pathname);
  if (!load) return;
  try {
    await load();
  } catch {
    /* чанк устарел — перезагрузит guard роутера при реальном входе */
  }
}
