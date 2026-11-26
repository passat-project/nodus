import { Bot, Moon, Plus, Search, Sun } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';
import { cn } from '@nodus/ui/lib/utils';

import { useAssistantEnabled } from '../../features/assistant/model/use-assistant-enabled.js';
import { useAssistantStore } from '../../features/assistant/model/assistant-store.js';
import { HomeGreeting } from '../../features/home/components/home-greeting.js';
import { BellPopover } from '../../features/notifications/components/bell-popover.js';
import { RunningTimerChip } from '../../features/tasks/components/running-timer-chip.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { isDesktopShell } from '../../shared/desktop/desktop-bridge.js';
import { openInNewTab } from '../../shared/lib/tab-bridge.js';
import { useSearchStore } from '../../features/search/model/search-store.js';
import { useChatUnreadSummary } from '../../shared/chat/chat-queries.js';
import { TabUnreadBadge } from '../../shared/chat/tab-unread-badge.js';
import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import { DownloadAppButton } from './download-app-button.js';
import {
  navModuleForPath,
  visibleNavTabs,
  type NavModuleDef,
  type NavTabDef,
} from './nav-registry.js';
import { ProfileMenu } from './profile-menu.js';
import { PortalUpdatePlate } from './portal-update-plate.js';
import { useShellStore } from './shell-store.js';

/**
 * Топбар «инструмента»: моно-вкладки раздела с портом на оси ИЗ ЕДИНОГО
 * реестра (nav-registry), ФИКСИРОВАННЫЕ (вердикт владельца 15.09.2026:
 * верхние вкладки без кастомизации — персональный порядок и «Скрытое»
 * живут только в левой рейке); правой группой — глобальный «Умный поиск»
 * ЛУПОЙ (модель позднего Битрикс24: не конкурирует с локальным поиском
 * списков за глаза; Ctrl+K работает), кнопка ИИ-ассистента (#1021 —
 * вместо неработающей плашки «RU»), уведомления, тумблер темы. Профиль —
 * ВЕРХ служебной полосы за пределами мягкой рамы (ProfileMenu, план R3/R4).
 */
const NO_PERMISSIONS: readonly string[] = [];

/** Адрес моно-вкладки для новой вкладки (pathname+search, как Link строит). */
function tabUrl(module: NavModuleDef, tab: NavTabDef): string {
  const params = new URLSearchParams(tab.search).toString();
  return params ? `${module.to}?${params}` : module.to;
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  // Оболочка (#1038): моно-вкладки получают «Открыть в новой вкладке»
  // (средний клик + ПКМ) — браузер живёт штатными вкладками браузера.
  const inShell = isDesktopShell();

  const theme = useShellStore((s) => s.theme);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const openSearch = useSearchStore((s) => s.openSearch);
  const { data: unread } = useChatUnreadSummary();
  const permissions = useAuthStore((s) => s.user?.permissions ?? NO_PERMISSIONS);
  // Окно ассистента — оверлей внутри рамы: тоггл живёт в топбаре (#1021).
  const assistantOpen = useAssistantStore((s) => s.open);
  const setAssistantOpen = useAssistantStore((s) => s.setOpen);
  const assistantEnabled = useAssistantEnabled();
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
            начинается выше (вердикт владельца 12.09.2026). «Настройки
            портала» (#558) — обычная страница с вкладками топбара
            («Файловые серверы», «Права доступа»), приветствие не нужно. */}
        {!module || tabs.length === 0 ? (
          <HomeGreeting />
        ) : (
          tabs.map((tab) => {
            const link = (
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
                // Средний клик — «Открыть в новой вкладке» (только в оболочке:
                // в браузере штатный middle-click ссылки; preventDefault
                // гасит автоскролл и перехват target=_blank оболочки).
                onMouseDown={(event) => {
                  if (inShell && event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (!inShell || event.button !== 1) return;
                  event.preventDefault();
                  openInNewTab(tabUrl(module, tab), { focus: false });
                }}
              >
                <span data-tab-label className="whitespace-nowrap">
                  {tab.label}
                </span>
                <TabUnreadBadge count={tabCount(module?.id, tab.id)} />
              </Link>
            );
            // ПКМ по моно-вкладке — пункт «Открыть в новой вкладке»; в
            // браузере родное меню ссылки (обёртки нет).
            return inShell ? (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  <ContextMenuItem
                    onClick={() => openInNewTab(tabUrl(module, tab), { focus: false })}
                  >
                    <Plus className="size-4" strokeWidth={1.75} />
                    {ui.desktop.tabOpenInNew}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              link
            );
          })
        )}
      </nav>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        {/* Идущий таймер учёта времени (#311) — виден из любого раздела */}
        <RunningTimerChip />
        {/* Плашка «Портал обновился» (#1038, фаза F): только браузер, в потоке
            правой группы — иконки отступают влево. */}
        <PortalUpdatePlate />
        {/* Глобальный «Умный поиск» — лупа (та же палитра Ctrl+K); большого
            поля в центре нет — не путается с локальным поиском списков */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => openSearch()}
          aria-label={`${ui.topbar.smartSearch} (${ui.topbar.searchHint})`}
          title={`${ui.topbar.smartSearch} (${ui.topbar.searchHint})`}
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Search />
        </Button>

        {/* Приложение для Windows (#263): браузеру — загрузка установщика,
            без раздачи /desktop/ кнопки нет; в оболочке кнопка переезжает
            в панель окна (#1038, знак Nodus) — здесь не рендерится */}
        {!inShell ? <DownloadAppButton /> : null}

        {/* ИИ-ассистент — ЕДИНСТВЕННЫЙ видимый вход в топбаре (решение
            владельца 24.11.2026, #1021): вместо неработающей плашки «RU»;
            плавающий робот у кромки мессенджера и робот внизу служебной
            полосы убраны. Дублирующая горячая клавиша — Ctrl+J. Иконка —
            В ОБЩЕМ СТИЛЕ группы (muted, «как все» — правка владельца
            24.11.2026; прежнее «робот всегда цветной» было про робота в
            полосе, больше не существует). */}
        {assistantEnabled ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAssistantOpen(!assistantOpen)}
            aria-label={assistantOpen ? ui.assistant.close : ui.assistant.openHint}
            title={assistantOpen ? ui.assistant.close : ui.assistant.openHint}
            aria-pressed={assistantOpen}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Bot />
          </Button>
        ) : null}

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

        <BellPopover />

        {/* Профиль — правый верх мягкой рамы, справа от уведомлений (вердикт
            владельца 15.09.2026: служебная полоса — только аватарки коллег);
            в меню аватара — пункт «Что нового» (#1038: история обновлений
            переехала из строки топбара, обе поверхности). */}
        <ProfileMenu />
      </div>
    </header>
  );
}
