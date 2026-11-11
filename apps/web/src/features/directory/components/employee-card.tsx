import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useAssigneeTasks, useMemberProjects } from '../../../shared/api/user-relations.js';
import { ApiError } from '../../../shared/api-client.js';
import { useDirectConversation } from '../../../shared/chat/chat-queries.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useRailShrink } from '../../../app/shell/right-rail.js';
import { ROW_MAIN_MIN_W, chatColumnWidth } from '../../../shared/ui/branch-panel.js';
import {
  CHAT_PANEL_W,
  ChatSidePanel,
  MIN_FEED_WITH_PANEL,
  useChatSidePanel,
} from '../../../shared/chat/chat-side-panel.js';
import { ConversationPane } from '../../../shared/chat/conversation-pane.js';
import { openTaskCreate } from '../../../shared/tasks/task-create-store.js';
import { MIN_CHAT_W, useChatWidth } from '../../../shared/ui/use-chat-width.js';
import { useEmployeePresence, useUserCard, useUsersList } from '../api/directory-api.js';
import { useCanManageDirectory } from '../lib/use-can-manage-directory.js';
import { EmployeeCardSkeleton } from './employee-card-skeleton.js';
import { EmployeeCardWorkTabs, type EmployeeWorkTab } from './employee-card-work-tabs.js';
import { EmployeeProfileTab } from './employee-profile-tab.js';

/**
 * Карточка сотрудника (стек карточек, ADR-0009) — анатомия карточки профиля
 * (вердикт владельца 11.11.2026): главный объект — ЧЕЛОВЕК, поэтому профиль
 * живёт постоянной ЛЕВОЙ зоной (большое фото, presence, поля-реестр полного
 * UserCard, «Подчинённые», свой скролл) и вкладкой не бывает. СПРАВА —
 * рабочая зона: полоса вкладок карточек «Чат» (своя карточка — «Избранное»),
 * «Задачи», «Проекты» со счётчиками и контентом, который монтируется при
 * первом показе и живёт скрытым (`EmployeeCardWorkTabs`, канон карточки
 * задачи). Личный диалог (find-or-create) — вкладка «Чат»; панель беседы —
 * полновысотный сиблинг, её тоггл — в полосе вкладок и только у чата; ширина
 * правой зоны — перегородка с памятью, профиль забирает остаток (чат —
 * буфер сужений: рельса и панель сужают его до пола, дальше — левую зону).
 * Кнопки «Написать сообщение» нет — чат уже здесь.
 */
