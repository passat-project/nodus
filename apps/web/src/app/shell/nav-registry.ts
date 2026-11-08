import {
  Building2,
  FolderOpen,
  House,
  ListTodo,
  Mail,
  MessageSquare,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Permission, permissionsOfModule, ui, type AccessModule } from '@nodus/contracts';

import { resolveLettersTab } from '../../features/correspondence/lib/letters-tab.js';
import { registriesAvailable } from '../../shared/api/registries-available.js';

/** Вкладка модуля топбара (подмодуль): search-параметр + предикат активности.
 *  `permission` — вкладка видна только держателю права (#55: «Новые» — у
 *  канцелярии); сервер — истина (I8), топбар лишь не показывает лишнее.
 *  Активность может зависеть от прав (вкладка по умолчанию — «Новые» у
 *  канцелярии, «Входящие» у остальных). */
export interface NavTabDef {
  id: string;
  label: string;
  search: Record<string, string>;
  permission?: Permission;
  /** Вкладка только при включённом модуле (реестры, #496). */
  enabled?: () => boolean;
  isActive: (search: URLSearchParams, permissions: readonly string[]) => boolean;
}

/** Вкладки модуля, видимые сотруднику с этими правами. */
export function visibleNavTabs(module: NavModuleDef, permissions: readonly string[]): NavTabDef[] {
  return module.tabs.filter(
    (tab) =>
      (!tab.permission || permissions.includes(tab.permission)) && (!tab.enabled || tab.enabled()),
  );
}

/** Модуль левой рейки: id — ключ персонализации порядка (UiPreferences). */
export interface NavModuleDef {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  /** Активен по точному совпадению пути (Главная) или по префиксу. */
  exact?: boolean;
  /** Источник счётчика-значка (считается в рейке по живым данным). */
  badge?: 'tasks' | 'letters' | 'chat' | 'notifications';
  /** Окно-сплит (мессенджер, Автоматизация): ось контура идёт до правого
   *  края рамы — она же верхняя граница окна (канон `references/circuit.md`). */
  splitWindow?: boolean;
  tabs: NavTabDef[];
}

/**
 * ЕДИНЫЙ реестр навигации портала (концепт «Персональный порядок», #4):
 * и левая рейка, и топбар читают модули и вкладки ОТСЮДА — раньше списки
 * жили разрозненно в node-rail.tsx и top-bar.tsx. Порядок в массиве —
 * СИСТЕМНЫЙ дефолт (нижний слой разрешения: личный ?? общий ?? системный).
 * Точка расширения (I13): после MVP реестр сможет приходить манифестом
 * от бэкенда (фичефлаги модулей, I10) — замена в одном месте.
 * Главная — модуль с каноническим адресом '/home': корень '/' — стартовая
 * переадресация на ПЕРВЫЙ модуль личного порядка (best practice: каноничный
 * URL у каждого раздела, redirect на корне — иначе сдвинутая с первого
 * места Главная стала бы недостижимой; подтверждено research, gotchas).
 */
