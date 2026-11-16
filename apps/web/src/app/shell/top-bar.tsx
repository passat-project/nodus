import { Moon, Search, Sun } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { HomeGreeting } from '../../features/home/components/home-greeting.js';
import { BellPopover } from '../../features/notifications/components/bell-popover.js';
import { RunningTimerChip } from '../../features/tasks/components/running-timer-chip.js';
import { WhatsNewButton } from '../../features/whats-new/components/whats-new-button.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { useChatUnreadSummary } from '../../shared/chat/chat-queries.js';
import { TabUnreadBadge } from '../../shared/chat/tab-unread-badge.js';
import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import { DownloadAppButton } from './download-app-button.js';
import { navModuleForPath, visibleNavTabs } from './nav-registry.js';
import { ProfileMenu } from './profile-menu.js';
import { useShellStore } from './shell-store.js';

/**
 * Топбар «инструмента»: моно-вкладки раздела с портом на оси ИЗ ЕДИНОГО
 * реестра (nav-registry), ФИКСИРОВАННЫЕ (вердикт владельца 15.09.2026:
 * верхние вкладки без кастомизации — персональный порядок и «Скрытое»
 * живут только в левой рейке); правой группой — глобальный «Умный поиск»
 * ЛУПОЙ (модель позднего Битрикс24: не конкурирует с локальным поиском
 * списков за глаза; Ctrl+K работает), уведомления, тумблер темы. Профиль —
 * ВЕРХ служебной полосы за пределами мягкой рамы (ProfileMenu, план R3/R4).
 */
const NO_PERMISSIONS: readonly string[] = [];

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });

  const theme = useShellStore((s) => s.theme);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const setCommandOpen = useShellStore((s) => s.setCommandOpen);
  const { data: unread } = useChatUnreadSummary();
  const permissions = useAuthStore((s) => s.user?.permissions ?? NO_PERMISSIONS);

  /** Счётчик вкладки (#409): только у мессенджера; «Настройка» — без числа. */
  const tabCount = (moduleId: string | undefined, tabId: string): number => {
    if (moduleId !== 'chat') return 0;
    if (tabId === 'chats') return unread?.chats ?? 0;
    if (tabId === 'tasks') return unread?.entities ?? 0;
    return 0;
  };

  const search = new URLSearchParams(searchStr);
  const module = navModuleForPath(pathname);
  const tabs = module ? visibleNavTabs(module, permissions) : [];
  // Вкладки топбара — search-параметры, а не маршрут: контур читает data-active
  // из DOM и о смене подмодуля сам не узнаёт (deps замера — только режимы).
  // Шлём перемер ПОСЛЕ коммита нового data-active (грамматика MessengerTabs),
  // иначе точка фокуса и вспышка застревают на прежнем подмодуле (баг #91).
  const activeTabId = tabs.find((t) => t.isActive(search, permissions))?.id ?? null;
  useLayoutEffect(() => {
    window.dispatchEvent(new Event(CIRCUIT_REMEASURE));
  }, [activeTabId, module?.id]);

  // Фон НЕ красим: топбар живёт ВНУТРИ мягкой рамы и наследует её «лист» —
  // собственная заливка bg-background прятала верхнюю ступень рамы
  // (вердикт владельца 12.09.2026: «верх мягкой карточки не виден из-за
  // чёрного хэдера»).
  return (
    <header data-topbar className="flex h-14 shrink-0 items-center gap-3 px-4">
      <nav className="flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
        {/* Главная без вкладок: пустую полосу занимает приветствие — лента
            начинается выше (вердикт владельца 12.09.2026). Страница
            «Настройки портала» (#558) — техническая, приветствие там лишнее. */}
        {pathname === '/settings' ? (
          <span className="text-sm font-medium text-foreground">{ui.nav.settings}</span>
        ) : !module || tabs.length === 0 ? (
          <HomeGreeting />
        ) : (
          tabs.map((tab) => (
            <Link
              key={tab.id}
              to={module.to}
              search={tab.search}
              data-tab-port
              data-active={tab.isActive(search, permissions) ? 'true' : undefined}
              className={cn(
                'relative flex h-full items-center px-4 text-sm font-medium transition-colors',
                tab.isActive(search, permissions)
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground/80',
              )}
            >
              <span data-tab-label>{tab.label}</span>
              <TabUnreadBadge count={tabCount(module?.id, tab.id)} />
            </Link>
          ))
        )}
      </nav>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        {/* Идущий таймер учёта времени (#311) — виден из любого раздела */}
        <RunningTimerChip />
        {/* Глобальный «Умный поиск» — лупа (та же палитра Ctrl+K); большого
            поля в центре нет — не путается с локальным поиском списков */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCommandOpen(true)}
          aria-label={`${ui.topbar.smartSearch} (${ui.topbar.searchHint})`}
          title={`${ui.topbar.smartSearch} (${ui.topbar.searchHint})`}
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Search />
        </Button>

        {/* Приложение для Windows: браузеру — загрузка установщика, оболочке —
            точка обновления (#263); без раздачи /desktop/ кнопки нет */}
        <DownloadAppButton />

        <span className="flex h-8 items-center rounded-md border border-border px-2.5 font-mono text-label font-medium tracking-wider text-muted-foreground">
          RU
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? ui.topbar.themeToLight : ui.topbar.themeToDark}
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span key={theme} className="flex animate-in duration-300 fade-in zoom-in-95">
            {theme === 'dark' ? <Moon /> : <Sun />}
          </span>
        </Button>

        {/* «Что нового» (#386): история обновлений портала; точка — последнее
            обновление ещё не просмотрено */}
        <WhatsNewButton />

        <BellPopover />

        {/* Профиль — правый верх мягкой рамы, справа от уведомлений (вердикт
            владельца 15.09.2026: служебная полоса — только аватарки коллег). */}
        <ProfileMenu />
      </div>
    </header>
  );
}
