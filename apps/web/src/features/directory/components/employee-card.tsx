import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { useAssigneeTasks, useMemberProjects } from '../../../shared/api/user-relations.js';
import { ApiError } from '../../../shared/api-client.js';
import { useDirectConversation } from '../../../shared/chat/chat-queries.js';
import {
  subscribeEmployeeCardTab,
  takeEmployeeCardTab,
} from '../../../shared/chat/employee-card-nav.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { chatCeiling, chatColumnPx } from '../../../shared/ui/branch-panel.js';
import {
  CHAT_PANEL_W,
  ChatSidePanel,
  MIN_FEED_WITH_PANEL,
  useChatSidePanel,
} from '../../../shared/chat/chat-side-panel.js';
import { ConversationPane } from '../../../shared/chat/conversation-pane.js';
import { useCloseCard } from '../../../app/shell/use-card-stack.js';
import { openTaskCreate } from '../../../shared/tasks/task-create-store.js';
import { MIN_CHAT_W, useChatWidth } from '../../../shared/ui/use-chat-width.js';
import { useEmployeePresence, useUserCard, useUsersList } from '../api/directory-api.js';
import { profileSubordinates } from '../lib/profile-subordinates.js';
import { useCanManageDirectory } from '../lib/use-can-manage-directory.js';
import { EmployeeProfileBar } from './employee-actions-menu.js';
import { EmployeeCardSkeleton } from './employee-card-skeleton.js';
import { EmployeeCardWorkTabs, type EmployeeWorkTab } from './employee-card-work-tabs.js';
import { EmployeeProfileDialog } from './employee-profile-dialog.js';
import { InvitedCardPanel } from './invited-card-panel.js';
import { EmployeeProfileTab } from './employee-profile-tab.js';

/**
 * Карточка сотрудника (стек карточек, ADR-0009) — анатомия карточки профиля
 * (вердикт владельца 11.11.2026): главный объект — ЧЕЛОВЕК, поэтому профиль
 * живёт постоянной ЛЕВОЙ зоной (большое фото, presence, поля-реестр полного
 * UserCard, «Подчинённые», свой скролл) и вкладкой не бывает. СПРАВА —
 * рабочая зона: полоса вкладок карточек «Чат» (своя карточка — «Избранное»),
 * «Задачи», «Проекты» со счётчиками и контентом, который монтируется при
 * первом показе и живёт скрытым (`EmployeeCardWorkTabs`, канон карточки
 * задачи). Личный диалог (find-or-create) — вкладка «Чат», запрос уходит
 * только при первом её открытии (#972): открытие профиля из мессенджера
 * начинается с «Задач» и не создаёт диалог молча; панель беседы —
 * полновысотный сиблинг, её тоггл — в полосе вкладок и только у чата; ширина
 * правой зоны — перегородка с памятью, профиль забирает остаток (чат —
 * буфер сужений: рельса и панель сужают его до пола, дальше — левую зону).
 * Кнопки «Написать сообщение» нет — чат уже здесь.
 */
