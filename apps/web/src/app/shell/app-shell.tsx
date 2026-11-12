import { Suspense, useCallback, useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';
import type { OpenLetterEvent } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Toaster } from '@nodus/ui/components/sonner';
import { TooltipProvider } from '@nodus/ui/components/tooltip';

import { registerCardBridge, registerReplaceTopMessenger } from '../../shared/lib/card-bridge.js';
import { SurfaceVisibilityProvider } from '../../shared/lib/surface-visibility.js';
import { startAttentionTracking } from '../../shared/attention/attention-store.js';
import { stageMessengerThread } from '../../shared/chat/messenger-nav.js';
import { ChatDialogHosts } from '../../shared/chat/dialog-hosts.js';
import { TaskCreateHost } from '../../shared/tasks/task-create-host.js';
import { ProjectCreateHost } from '../../features/projects/components/project-create-host.js';
import { NumberConfirmHost } from '../../shared/custom-fields/number-confirm.js';
import { AttachmentViewer } from '../../shared/files/attachment-viewer.js';
import { NotificationToasts } from '../../features/notifications/components/notification-toasts.js';
import { useNotificationSink } from '../../features/notifications/model/use-notification-sink.js';
import { WhatsNewPanel } from '../../features/whats-new/components/whats-new-panel.js';
import { useWhatsNewAutoOpen } from '../../features/whats-new/model/use-whats-new-auto-open.js';
import { useUnreadTitle } from '../../shared/chat/unread-title.js';
import { useDesktopBridge } from '../../shared/desktop/use-desktop-bridge.js';
import { desktopSetUiTheme } from '../../shared/desktop/desktop-bridge.js';
import { useChatSocket } from '../../shared/socket/use-chat-socket.js';
import { WsDebugBadge } from '../../shared/socket/ws-debug-badge.js';
import { CircuitFrame } from './circuit-frame.js';
import { CardStackHost } from './card-stack-host.js';
import { CommandPalette } from './command-palette.js';
import { EdgeScrollbar } from './edge-scrollbar.js';
import { LiveGraph } from './live-graph.js';
import { startLayoutJitterLogger } from './layout-jitter-logger.js';
import { NodeRail } from './node-rail.js';
import { EDGE_W_COLLAPSED, EDGE_W_EXPANDED, RightRail } from './right-rail.js';
import { useRailHidden } from './rail-visibility.js';
import { useShellStore } from './shell-store.js';
import { TopBar } from './top-bar.js';
import { useCardStack, useOpenCard, useOpenCards, useReplaceTopCard } from './use-card-stack.js';
import { useLinkInterception } from './use-link-interception.js';
import { startPreferencesSync } from '../../shared/preferences/ui-prefs-sync.js';

function ShellFallback() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="w-full flex-1" />
    </div>
  );
}

/** Каркас приложения (§10.2) в теме «Инструмент»: рейка-магистраль 240px ·
 * топбар · правая полоса 56px · слайдеры. Фон — плоский (реф node-based UI);
 * легаси-граф монтируется только в нагрузочном режиме `?stress=N` (harness
 * для будущей итерации живого фона, тест graph-stress). */
