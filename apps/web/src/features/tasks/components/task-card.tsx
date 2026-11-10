import { useCallback, useMemo, useRef, useState } from 'react';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useReplaceTopCard } from '../../../app/shell/use-card-stack.js';
import { ApiError } from '../../../shared/api-client.js';
import { useReadEntityNotifications } from '../../../shared/api/read-entity-notifications.js';
import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { ViewerHostProvider } from '../../../shared/files/viewer-host.js';
import { CardDataSplitter } from '../../../shared/ui/entity-card/card-data-splitter.js';
import {
  CardWidthHint,
  PANEL_HIDDEN_HINT,
} from '../../../shared/ui/entity-card/card-width-hint.js';
import { solveCardWidths } from '../../../shared/ui/entity-card/card-tabs-width.js';
import { useCardTabs } from '../../../shared/ui/entity-card/use-card-tabs.js';
import { useElementWidth } from '../../../shared/ui/use-element-width.js';
import { useTaskDetail } from '../api/tasks-api.js';
import { useBranchWidth } from '../lib/use-branch-width.js';
import { useTaskCardLayout } from '../lib/task-card-type-layout.js';
import { fileTabId, type TaskTabId } from '../lib/task-tabs.js';
import { useTaskTabs } from '../lib/use-task-tabs.js';
import { TaskAboutDrawer } from './task-about-drawer.js';
import { TaskBranchDrawer } from './task-branch-drawer.js';
import { TaskCardDataPanel } from './task-card-data-panel.js';
import { TaskCardSideTabs } from './task-card-side-tabs.js';
import { TaskCardSkeleton } from './task-card-skeleton.js';
// Побочный эффект: регистрация превью ссылки на задачу в чате (#645).
import './task-link-preview.js';

/** Стабильные вкладки задачи: «Чат» — постоянная; вложения динамические. */
const TASK_STABLE_TABS = ['chat'] as const;
/** Панель «О задаче» — 360 px; не сжимается, при нехватке временно скрыта. */
const ABOUT_W = 360;

/**
 * Карточка задачи (редизайн 04.11.2026; области вкладок — #746): слева
 * навигатор ветки и панель данных, справа — ОБЛАСТИ вкладок (1–2): «Чат»
 * и файлы. Ширины решает solver: чат — буфер, данные 340→320, вторая
 * область и «О задаче» временно уступают, при расширении всё возвращается.
 * Панель данных можно тянуть (min 320), порядок/области/ширины — личные
 * (#745). Файловые вкладки монтируются один раз и переезжают между
 * областями без ремаунта (зум/скролл живы).
 */