export function EmployeeCard({ userId }: { userId: string }) {
  const { data: card, isLoading } = useUserCard(userId);
  const { data: usersData } = useUsersList();
  const tasksQuery = useAssigneeTasks(userId);
  const projectsQuery = useMemberProjects(userId, { enabled: projectsAvailable() });
  const directQuery = useDirectConversation(userId);
  const meId = useAuthStore((s) => s.user?.id);
  // Активная вкладка правой зоны (память не вводим — личные настройки/engine,
  // #744/#746; дефолт всегда чат). Профиль слева — вне вкладок.
  const [tab, setTab] = useState<EmployeeWorkTab>('chat');
  // Вкладка после первого показа не размонтируется: скролл/фильтры журналов
  // и черновик чата живут.
  const [visited, setVisited] = useState<readonly EmployeeWorkTab[]>(['chat']);
  // Подмена сотрудника в той же карточке стека (replaceTop) — вкладки
  // принадлежали прежнему человеку: сброс в рендер-тайме (канон React, как у
  // мессенджер-карточки).
  const [prevUserId, setPrevUserId] = useState(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setTab('chat');
    setVisited(['chat']);
  }
  const panel = useChatSidePanel();
  // Панель беседы видна ТОЛЬКО на вкладке чата: уход на журнал её прячет,
  // panel.open не сбрасывается — возврат восстанавливает открытое состояние.
  const panelVisible = panel.open && tab === 'chat';
  const chatRef = useRef<HTMLDivElement>(null);
  // КАНОН «чат — буфер сужений» (issue #63): панель беседы и раскрытие
  // служебной полосы сужают ПРАВУЮ зону до её минимума (лента 360 при панели,
  // иначе drag-пол MIN_CHAT_W); профиль слева не двигается, пока хватает
  // места, дальше сужение выталкивает его (без пола — жёсткий пол обрезал чат
  // за краем карточки).
  const railShrink = useRailShrink();
  const shrink = railShrink + (panelVisible ? CHAT_PANEL_W : 0);
  const chatFloor = panelVisible ? MIN_FEED_WITH_PANEL : MIN_CHAT_W;
  // Порядок уступок #750: при узкой карточке правая зона отдаёт ширину
  // ПРОФИЛЮ (минимум данных 320 — как у колонки данных задачи/письма), но не
  // ниже своего пола; на широкой — работает память перегородки. Ширину ряда
  // меряем ResizeObserver'ом: % -max-width в auto-треке grid не работает.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);
  // Меряем ряд, когда карточка уже отрисована (скелетон grid не рендерит).
  const ready = !isLoading && Boolean(card) && Boolean(usersData);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setGridW(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);
  const ceiling = gridW > 0 ? gridW - ROW_MAIN_MIN_W : Number.POSITIVE_INFINITY;
  const { chatW, onDividerDown, dragging } = useChatWidth(chatRef, shrink, chatFloor, ceiling);
  const columnW = chatColumnWidth(chatW, shrink, chatFloor, ceiling);

  const items = useMemo(() => usersData?.items ?? [], [usersData]);
  const listItem = items.find((u) => u.id === userId);
  const manager = card?.managerId ? items.find((u) => u.id === card.managerId) : undefined;
  const subordinates = useMemo(() => items.filter((u) => u.managerId === userId), [items, userId]);
  const tasks = tasksQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];
  const presenceStatus = useEmployeePresence(userId);
  const canManage = useCanManageDirectory();

  if (isLoading || !card || !listItem) {
    return <EmployeeCardSkeleton chatW={columnW} />;
  }

  function activateTab(next: EmployeeWorkTab) {
    setTab(next);
    setVisited((prev) => (prev.includes(next) ? prev : [...prev, next]));
  }

  // Лента личного диалога: фон зоны — структура с первого кадра, шапки у
  // чата НЕТ (собеседник в хроме карточки) — канон панели беседы.
  const chat = (
    <div className="flex h-full w-full bg-background">
      <div className="content-fade min-h-0 min-w-0 flex-1">
        {directQuery.data ? (
          <ConversationPane
            conversationId={directQuery.data.id}
            showAuthor={false}
            emptyLabel={ui.chat.directEmpty}
          />
        ) : directQuery.isError ? (
          <div className="flex h-full items-center justify-center bg-chat-zone">
            <Empty>
              <EmptyTitle>
                {directQuery.error instanceof ApiError && directQuery.error.status === 404
                  ? ui.chat.directUnavailable
                  : ui.common.loadError}
              </EmptyTitle>
            </Empty>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-2/3" />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    // Панель беседы — ПОЛНОВЫСОТНЫЙ сиблинг всей карточки: её шапка h-10 на
    // линии полосы вкладок правой зоны.
    <div className="flex h-full min-w-0">
      <div
        ref={gridRef}
        className="grid min-h-0 min-w-0 flex-1"
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
      >
        {/* ЛЕВАЯ ЗОНА — профиль сотрудника, всегда на экране и со своим
            скроллом (регион для скринридеров); граница — структурная. */}
        <div
          role="region"
          aria-label={ui.employees.tabProfile}
          className="relative flex min-h-0 flex-col border-r border-border @container"
        >
          <div className="content-fade min-h-0 flex-1 overflow-hidden">
            <EmployeeProfileTab
              card={card}
              listItem={listItem}
              manager={manager}
              subordinates={subordinates}
              presenceStatus={presenceStatus}
              users={items}
              canEditAvatar={card.id === meId}
              canManage={canManage}
            />
          </div>

          {/* Ручка ресайза правой зоны: невидимый оверлей ПОВЕРХ структурной
              границы (память общая на все карточки — useChatWidth). */}
          <div
            onPointerDown={onDividerDown}
            role="separator"
            aria-orientation="vertical"
            aria-label={ui.common.resizePanel}
            title={ui.common.resizePanel}
            className="group absolute top-0 right-0 z-10 h-full w-3 translate-x-1/2 cursor-col-resize"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>

        {/* ПРАВАЯ ЗОНА — рабочая область: вкладки «Чат/Задачи/Проекты» и её
            содержимое. Ширина — перегородка с памятью и потолком «профиль не
            уже минимума данных» (порядок уступок #750); ease-out совпадает с
            анимацией панели, иначе сумма двух колонок «плывёт». */}
        <div
          ref={chatRef}
          className={cn(
            'min-h-0 overflow-hidden',
            !dragging && 'transition-[width] duration-200 ease-out',
          )}
          style={{ width: columnW }}
        >
          <EmployeeCardWorkTabs
            active={tab}
            visited={visited}
            onActivate={activateTab}
            isOwnCard={card.id === meId}
            chat={chat}
            tasks={tasks}
            tasksLoading={tasksQuery.isLoading}
            onCreateTask={() => openTaskCreate({ assigneeId: userId })}
            projects={projects}
            projectsLoading={projectsQuery.isLoading}
            panelOpen={panelVisible}
            onPanelToggle={panel.toggle}
          />
        </div>
      </div>
      {directQuery.data ? (
        <ChatSidePanel
          conversationId={directQuery.data.id}
          open={panelVisible}
          onClose={panel.close}
          title={ui.chat.aboutChat}
          headerClass="h-10"
        />
      ) : null}
    </div>
  );
}