export function AppShell() {
  const theme = useShellStore((s) => s.theme);
  const openCard = useOpenCard();
  const openCards = useOpenCards();
  const cardStack = useCardStack();
  const replaceTopCard = useReplaceTopCard();
  // Ссылки портала (#644): внутренние карточки — стеком, внешние в десктопе —
  // системным браузером через мост open_external (иначе клики глушились ACL).
  useLinkInterception(openCards);
  // Геометрия вьюера вложений = канон карточек (ADR-0009): правый край у
  // служебной полосы; на модуле мессенджера полоса скрыта — stripW=0.
  const edgeOpen = useShellStore((s) => s.edgeOpen);
  const railHidden = useRailHidden();
  const viewerStripW = railHidden ? 0 : edgeOpen ? EDGE_W_EXPANDED : EDGE_W_COLLAPSED;
  // WS чата (#104): живёт с сессией, тихий статус; поллинг — fallback.
  useChatSocket();
  useNotificationSink();
  // «Что нового» (#386): после обновления прода панель выезжает сама один раз.
  useWhatsNewAutoOpen();
  // Диагностика «карточка дёргается» (#132 р.11): только ?wsdebug=1 — кадровые
  // логи [jitter] смещений ключевых контейнеров (см. layout-jitter-logger).
  useEffect(() => {
    startLayoutJitterLogger();
    // Модель внимания (#770, ADR-0038): видимость/фокус окна и ввод —
    // единый источник для квитанций прочтения, попапов и догона ленты.
    startAttentionTracking();
    // Личные настройки (#745): GET после входа + debounce PUT изменений;
    // при смене пользователя стор перечитывает свой localStorage-ключ.
    startPreferencesSync();
  }, []);
  // (N) Nodus в заголовке вкладки (#124): сигнал фоновой вкладке.
  useUnreadTitle();
  // Мост десктоп-оболочки (#254): попапы-ответы, deep link, видимость трея.
  // Открытие письма из попапа (#618) — через стек карточек (app-слой);
  // колбэк стабилен (useCallback): ре-бинд слушателей моста — только на
  // монтировании, лишний shellReady/запрос проверки обновлений не летит.
  const openLetterFromPopup = useCallback(
    ({ letterId }: OpenLetterEvent) => openCard({ kind: 'letter', id: letterId }),
    [openCard],
  );
  useDesktopBridge({ onOpenLetter: openLetterFromPopup });
  // Тосты уведомлений (#100): поверх карточек (z-[70] внутри хоста).
  const stressMode =
    typeof window !== 'undefined' &&
    Number(new URLSearchParams(window.location.search).get('stress') ?? 0) >= 1000;

  // Мост shared→стек карточек (порт-адаптер, card-bridge.ts): shared-слой
  // открывает карточки, не импортируя каркас (направление слоёв, аудит #45).
  useEffect(
    () => registerCardBridge((ref) => openCard(ref as Parameters<typeof openCard>[0])),
    [openCard],
  );

  // Подмена верхней мессенджер-карточки (вердикт 25.09, п.4): переход к
  // беседе-приёмнику пересылки происходит ВНУТРИ открытого слайдера (замена
  // id без ремаунта, useReplaceTopCard); тред приёмника — через messenger-nav.
  useEffect(
    () =>
      registerReplaceTopMessenger(({ conversationId, threadRootId }) => {
        const top = cardStack[cardStack.length - 1];
        if (!top || top.kind !== 'messenger') return false;
        stageMessengerThread(conversationId, threadRootId);
        replaceTopCard({ kind: 'messenger', id: conversationId });
        return true;
      }),
    [cardStack, replaceTopCard],
  );

  useEffect(() => {
    const root = document.documentElement;
    // Дефолт — СВЕТЛАЯ (вердикт владельца 15.09.2026): она в :root без
    // атрибута; тёмная включается data-theme='dark' (до первой отрисовки
    // persisted-выбор ставит inline-скрипт index.html — без вспышки).
    if (theme === 'light') delete root.dataset.theme;
    else root.dataset.theme = theme;
    // Десктоп-оболочка (#254): попапы следуют теме ПРИЛОЖЕНИЯ, не Windows.
    void desktopSetUiTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useShellStore.getState().setCommandOpen(!useShellStore.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <TooltipProvider>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        {ui.common.skipToContent}
      </a>
      <div className="flex h-screen overflow-hidden bg-background">
        {stressMode ? <LiveGraph /> : null}
        <NodeRail />
        <div className="relative flex min-w-0 flex-1">
          {/* Мягкая рама: топбар + рабочая зона ОДНОЙ мягкой панелью (18px,
              фон «лист»). Служебная полоса (профиль + коллеги) — ЗА пределами
              рамы, в правом периметре (план владельца 14.09.2026, R4): у рамы
              нет правого отступа, её правый край = левый край полосы; щель
              периметра 8px — справа от полосы (mr-2 полосы). Раскрытие полосы
              РЕФЛОУ: рама (flex-1) сужается влево синхронно с ростом ширины
              полосы; скроллбар страниц — у правого шва рамы. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className="frame-shadow mt-2 mb-2 ml-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card"
              data-soft-frame
            >
              <TopBar />
              <div id="content" className="relative flex min-h-0 flex-1 flex-col">
                {/* Непустой стек карточек НАКРЫВАЕТ страницу (ADR-0009):
                    поверхность раздела не видима — её чаты не читают и не
                    глушат попапы (#770). Карточки живут снаружи провайдера. */}
                <SurfaceVisibilityProvider visible={cardStack.length === 0}>
                  <Suspense fallback={<ShellFallback />}>
                    <Outlet />
                  </Suspense>
                </SurfaceVisibilityProvider>
              </div>
            </div>
            {/* Стек карточек сущностей поверх раздела (ADR-0009, ?cards=) */}
            <CardStackHost />
          </div>
          <RightRail />
        </div>
      </div>
      <CircuitFrame />
      <EdgeScrollbar />
      <WsDebugBadge />
      <NotificationToasts />
      <CommandPalette />
      <WhatsNewPanel />
      <ChatDialogHosts />
      {/* Единое окно создания задачи (#432): один хост на все входы. */}
      <TaskCreateHost />
      {/* Единое окно создания проекта (#52): журнал и пикер проекта. */}
      <ProjectCreateHost />
      {/* Окно «В номере есть незаполненное поле» (#630): одно на все
          действия, выдающие номер (кнопка процесса, создание, смена типа). */}
      <NumberConfirmHost />
      <AttachmentViewer stripW={viewerStripW} />
      <Toaster richColors theme={theme} />
    </TooltipProvider>
  );
}