export function TaskCard({ taskId }: { taskId: string }) {
  const { data: task, isLoading, error } = useTaskDetail(taskId);
  useReadEntityNotifications('task', taskId);
  const { data: conversation } = useTaskConversation(taskId);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutMounted, setAboutMounted] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchMounted, setBranchMounted] = useState(false);
  const { tabs, openFile, closeFile, activateTab } = useTaskTabs(taskId);
  const replaceTopCard = useReplaceTopCard();
  const [rootId] = useState(taskId);
  const [history, setHistory] = useState<string[]>([]);

  const navigateInCard = useCallback(
    (id: string) => {
      if (id === taskId) return;
      setHistory((h) => [...h, taskId]);
      setBranchMounted(true);
      setBranchOpen(true);
      replaceTopCard({ kind: 'task', id });
    },
    [taskId, replaceTopCard],
  );

  const navigateBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      replaceTopCard({ kind: 'task', id: prev });
      return h.slice(0, -1);
    });
  }, [replaceTopCard]);

  const rowRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  // Ветка больше не диктует ширину чата формулой: перегородка меняет только
  // свою колонку, остальное пересчитывает solver. Пустой ref — чтобы старая
  // механика не трогала ширину рабочей зоны.
  const noChatRef = useRef<HTMLDivElement>(null);
  const rowWidth = useElementWidth(rowRef);
  const branch = useBranchWidth({ rowRef, branchRef, chatRef: noChatRef });
  const branchActualW = useElementWidth(branchRef);
  const closeBranch = useCallback(() => setBranchOpen(false), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  const fileTabs = tabs.files.map((file) => fileTabId(file.fileId));
  const cardTabs = useCardTabs({
    kind: 'task',
    stableTabs: TASK_STABLE_TABS,
    fileTabs,
    defaultActive: 'chat',
    requestedActive: tabs.active,
  });
  const { state } = cardTabs;

  // Ветка — первая уступка: не влезает вместе с данными и чатом — временно
  // скрыта (prefs не меняются), при расширении вернётся.
  const branchRendered =
    branchOpen && rowWidth >= 320 + 420 + Math.min(branch.branchW, rowWidth / 2);
  const effectiveBranchW = branchRendered ? branchActualW : 0;

  const solved = useMemo(
    () =>
      solveCardWidths({
        rowWidth: Math.max(0, rowWidth - effectiveBranchW),
        dataEnabled: true,
        dataPref: cardTabs.widths.data,
        panelOpen: aboutOpen,
        panelW: ABOUT_W,
        groups: state.groups.map((group, index) => ({
          id: group.id,
          isChat: group.tabs.includes('chat'),
          prefW: cardTabs.widths.groups?.[index],
        })),
      }),
    [aboutOpen, cardTabs.widths, effectiveBranchW, rowWidth, state.groups],
  );
  const dataW = solved.dataW || 340;
  const dataMax = Math.max(
    320,
    rowWidth - effectiveBranchW - (solved.panelRendered ? ABOUT_W : 0) - 280,
  );

  // Состав карточки по типу (#432, Р7) — хук до ранних возвратов.
  const layout = useTaskCardLayout(task ?? null);

  // Задачи нет (удалена, сняли с участия, чужая ссылка): объяснение вместо
  // вечного скелетона.
  if (!task && error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {errorMessages[ErrorCode.NOT_FOUND]}
      </div>
    );
  }
  if (isLoading || !task) {
    return <TaskCardSkeleton chatW={solved.groupW[0] ?? 680} />;
  }

  const showChat = layout.blockVisible('chat');
  const showBranch = layout.blockVisible('subtasks') || layout.blockVisible('relations');

  return (
    <ViewerHostProvider open={openFile}>
      <div className="flex h-full min-w-0">
        <div ref={rowRef} className="relative flex min-h-0 flex-1">
          <div
            ref={branchRef}
            className={cn(
              'min-h-0 shrink-0 overflow-hidden',
              !branch.dragging && 'transition-[width] duration-200 ease-out',
            )}
            style={{ width: branchRendered ? branch.branchW : 0 }}
          >
            {branchMounted ? (
              <TaskBranchDrawer
                rootId={rootId}
                currentId={taskId}
                canBack={history.length > 0}
                onBack={navigateBack}
                onNavigate={navigateInCard}
                onClose={closeBranch}
              />
            ) : null}
          </div>

          <div
            ref={dataRef}
            className="@container relative flex min-h-0 shrink-0 flex-col border-r border-border"
            style={{ width: dataW, minWidth: dataW }}
          >
            {branchRendered ? (
              <div
                onPointerDown={(event) =>
                  branch.onDividerDown(event, { floor: 280, widthFor: (w) => w })
                }
                onDoubleClick={branch.onDividerReset}
                role="separator"
                aria-orientation="vertical"
                aria-label={ui.common.resizePanel}
                title={ui.common.resizePanel}
                className="group absolute top-0 left-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize"
              >
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            ) : null}
            <TaskCardDataPanel
              task={task}
              layout={layout}
              onOpenSubtask={navigateInCard}
              showBranch={showBranch}
              branchOpen={branchOpen}
              onToggleBranch={() => {
                setBranchMounted(true);
                setBranchOpen((v) => !v);
              }}
            />
            <CardDataSplitter
              dataRef={dataRef}
              dataW={dataW}
              max={dataMax}
              onCommit={cardTabs.setDataWidth}
              onReset={() => cardTabs.setDataWidth(340)}
            />
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <TaskCardSideTabs
              task={task}
              tabs={tabs}
              conversation={conversation}
              aboutOpen={aboutOpen}
              showAbout={showChat}
              state={state}
              groupW={solved.groupW}
              collapsedGroupId={solved.collapsedGroupId}
              onStateChange={cardTabs.setState}
              onGroupWidthsChange={cardTabs.setGroupWidths}
              groupMin={(group) =>
                group.tabs.includes('chat') ? (solved.panelRendered ? 280 : 420) : 280
              }
              onActivate={(tab: TaskTabId) => activateTab(tab)}
              onClose={closeFile}
              onToggleAbout={() => {
                setAboutMounted(true);
                setAboutOpen((v) => !v);
              }}
            />
            {aboutOpen && !solved.panelRendered ? (
              <CardWidthHint text={PANEL_HIDDEN_HINT} className="absolute top-11 right-2 z-10" />
            ) : null}
          </div>

          <div
            className={cn(
              'h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
              !solved.panelRendered && 'w-0',
            )}
            style={{ width: solved.panelRendered ? ABOUT_W : 0 }}
          >
            {aboutMounted ? <TaskAboutDrawer task={task} onClose={closeAbout} /> : null}
          </div>
        </div>
      </div>
    </ViewerHostProvider>
  );
}