export const NAV_MODULES: NavModuleDef[] = [
  {
    id: 'home',
    to: '/home',
    label: ui.nav.home,
    icon: House,
    exact: true,
    badge: 'notifications',
    tabs: [],
  },
  {
    id: 'tasks',
    to: '/tasks',
    label: ui.nav.tasks,
    icon: ListTodo,
    badge: 'tasks',
    tabs: [
      {
        id: 'kanban',
        label: ui.tasks.viewKanban,
        search: { view: 'kanban' },
        isActive: (s) => (s.get('view') ?? 'kanban') === 'kanban',
      },
      {
        id: 'list',
        label: ui.tasks.viewList,
        search: { view: 'list' },
        isActive: (s) => s.get('view') === 'list',
      },
    ],
  },
  {
    id: 'letters',
    to: '/letters',
    label: ui.nav.letters,
    icon: Mail,
    badge: 'letters',
    // Корреспонденция на движке «Процессы» (#55): «Новые» — очередь
    // регистрации канцелярии (по праву), «Входящие»/«Исходящие» — журналы
    // зарегистрированных, «Права доступа» — матрица раздела.
    tabs: [
      {
        id: 'new',
        label: ui.letters.tabs.new,
        search: { tab: 'new' },
        permission: Permission.CORRESPONDENCE_REGISTER,
        isActive: (s, p) => resolveLettersTab(s, p) === 'new',
      },
      {
        id: 'incoming',
        label: ui.letters.tabs.incoming,
        search: { tab: 'incoming' },
        isActive: (s, p) => resolveLettersTab(s, p) === 'incoming',
      },
      {
        id: 'outgoing',
        label: ui.letters.tabs.outgoing,
        search: { tab: 'outgoing' },
        isActive: (s, p) => resolveLettersTab(s, p) === 'outgoing',
      },
      ...accessTab('correspondence'),
    ],
  },
  {
    id: 'crm',
    to: '/crm',
    label: ui.nav.crm,
    icon: Building2,
    // Дом master-данных внешних организаций (#83, вердикт владельца 23.09):
    // рейка без зоопарка — сегодня одна вкладка, договоры и тендеры нарастут
    // вкладками по вхождению тендерно-договорного контура в план (V2).
    tabs: [
      {
        id: 'counterparties',
        label: ui.nav.counterparties,
        search: {},
        isActive: () => true,
      },
    ],
  },
  {
    id: 'projects',
    to: '/projects',
    label: ui.nav.projects,
    icon: FolderOpen,
    tabs: [{ id: 'list', label: ui.tasks.viewList, search: {}, isActive: () => true }],
  },
  {
    id: 'chat',
    to: '/chat',
    label: ui.nav.chat,
    icon: MessageSquare,
    badge: 'chat',
    splitWindow: true,
    tabs: [
      {
        id: 'chats',
        label: ui.chat.tabChats,
        search: {},
        isActive: (s) => {
          const tab = s.get('tab');
          return tab !== 'tasks' && tab !== 'settings';
        },
      },
      {
        id: 'tasks',
        label: ui.chat.tabTaskChats,
        search: { tab: 'tasks' },
        isActive: (s) => s.get('tab') === 'tasks',
      },
      {
        id: 'settings',
        label: ui.chat.tabSettings,
        search: { tab: 'settings' },
        isActive: (s) => s.get('tab') === 'settings',
      },
    ],
  },
  {
    id: 'employees',
    to: '/employees',
    label: ui.nav.employees,
    icon: Users,
    tabs: [
      // #84: «Подразделения» (дерево + панель) — дефолт вместо графа людей:
      // сотни карточек сотрудников непросматриваемы (вердикт владельца 23.09).
      {
        id: 'divisions',
        label: ui.employees.viewDivisions,
        search: {},
        isActive: (s) => (s.get('view') ?? 'divisions') === 'divisions',
      },
      {
        id: 'subordination',
        label: ui.employees.viewSubordination,
        search: { view: 'subordination' },
        isActive: (s) => s.get('view') === 'subordination',
      },
      {
        id: 'list',
        label: ui.employees.viewList,
        search: { view: 'list' },
        isActive: (s) => s.get('view') === 'list',
      },
    ],
  },
  {
    id: 'automation',
    to: '/automation',
    label: ui.nav.automation,
    icon: Workflow,
    // Окно-сплит: колонка типов + холст, ось — верхняя граница окна.
    splitWindow: true,
    // Единый дом настройки (#377): вкладки сверху, не модули в меню;
    // «Атрибуты» — реестр кастомных полей (#431), «Права доступа» — матрица
    // прав раздела (#379, ADR-0034) — последняя, появляется по каталогу,
    // «Схемы проектов» — #38 (V2).
    tabs: [
      {
        id: 'processes',
        label: ui.automation.tabProcesses,
        search: { tab: 'processes' },
        isActive: (s) => (s.get('tab') ?? 'processes') === 'processes',
      },
      {
        id: 'fields',
        label: ui.automation.tabFields,
        search: { tab: 'fields' },
        isActive: (s) => s.get('tab') === 'fields',
      },
      {
        id: 'project-schemas',
        label: ui.projects.schemasTitle,
        search: { tab: 'project-schemas' },
        permission: Permission.PROJECT_SETUP_MANAGE,
        isActive: (s) => s.get('tab') === 'project-schemas',
      },
      {
        id: 'registries',
        label: ui.forms.registries.tab,
        search: { tab: 'registries' },
        permission: Permission.WORKFLOW_MANAGE,
        enabled: registriesAvailable,
        isActive: (s) => s.get('tab') === 'registries',
      },
      ...accessTab('automation'),
    ],
  },
];

/**
 * Вкладка «Права доступа» раздела (#379, ADR-0034): срез каталога прав по
 * модулю. У раздела без прав вкладки НЕТ по построению — модуль получает её
 * одной строкой `...accessTab('<раздел>')` в своём `tabs` (всегда последней).
 */
function accessTab(module: AccessModule): NavTabDef[] {
  if (permissionsOfModule(module).length === 0) return [];
  return [
    {
      id: 'access',
      label: ui.access.tab,
      search: { tab: 'access' },
      isActive: (s) => s.get('tab') === 'access',
    },
  ];
}

/** Модуль по pathname (префикс маршрута; Главная — точное совпадение). */
export function navModuleForPath(pathname: string): NavModuleDef | undefined {
  return NAV_MODULES.find((m) => (m.exact ? pathname === m.to : pathname.startsWith(m.to)));
}