export function EmployeeCard({ userId, dormant = false }: { userId: string; dormant?: boolean }) {
  const { data: card, isLoading } = useUserCard(userId);
  const { data: usersData } = useUsersList();
  const tasksQuery = useAssigneeTasks(userId);
  const projectsQuery = useMemberProjects(userId, { enabled: projectsAvailable() });
  const meId = useAuthStore((s) => s.user?.id);
  const closeCard = useCloseCard();
  // Активная вкладка правой зоны (память не вводим — личные настройки/engine,
  // #744/#746). Дефолт — чат, но внешнее открытие из мессенджера (#972)
  // пристаивает «Задачи»: профиль должен открываться как профиль, а не
  // копией текущего диалога. Пристойка одноразовая (employee-card-nav).
  const [tab, setTab] = useState<EmployeeWorkTab>(() => takeEmployeeCardTab(userId) ?? 'chat');
  // Окно профиля — одно на карточку (#923); кнопка в нижней полосе левой зоны.
  const [editOpen, setEditOpen] = useState(false);
  // Вкладка после первого показа не размонтируется: скролл/фильтры журналов
  // и черновик чата живут.
  const [visited, setVisited] = useState<readonly EmployeeWorkTab[]>(() => [tab]);
  // Подмена сотрудника в той же карточке стека (replaceTop) — вкладки
  // принадлежали прежнему человеку: сброс в рендер-тайме (канон React, как у
  // мессенджер-карточки); стартовая — из свежей пристойки.
  const [prevUserId, setPrevUserId] = useState(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    const nextTab = takeEmployeeCardTab(userId) ?? 'chat';
    setTab(nextTab);
    setVisited([nextTab]);
    setEditOpen(false);
  }
  // Живая карточка: клик по аватару/шапке ДРУГОГО представления того же
  // сотрудника при уже верхней карточке (openCard — no-op) тоже переключает
  // на «Задачи» — иначе пристойка оставалась бы непотреблённой. Спящая
  // (нижняя в стеке) карточка НЕ потребляет пристойку: новая карточка того же
  // сотрудника монтируется сверху и должна получить «Задачи» сама.
  useEffect(() => {
    if (dormant) return;
    return subscribeEmployeeCardTab(() => {
      const nextTab = takeEmployeeCardTab(userId);
      if (!nextTab) return;
      setTab(nextTab);
      setVisited((prev) => (prev.includes(nextTab) ? prev : [...prev, nextTab]));
    });
  }, [userId, dormant]);
  // Личный диалог — find-or-create (POST, #343): открытие ПРОФИЛЯ не должно
  // молча создавать диалог. Запрос уходит только после первого открытия
  // вкладки «Чат» (до этого данные не нужны ни ленте, ни панели беседы).
  const directQuery = useDirectConversation(userId, {
    enabled: card?.status !== 'invited' && visited.includes('chat'),
  });
  const panel = useChatSidePanel();
  // Панель беседы видна ТОЛЬКО на вкладке чата: уход на журнал её прячет,
  // panel.open не сбрасывается — возврат восстанавливает открытое состояние.
  const panelVisible = panel.open && tab === 'chat';
  const chatRef = useRef<HTMLDivElement>(null);
  // КАНОН «чат — буфер сужений» (issue #63): панель беседы сужает ПРАВУЮ зону
  // до её минимума (лента 360 при панели, иначе drag-пол MIN_CHAT_W); профиль
  // слева не двигается, пока хватает места, дальше сужение выталкивает его
  // (без пола — жёсткий пол обрезал чат за краем карточки). Окно ассистента —
  // оверлей поверх рамы, геометрию карточек не двигает.
  const shrink = panelVisible ? CHAT_PANEL_W : 0;
  const chatFloor = panelVisible ? MIN_FEED_WITH_PANEL : MIN_CHAT_W;
  // Порядок уступок #750: при узкой карточке правая зона отдаёт ширину
  // ПРОФИЛЮ (минимум данных 320 — как у колонки данных задачи/письма), но не
  // ниже своего пола; на широкой — работает память перегородки. Меряем РЯД
  // карточки (сетка + панель беседы), а не живую ширину сетки: сетка растёт
  // и сжимается вместе с анимацией панели, и потолок от неё перецеливал бы
  // transition ширины чата каждый кадр — профиль раздувался и возвращался
  // (приёмка 11.11.2026). Ширина ряда — layout-размер (clientWidth), не rect:
  // FLIP-раскрытие карточки масштабирует transform, rect отдал бы ширину
  // источника (канон JS-геометрии карточек).
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowW, setRowW] = useState(0);
  // Меряем ряд, когда карточка уже отрисована (скелетон ряд не рендерит).
  const ready = !isLoading && Boolean(card) && Boolean(usersData);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setRowW(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);
  // Панель беседы — СТОЯЩЕЕ сужение ряда: потолок знает о её ширине сразу,
  // а не догоняет растущую сетку во время анимации.
  const ceiling = chatCeiling(rowW, panelVisible ? CHAT_PANEL_W : 0);
  const { chatW, onDividerDown, dragging } = useChatWidth(chatRef, shrink, chatFloor, ceiling);
  // Ширина правой зоны — целые px (#969): при дробном --ui-scale/DPR полупиксельная
  // ширина давала слою дробное смещение и «мягкие» края текста; сумма колонок
  // ряда от этого не зависит (профиль — `1fr`, чат — `auto`).
  const columnW = chatColumnPx(chatW, shrink, chatFloor, ceiling);

  const items = useMemo(() => usersData?.items ?? [], [usersData]);
  const listItem = items.find((u) => u.id === userId);
  const manager = card?.managerId ? items.find((u) => u.id === card.managerId) : undefined;
  // «Подчинённые» (#923): прямые по `managerId` + замы подразделений, где
  // сотрудник глава (зам — роль отдела, в manager_id не входит).
  const departments = useDepartmentsList();
  const { list: subordinates, deputyIds } = useMemo(
    () => profileSubordinates({ userId, users: items, departments }),
    [items, userId, departments],
  );
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
    // линии полосы вкладок правой зоны. Ряд карточки — база потолка ширины
    // чата (см. chatCeiling): панель входит в его ширину.
    <div ref={rowRef} className="flex h-full min-w-0">
      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
      >
        {/* ЛЕВАЯ ЗОНА — профиль сотрудника, всегда на экране и со своим
            скроллом (регион для скринридеров); граница — структурная.
            `@container/zone` — ширина ЗОНЫ для того, что живёт вне колонки
            полей (полоса действий, заголовок при переносе под фото).
            Порог 1↔2 у самих полей считается по их колонке (исходная
            динамика #750: поля встают справа от фото, когда зона широкая). */}
        <div
          role="region"
          aria-label={ui.employees.tabProfile}
          className="relative flex min-h-0 flex-col border-r border-border @container/zone"
        >
          <div className="content-fade min-h-0 flex-1 overflow-hidden">
            <EmployeeProfileTab
              card={card}
              listItem={listItem}
              manager={manager}
              subordinates={subordinates}
              deputyIds={deputyIds}
              presenceStatus={presenceStatus}
              canEditAvatar={card.id === meId}
            />
          </div>

          {/* Нижняя полоса левой зоны (#923): «Редактировать профиль» и
              «Действия» (только админ), вне скролла; нет кнопок — нет полосы. */}
          <EmployeeProfileBar
            card={card}
            canManage={canManage}
            onEdit={() => setEditOpen(true)}
            onCloseCard={closeCard}
          />
          {editOpen ? (
            <EmployeeProfileDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              card={card}
              users={items}
              canManage={canManage}
            />
          ) : null}

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
          {card.status === 'invited' ? (
            <InvitedCardPanel />
          ) : (
            <EmployeeCardWorkTabs
              active={tab}
              visited={visited}
              onActivate={activateTab}
              isOwnCard={card.id === meId}
              userId={userId}
              chat={chat}
              tasks={tasks}
              onCreateTask={() => openTaskCreate({ assigneeId: userId })}
              projects={projects}
              panelOpen={panelVisible}
              onPanelToggle={panel.toggle}
            />
          )}
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
