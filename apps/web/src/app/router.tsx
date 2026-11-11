import { lazy, type ComponentType } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';

import { AppShell } from './shell/app-shell.js';
import { NAV_MODULES } from './shell/nav-registry.js';
import { NotFoundScreen, RouterErrorScreen } from './shell/system-screens.js';
import { resolveHidden, resolveOrder } from './shell/ui-prefs.js';
import { useUiPrefsStore } from '../shared/preferences/ui-prefs-store.js';
import { useAuthStore } from '../shared/auth-store.js';

/**
 * Гибель lazy-чанка после деплоя (вкладка оставлена открытой через пересборку
 * прода/рестарт dev): импорт чанка со старым именем даёт 404 и раздел «не
 * открывается» (репорт владельца 24.09, #88). Guard: ошибка импорта → ОДИН
 * reload страницы за сессионный флаг (против цикла), успешный импорт флаг
 * снимает; повторный неуспех после reload — честная ошибка в экран роутера.
 */
const CHUNK_RELOAD_KEY = 'nodus-chunk-reload';
function pageLoader(loader: () => Promise<{ default: ComponentType }>) {
  return lazy(() =>
    loader().then(
      (m) => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return m;
      },
      (error: unknown) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<never>(() => {});
        }
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        throw error;
      },
    ),
  );
}

const LoginPage = pageLoader(() =>
  import('../features/auth/pages/login-page.js').then((m) => ({ default: m.LoginPage })),
);
const HomePage = pageLoader(() =>
  import('./home-route.js').then((m) => ({ default: m.HomeRoute })),
);
const TasksPage = pageLoader(() =>
  import('../features/tasks/pages/tasks-page.js').then((m) => ({ default: m.TasksPage })),
);
const LettersPage = pageLoader(() =>
  import('../features/correspondence/pages/letters-page.js').then((m) => ({
    default: m.LettersPage,
  })),
);
const CounterpartiesPage = pageLoader(() =>
  import('../features/crm/pages/counterparties-page.js').then((m) => ({
    default: m.CounterpartiesPage,
  })),
);
const ProjectsPage = pageLoader(() =>
  import('../features/projects/pages/projects-page.js').then((m) => ({ default: m.ProjectsPage })),
);
const ChatPage = pageLoader(() =>
  import('../features/chat/pages/chat-page.js').then((m) => ({ default: m.ChatPage })),
);
const EmployeesPage = pageLoader(() =>
  import('../features/directory/pages/employees-page.js').then((m) => ({
    default: m.EmployeesPage,
  })),
);
const AutomationPage = pageLoader(() =>
  import('./automation-route.js').then((m) => ({ default: m.AutomationRoute })),
);

/**
 * Роутер SPA (TanStack Router, code-splitting по разделам).
 * Карточки сущностей — НЕ маршруты: единый стек поверх любого раздела
 * (ADR-0009, search `?cards=task:id,project:id`, хост CardStackHost в
 * AppShell): все карточки одной геометрии, наслаиваются без ограничения
 * глубины и комбинаторики вложенных роутов, закрытие верхней возвращает
 * к прежней. Разделные search-параметры (папка писем, тред канала) живут
 * рядом и при открытии карточки сохраняются.
 */
const rootRoute = createRootRoute({
  component: Outlet,
  // Системные экраны — русские, с выходом на главную (аудит #45).
  errorComponent: RouterErrorScreen,
  notFoundComponent: NotFoundScreen,
  // Search свободной формы (разделные параметры + стек карточек): identity
  // validateSearch даёт тип Record<string, unknown> для search-апдейтеров
  // navigate и наследование параметров дочерними маршрутами.
  validateSearch: (search: Record<string, unknown>) => search,
});

async function requireAnonymous(): Promise<void> {
  await useAuthStore.getState().bootstrap();
  if (useAuthStore.getState().status === 'authenticated') {
    throw redirect({ to: '/' });
  }
}

async function requireAuth(): Promise<void> {
  await useAuthStore.getState().bootstrap();
  const { status } = useAuthStore.getState();
  // 'unknown' после bootstrap — сервер недоступен (обрыв сети, 5xx), а не
  // мёртвая сессия: на /login не уводим (живая cookie, вход «сломан» лишь
  // временно) — экран ошибки роутера с «Обновить страницу»; следующий
  // заход повторит bootstrap (статус не залип в anonymous).
  if (status === 'unknown') {
    throw new Error('auth bootstrap: сервер недоступен');
  }
  if (status !== 'authenticated') {
    throw redirect({ to: '/login' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  beforeLoad: requireAnonymous,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: AppShell,
  beforeLoad: requireAuth,
});

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/home',
  component: HomePage,
});

/**
 * Стартовая переадресация (концепт «Персональный порядок», #4): корень не
 * рендерит раздел, а ЗАМЕЩАЮЩЕ (replace — «/» не оседает в истории) ведёт
 * на ПЕРВЫЙ модуль личного порядка рейки. У каждого раздела — канонический
 * адрес (Главная — '/home'): иначе сдвинутая с первого места Главная стала
 * бы недостижимой (best practice, подтверждено research — gotchas).
 * localStorage читается синхронно (вспышки нет); когда настройки переедут
 * на API, beforeLoad обязан ДОЖДАТЬСЯ их загрузки (gotchas).
 */
const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  beforeLoad: () => {
    const { personal, company } = useUiPrefsStore.getState();
    const ids = NAV_MODULES.map((m) => m.id);
    const order = resolveOrder(ids, personal.navOrder, company.navOrder);
    const hidden = resolveHidden(ids, personal.navHidden, company.navHidden);
    // Стартовый экран — первый ВИДИМЫЙ модуль (скрытый «с верху» не считается).
    const firstId = order.find((id) => !hidden.includes(id));
    const first = NAV_MODULES.find((m) => m.id === firstId);
    throw redirect({ to: first?.to ?? '/home', replace: true });
  },
  component: () => null,
});

const tasksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/tasks',
  component: TasksPage,
});

const lettersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/letters',
  component: LettersPage,
});

const crmRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/crm',
  component: CounterpartiesPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects',
  component: ProjectsPage,
});

const chatRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/chat',
  component: ChatPage,
});
const chatConversationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/chat/$conversationId',
  component: ChatPage,
});

const employeesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/employees',
  component: EmployeesPage,
});

const automationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/automation',
  component: AutomationPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    indexRoute,
    homeRoute,
    tasksRoute,
    lettersRoute,
    crmRoute,
    projectsRoute,
    chatRoute,
    chatConversationRoute,
    employeesRoute,
    automationRoute,
  ]),
]);

export const router = createRouter({ routeTree });

// Смена auth-статуса (logout, протухшая сессия) → повторный beforeLoad:
// защищённый маршрут сам уйдёт на /login, /login — на главную.
useAuthStore.subscribe((state, prev) => {
  if (state.status !== prev.status) {
    void router.invalidate();
  }
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
