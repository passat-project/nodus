import { useState } from 'react';
import {
  ArrowUpDown,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  Settings2,
  Users,
} from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { useChatUnreadSummary } from '../../shared/chat/chat-queries.js';
import { useNotificationSummary } from '../../features/notifications/api/notifications-api.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import { NAV_MODULES, type NavModuleDef } from './nav-registry.js';
import { RailCustomizeMode } from './node-rail-customize.js';
import {
  HIDDEN_SENTINEL,
  HiddenDividerRow,
  PORT,
  RailPort,
  RailRowLink,
  ShowHiddenToggle,
} from './node-rail-rows.js';
import { resolveHidden, resolveOrder } from './ui-prefs.js';
import { useUiPrefsStore } from '../../shared/preferences/ui-prefs-store.js';
import { uiPx } from '../../shared/ui/ui-scale.js';
import { useShellStore } from './shell-store.js';
import { LogoIcon } from './logo-icon.js';
import { LogoWordmark } from './logo-wordmark.js';

/** Ось шины в px от левого края рейки (импортируется circuit-geometry). */
export const RAIL_TRUNK_X = uiPx(24);
/** Радиус порта — конец отвода магистрали прячется ПОД кромку круга. */
export const MODULE_PORT_R = PORT / 2;

/**
 * Левая рейка модулей как магистраль графа (реф node-based UI): хребет
 * со скруглёнными отводами к портам; активные отвод и порт светятся.
 *
 * ПЕРСОНАЛЬНЫЙ ПОРЯДОК (концепт #4, вердикты владельца 15.09.2026): секций
 * «Работа»/«Общение» нет — плоский список личный ?? общий ?? системный.
 * Модуль «НАСТРОЙКИ» прибит ВНИЗУ рейки (модель Битрикс24) — контекстное
 * меню: «Изменить порядок» (режим dnd с НЕПОДВИЖНЫМ сепаратором «— Скрытое
 * —»: перетащил модуль за сепаратор = скрыл; минимум один видимый),
 * «Применить порядок для всех» (Permission.SETTINGS_UI_DEFAULTS — текущий
 * порядок становится общим), «Вернуть по умолчанию». Скрытые модули в
 * обычном режиме — под «Показать всё ▾» внизу списка; раскрытие живёт до
 * любого действия (навигация сворачивает). Первый ВИДИМЫЙ модуль —
 * стартовый экран приложения (переадресация «/», router.tsx).
 */
