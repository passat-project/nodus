import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';

import { pageLoader, type PreloadablePage } from './page-loader.js';
import { AppShell } from './shell/app-shell.js';
import { automationBeforeLoad } from './legacy-automation-search.js';
import { PAGE_IMPORTS, preloadPage } from './page-imports.js';
import { RAIL_MODULES } from './shell/nav-registry.js';
import { NotFoundScreen, RouterErrorScreen } from './shell/system-screens.js';
import { resolveHidden, resolveOrder } from './shell/ui-prefs.js';
import { useUiPrefsStore } from '../shared/preferences/ui-prefs-store.js';
import { useAuthStore } from '../shared/auth-store.js';
import { useRemoveBootSplash } from './boot-splash.js';
import { prefetchPersonalBoard } from '../features/tasks/api/tasks-board-prefetch.js';
import { queryClient } from '../shared/lib/query-client.js';
import { browserAllowsWarmup } from './shell/module-warmup.js';

/**
 * Страницы разделов и куски вне страниц собирает `pageLoader`
 * (`./page-loader.ts`) — НЕ `React.lazy`: почему — в его комментарии.
 * Определение живёт в листовом модуле, а не здесь: файл роутера импортирует
 * шелл (`AppShell`), а шелку загрузчик нужен сам (каркас карточки типа,
 * `shell/card-type-entry.tsx`) — импорт из этого файла давал бы цикл
 * router ↔ shell. Ниже — реэкспорт для прежних импортов.
 */
export { pageLoader, type PreloadablePage };

const LoginPage = pageLoader(PAGE_IMPORTS.login);
const InviteAcceptPage = pageLoader(PAGE_IMPORTS.inviteAccept);
const PasswordResetPage = pageLoader(PAGE_IMPORTS.passwordReset);
const HomePage = pageLoader(PAGE_IMPORTS.home);
const TasksPage = pageLoader(PAGE_IMPORTS.tasks);
const LettersPage = pageLoader(PAGE_IMPORTS.letters);
const CounterpartiesPage = pageLoader(PAGE_IMPORTS.crm);
const ProjectsPage = pageLoader(PAGE_IMPORTS.projects);
const ChatPage = pageLoader(PAGE_IMPORTS.chat);
const EmployeesPage = pageLoader(PAGE_IMPORTS.employees);
const AutomationPage = pageLoader(PAGE_IMPORTS.automation);
const PortalSettingsPage = pageLoader(PAGE_IMPORTS.settings);

/**
 * Роутер SPA (TanStack Router, code-splitting по разделам).
 * Карточки сущностей — НЕ маршруты: единый стек поверх любого раздела
 * (ADR-0009, search `?cards=task:id,project:id`, хост CardStackHost в
 * AppShell): все карточки одной геометрии, наслаиваются без ограничения
 * глубины и комбинаторики вложенных роутов, закрытие верхней возвращает
 * к прежней. Разделные search-параметры (папка писем, тред канала) живут
 * рядом и при открытии карточки сохраняются.
 */
/**
 * Корневая рамка: первый экран приложения (оболочка, страница входа) снимает
 * стартовую заставку `index.html` — до него она держится на экране всё время
 * загрузки скриптов и входа. Системные экраны снимают её сами: они заменяют
 * эту рамку, а не рендерятся в ней.
 */
export function RootGate() {
  useRemoveBootSplash();
  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootGate,
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

/** Публичные страницы одноразовых ссылок (#101): доступны и анониму, и
 *  вошедшему — смена учётки подтверждается на самой странице. */
const inviteAcceptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InviteAcceptPage,
});

const passwordResetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset/$token',
  component: PasswordResetPage,
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
    const { personal } = useUiPrefsStore.getState();
    const ids = RAIL_MODULES.map((m) => m.id);
    const order = resolveOrder(ids, personal.navOrder);
    const hidden = resolveHidden(ids, personal.navHidden);
    // Стартовый экран — первый ВИДИМЫЙ модуль (скрытый «с верху» не считается).
    const firstId = order.find((id) => !hidden.includes(id));
    const first = RAIL_MODULES.find((m) => m.id === firstId);
    throw redirect({ to: first?.to ?? '/home', replace: true });
  },
  component: () => null,
});

const tasksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/tasks',
  // Данные доски — в кэш заранее (#1051): роутер зовёт loader и при наведении
  // на раздел (defaultPreload: 'intent'), и при входе. Переход не блокирует:
  // страница монтируется сразу, её запросы примыкают к начатым.
  loader: () => {
    if (browserAllowsWarmup()) void prefetchPersonalBoard(queryClient).catch(() => undefined);
  },
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
  // Легаси «Схемы проектов» (#857): вкладки больше нет — старый адрес
  // перенаправляется на единый вход «Процессы» (type→ptype, kind→ftype).
  beforeLoad: automationBeforeLoad,
  component: AutomationPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: PortalSettingsPage,
});

/**
 * Dev-галерея дизайн-системы (#257) — единственный экран `/dev/ui`.
 *
 * Флаг сборки — в ОДНОМ месте: `devUiEnabled`. Экран нужен владельцу живым на
 * песочнице (preview-сборка `:4173`), поэтому кроме dev-режима Vite он
 * включается флагом `VITE_SANDBOX_DEV_UI=1`, который выставляет ТОЛЬКО
 * `scripts/live-stack.mjs`. Прод (CI/docker) флага не получает: `vite.config`
 * превращает его в статичный `'0'`, выражение сворачивается в `false`, и
 * rollup выкидывает и фабрику маршрута, и её lazy-импорт (проверка — grep по
 * `apps/web/dist`: `/dev/ui`, `DevUiPage`, `dev-ui`; строки экрана — отдельный
 * экспорт i18n, отсекается тем же деревом). При выключенном флаге
 * `devUiRoute` = null → спред в дереве ниже ничего не добавляет.
 */
function createDevUiRoute() {
  const DevUiPage = pageLoader(() =>
    import('./dev-ui/dev-ui-page.js').then((m) => ({ default: m.DevUiPage })),
  );
  return createRoute({
    getParentRoute: () => shellRoute,
    path: '/dev/ui',
    component: DevUiPage,
  });
}

/**
 * Условие включения экрана — ОДНО инлайн-выражение (без вызова функции):
 * только так Vite/rollup сворачивают его до литерала и вырезают маршрут с
 * чанком из прод-бандла. Значения приходят статично: `DEV` и
 * `VITE_SANDBOX_DEV_UI` (последний задаёт `vite.config.ts` из process.env —
 * `'1'` только у сборки песочницы). Проверка обеих веток — route-тесты в
 * `router-dev.test.ts` (подмена env) и grep по `apps/web/dist` в гейтах.
 */
const devUiEnabled = import.meta.env.DEV || import.meta.env.VITE_SANDBOX_DEV_UI === '1';
const devUiRoute = devUiEnabled ? createDevUiRoute() : null;

const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteAcceptRoute,
  passwordResetRoute,
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
    settingsRoute,
    // Dev-галерея (#257): в прод-сборке `devUiRoute` = null → пустой спред.
    ...(devUiRoute ? [devUiRoute] : []),
  ]),
]);

export const router = createRouter({
  routeTree,
  // Наведение на раздел — за 50 мс до клика чанк страницы уже грузится:
  // переход не ждёт сети (#1051).
  defaultPreload: 'intent',
});

// Чанк открытого раздела — сразу, параллельно входу (refresh → me), а не после
// него: после обновления страницы раздел открывается на шаг водопада раньше.
void preloadPage(window.location.pathname);

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