export function NodeRail() {
  const collapsed = useShellStore((s) => s.menuCollapsed);
  const toggle = useShellStore((s) => s.toggleMenu);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: notificationSummary } = useNotificationSummary();
  const { data: unreadSummary } = useChatUnreadSummary();

  const personal = useUiPrefsStore((s) => s.personal);
  const company = useUiPrefsStore((s) => s.company);
  const applyNav = useUiPrefsStore((s) => s.applyNav);
  const resetPersonal = useUiPrefsStore((s) => s.resetPersonal);
  const canForAll = useAuthStore(
    (s) => s.user?.permissions.includes(Permission.SETTINGS_UI_DEFAULTS) ?? false,
  );

  const ids = NAV_MODULES.map((m) => m.id);
  const order = resolveOrder(ids, personal.navOrder, company.navOrder);
  const hidden = resolveHidden(ids, personal.navHidden, company.navHidden);
  const byId = (id: string) => NAV_MODULES.find((m) => m.id === id);
  const defined = (m: NavModuleDef | undefined): m is NavModuleDef => m !== undefined;
  const visibleModules = order
    .filter((id) => !hidden.includes(id))
    .map(byId)
    .filter(defined);
  const hiddenModules = order
    .filter((id) => hidden.includes(id))
    .map(byId)
    .filter(defined);

  // Режим настройки (node-rail-customize.tsx): черновик собирается на старте.
  const [customizing, setCustomizing] = useState(false);
  // «Показать всё ▾» — раскрытые скрытые модули в обычном режиме; после
  // любого действия (навигация) сворачивается обратно (модель Битрикс24).
  // Рендер-тайм сброс по смене пути (канон React, аудит #45).
  const [showHidden, setShowHidden] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setShowHidden(false);
  }

  const badges = (m: NavModuleDef): number | undefined => {
    // Бейджи задач/писем временно без источника: агрегат Главной похудел до
    // витрины (#100), а живых модулей задач/писем в бэке ещё нет — счётчики
    // вернутся с их собственными API.
    if (m.badge === 'tasks' || m.badge === 'letters') return undefined;
    if (m.badge === 'chat') {
      // Точная сумма по всем беседам (#409), не по первой странице списка.
      const n = unreadSummary?.total ?? 0;
      return n || undefined;
    }
    // Главная (#100): число важного (срочно+личное+действия) — индикация
    // «число + точка»; тихая точка фона — badgeAttention dot в строке.
    if (m.badge === 'notifications') {
      const n = notificationSummary?.attention ?? 0;
      return n || undefined;
    }
    return undefined;
  };

  const isActive = (m: NavModuleDef) => (m.exact ? pathname === m.to : pathname.startsWith(m.to));
  const remeasure = () => window.dispatchEvent(new Event(CIRCUIT_REMEASURE));

  const startCustomize = () => {
    if (collapsed) toggle();
    setCustomizing(true);
    remeasure();
  };
  // Отмена: порядок откатывается вместе с КОНТУРОМ — без перемера линия
  // оставалась от черновика (баг-вердикт 15.09.2026: «модуль вернулся,
  // связь изменилась»); rAF-перемер читает DOM уже после коммита React.
  const cancelCustomize = () => {
    setCustomizing(false);
    remeasure();
  };

  return (
    <aside
      data-rail
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground',
        'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed && !customizing ? 'w-16' : 'w-60',
      )}
    >
      {/* pt-4: содержимое сидит на одной горизонтали с топбаром — тот
          начинается на 8px ниже (mt-2 мягкой рамы), и без компенсации низ
          вордмарка висит выше базовой линии приветствия (#269). */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center justify-center px-4 pt-4',
          'transition-[gap] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed && !customizing ? 'gap-0 px-0' : 'gap-2.5',
        )}
      >
        <span data-logo-port className="flex shrink-0">
          <LogoIcon className="size-9 text-foreground" />
        </span>
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed && !customizing ? 'max-w-0 opacity-0' : 'max-w-44 opacity-100',
          )}
        >
          <LogoWordmark className="text-xl tracking-[0.18em] text-foreground uppercase" />
        </span>
      </div>

      {/* Якорь узла бокового шва схлопнутой рейки (канон — в git-истории). */}
      {collapsed && !customizing && (
        <span
          data-left-node
          aria-hidden
          className="absolute top-[3.9375rem] -right-[0.53125rem] size-px"
        />
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-3">
        {customizing ? (
          <RailCustomizeMode
            initialDraft={[
              ...visibleModules.map((m) => m.id),
              HIDDEN_SENTINEL,
              ...hiddenModules.map((m) => m.id),
            ]}
            canForAll={canForAll}
            badges={badges}
            isActive={isActive}
            byId={byId}
            onApply={(order, hidden, forAll) => {
              applyNav(order, hidden, forAll);
              setCustomizing(false);
              remeasure();
            }}
            onCancel={cancelCustomize}
          />
        ) : (
          <div className="relative flex flex-col gap-0.5">
            {visibleModules.map((m) => (
              <RailRowLink
                key={m.id}
                module={m}
                collapsed={collapsed}
                active={isActive(m)}
                badge={badges(m)}
              />
            ))}
            {!collapsed &&
              visibleModules.map((m, i) => (
                <RailPort key={m.id} module={m} index={i} active={isActive(m)} />
              ))}
            {/* Скрытые модули: «Показать всё ▾» → сепаратор «— Скрытое —» +
                ссылки (без портов — временный просмотр, Битрикс24). */}
            {hiddenModules.length > 0 && !collapsed ? (
              <>
                <ShowHiddenToggle expanded={showHidden} onToggle={() => setShowHidden((v) => !v)} />
                {showHidden ? (
                  <>
                    <HiddenDividerRow />
                    {hiddenModules.map((m) => (
                      <RailRowLink
                        key={m.id}
                        module={m}
                        collapsed={collapsed}
                        active={isActive(m)}
                        badge={badges(m)}
                      />
                    ))}
                  </>
                ) : null}
              </>
            ) : null}

            {/* «Настройки» — ТЕХНИЧЕСКАЯ команда сразу после списка (вердикт
                владельца 15.09.2026, модель Битрикс24): не участвует в
                порядке, отступ сверху больше обычного (mt-2) — читается как
                команда, не модуль; меню — НАД кнопкой у её левого края. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={ui.nav.settings}
                  className={cn(
                    'relative mt-2 flex h-8 shrink-0 items-center overflow-hidden rounded-md text-sm font-medium',
                    'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
                    collapsed ? 'mx-3 justify-center' : 'mr-3 ml-[3.25rem] gap-3 pl-2',
                  )}
                >
                  <Settings2 className="size-[1.125rem] shrink-0" strokeWidth={1.75} />
                  {collapsed ? null : ui.nav.settings}
                </button>
              </DropdownMenuTrigger>
              {/* #132: ширина ПО ВНУТРЕННОСТЬ рейки (w-48 при отступе кнопки
                  ml-[3.25rem] ≈ до края w-60) — раньше w-64 нависал над
                  рамой; длинные подписи не рвём (метка applyForAll
                  сокращена). */}
              <DropdownMenuContent side="bottom" align="start" className="w-48">
                <DropdownMenuItem onSelect={startCustomize}>
                  <ArrowUpDown className="size-4" />
                  {ui.nav.editOrder}
                </DropdownMenuItem>
                {canForAll ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      applyNav(order, hidden, true);
                      remeasure();
                    }}
                  >
                    <Users className="size-4" />
                    {ui.nav.applyForAll}
                  </DropdownMenuItem>
                ) : null}
                {personal.navOrder !== undefined || personal.navHidden !== undefined ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      resetPersonal();
                      remeasure();
                    }}
                  >
                    <RotateCcw className="size-4" />
                    {ui.nav.resetDefault}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </nav>

      {/* Подвал — только сворачивание рейки (подтверждение режима настройки
          живёт инлайн после списка, на месте ряда «Настройки»). */}
      <div className="flex shrink-0 p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? ui.nav.expand : ui.nav.collapse}
          className="flex h-8 flex-1 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
