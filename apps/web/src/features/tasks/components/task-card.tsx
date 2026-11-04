import { useCallback, useRef, useState } from 'react';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useReplaceTopCard } from '../../../app/shell/use-card-stack.js';
import { useRailShrink } from '../../../app/shell/right-rail.js';
import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { ViewerHostProvider } from '../../../shared/files/viewer-host.js';
import {
  useChatWidth,
  MIN_CHAT_WITH_PANEL,
  MIN_CHAT_W,
} from '../../../shared/ui/use-chat-width.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import { ApiError } from '../../../shared/api-client.js';
import { useReadEntityNotifications } from '../../../shared/api/read-entity-notifications.js';
import { useTaskDetail } from '../api/tasks-api.js';
import { TaskAboutDrawer } from './task-about-drawer.js';
import { TaskBranchDrawer } from './task-branch-drawer.js';
import { TaskCardDataPanel } from './task-card-data-panel.js';
import { TaskCardSideTabs } from './task-card-side-tabs.js';
import { TaskCardSkeleton } from './task-card-skeleton.js';
import {
  MIN_TASK_MAIN_W,
  SHRINK_ORDER,
  chatColumnWidth,
  rowMinWidthsCss,
} from '../lib/task-card-layout.js';
import { useBranchWidth } from '../lib/use-branch-width.js';
import { useTaskCardLayout } from '../lib/task-card-type-layout.js';
import { useTaskTabs } from '../lib/use-task-tabs.js';

/** Ширина панели «О задаче»: на неё же сужается правая зона по общему канону
 *  буфера (ниже — пол, дальше двигается левая зона); панель полновысотная,
 *  её шапка h-10 продолжает полосу вкладок правой зоны (редизайн 04.11.2026). */
const ABOUT_W = uiPx(360);

/**
 * Карточка задачи (универсальный слайдер-слой; редизайн 04.11.2026): слева —
 * панель данных на всю высоту карточки (название — в хроме слайдера, в теле
 * не дублируется: описание, поля, атрибуты, чек-лист, подзадачи, результат +
 * замоноличенный нижний бар действий); справа — рабочая зона с полосой вкладок
 * на верхнем уровне: постоянный «Чат» (обсуждение задачи — обычная беседа
 * мессенджера) и закрываемые вкладки вложений (ONLYOFFICE, фулскрин — общей
 * модалкой). Утилиты прежней полосы цепочки — у правого края полосы вкладок;
 * «О задаче» — вталкивающая колонка справа. Доменная цепочка (граф связей)
 * пока не показывается — отдельного верхнего бара нет.
 * Раскладка зон и канон «чат — буфер сужений» — `task-card-layout.ts`.
 */
export function TaskCard({ taskId }: { taskId: string }) {
  const { data: task, isLoading, error } = useTaskDetail(taskId);
  // Открыл задачу — её уведомления прочитаны (#252: «Требуют внимания» не вечные).
  useReadEntityNotifications('task', taskId);
  // Беседа задачи — одна на карточку: счётчик «Чата» и панель «О задаче».
  const { data: conversation } = useTaskConversation(taskId);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Панель «О задаче» монтируется раз и остаётся: колонка анимируется
  // 0↔360px (плавный пуш), состояние (избранное, скролл) не теряется.
  const [aboutMounted, setAboutMounted] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  // Навигатор ветки монтируется раз и остаётся: колонка сетки анимируется
  // 0↔300px (плавный пуш контента), состояние панели не теряется.
  const [branchMounted, setBranchMounted] = useState(false);
  // Вкладки правой зоны: «Чат» по умолчанию + вложения.
  const { tabs, openFile, closeFile, activateTab } = useTaskTabs(taskId);
  const replaceTopCard = useReplaceTopCard();
  // Сессия навигации ветки (режим «Навигация», вердикт владельца 2026-09-11):
  // корень — СТАРТОВАЯ задача карточки (неизменен — карта дерева стабильна);
  // history — переходы для «←» в навигаторе. Замена верхней карточки стека
  // (без ремаунта панели): стек не растёт, один Escape закрывает всё.
  const [rootId] = useState(taskId);
  const [history, setHistory] = useState<string[]>([]);

  /** Переход к связанной задаче ЗАМЕНОЙ содержимого: из навигатора ветки и
   *  полей «Подзадачи»/«Связи». Панель автооткрывается — видно, куда пришли. */
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

  /** «←» навигатора: шаг назад по переходам сессии (тоже заменой). */
  const navigateBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      replaceTopCard({ kind: 'task', id: prev });
      return h.slice(0, -1);
    });
  }, [replaceTopCard]);
  const chatRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  // КАНОН «чат — буфер сужений» (issue #63, вердикт владельца 21.09.2026):
  // ЛЮБОЕ стоящее сужение ряда — рельса, навигатор ветки (его ТЕКУЩАЯ
  // тянущаяся ширина, #365), «О задаче» — сначала съедает колонку обсуждения
  // ДО ЕЁ МИНИМУМА (общий пол = drag-минимум MIN_CHAT_W; глубже — только
  // временное исключение открытой ПАНЕЛИ — «О задаче» или навигатора —
  // MIN_CHAT_WITH_PANEL); дальше —
  // порядок уступок flex-ряда (SHRINK_ORDER, разметка ниже). Рендер и оба
  // drag (чата и навигатора) ходят по ОДНОЙ формуле chatWidthFor, transition
  // колонки — те же 200мс ease-out, что у рельсы/панелей: сумма «ряд − чат»
  // постоянна покадрово, граница зон не дёргается.
  const railShrink = useRailShrink();
  const chatFloor = aboutOpen || branchOpen ? MIN_CHAT_WITH_PANEL : MIN_CHAT_W;
  const fixedShrink = (aboutOpen ? ABOUT_W : 0) + railShrink;
  const branch = useBranchWidth({ rowRef, branchRef, chatRef });
  const branchColumnW = branchOpen ? branch.branchW : 0;
  const { chatW, onDividerDown, dragging } = useChatWidth(
    chatRef,
    fixedShrink + branchColumnW,
    chatFloor,
  );
  const chatWidthFor = (branchW: number) =>
    chatColumnWidth(chatW, fixedShrink + branchW, chatFloor);
  const chatColumnW = chatWidthFor(branchColumnW);
  const resizing = dragging || branch.dragging;
  const rowMins = rowMinWidthsCss(chatFloor, branchOpen);
  // Стабильные колбэки: дочерние панели мемоизированы (memo).
  const closeBranch = useCallback(() => setBranchOpen(false), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  // Состав карточки по типу (#432, Р7) — хук до ранних возвратов (порядок
  // хуков неизменен); без данных — умолчания (полная карточка).
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
    return <TaskCardSkeleton chatW={chatColumnW} />;
  }

  const showChat = layout.blockVisible('chat');
  const showBranch = layout.blockVisible('subtasks') || layout.blockVisible('relations');

  return (
    // Панель «О задаче» — ПОЛНОВЫСОТНЫЙ сиблинг всей карточки (геометрия
    // Битрикс24, вердикт владельца 15.09.2026): занимает верхнюю полосу
    // карточки тоже, её шапка продолжает полосу вкладок, тоггл уезжает влево.
    // Вся карточка — хост просмотра вложений: файл из чата/витрины/результата
    // открывается вкладкой правой зоны, а не модалкой поверх.
    <ViewerHostProvider open={openFile}>
      <div className="flex h-full min-w-0">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Ряд «навигатор | данные задачи | вкладки» (#365): хватает места —
            центр забирает остаток (канон буфера сужений); не хватает — CSS сам
            ужимает навигатор, затем правую зону до пола (SHRINK_ORDER);
            минимумы колонок — rowMinWidthsCss (центр ≥ MIN_TASK_MAIN_W, пока
            ряд вмещает). Без замеров и setState на кадр; drag перегородок —
            императивно в rAF без transition (gotchas). min-width — тем же
            темпом, что ширина. */}
          <div ref={rowRef} className="relative flex min-h-0 flex-1">
            <div
              ref={branchRef}
              className={cn(
                'min-h-0 overflow-hidden',
                !resizing && 'transition-[width,min-width] duration-200 ease-out',
              )}
              style={{
                width: branchColumnW,
                minWidth: rowMins.branch,
                flexShrink: SHRINK_ORDER.branch,
              }}
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
            {/* Левая зона: начинается от ВЕРХА карточки (полосы цепочки нет),
              скроллится только контент; нижний бар действий замоноличен (не
              двигается скроллом — модель Битрикса). border-r — СТРУКТУРНАЯ
              вертикальная граница с правой зоной: горизонтальные линии бара
              действий и композера упираются ровно в неё (вердикт владельца о
              несходящихся линиях). Ручка ресайза — оверлей поверх границы
              (внутри этой зоны, не съедает трек).
              @container — сетка полей перестраивается от ширины зоны (ресайз). */}
            <div
              className={cn(
                'relative flex min-h-0 flex-col border-r border-border @container',
                !resizing && 'transition-[min-width] duration-200 ease-out',
              )}
              style={{
                flex: `1 ${SHRINK_ORDER.main} ${MIN_TASK_MAIN_W}px`,
                minWidth: rowMins.main,
              }}
            >
              {/* Перегородка навигатора ветки (#365): оверлей поверх его границы
                (border-r панели = левый край этой зоны), механика ручки чата;
                двойной клик — дефолтная ширина. */}
              {branchOpen ? (
                <div
                  onPointerDown={(e) =>
                    branch.onDividerDown(e, { floor: chatFloor, widthFor: chatWidthFor })
                  }
                  onDoubleClick={branch.onDividerReset}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={ui.common.resizePanel}
                  title={ui.common.resizePanel}
                  className="group absolute top-0 left-0 z-10 h-full w-3 -translate-x-1/2 cursor-col-resize"
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

              {/* Ручка ресайза правой зоны: невидимый оверлей ПОВЕРХ структурной
                границы (border-r зоны) — hit-area 12px центрирована на линии,
                трека в сетке нет, линии зон сходятся в одну вертикаль */}
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

            {/* Правая зона — вкладки «Чат» (постоянная) и вложения. Тёмный фон
              зоны — структура (виден с первого кадра роста, НЕ появляется
              вместе с контентом — иначе читается как смена цвета в середине
              раскрытия). БУФЕР СУЖЕНИЙ (issue #63): рельса/ветка/«О задаче»
              сужают ЭТУ колонку (chatColumnW, те же 200мс ease-out, что у
              источника сужения) — левая зона и разделитель стоят на месте;
              после упора в минимум (MIN_CHAT_W, при открытой панели —
              MIN_CHAT_WITH_PANEL) — порядок уступок ряда. */}
            <div
              ref={chatRef}
              className={cn(
                'min-h-0 overflow-hidden',
                // transition — ТОЛЬКО для программного toggle панелей;
                // во время ручного drag — снят, ширина идёт императивно (gotchas)
                !resizing && 'transition-[width,min-width] duration-200 ease-out',
              )}
              style={{ width: chatColumnW, minWidth: chatFloor, flexShrink: SHRINK_ORDER.chat }}
            >
              <TaskCardSideTabs
                task={task}
                tabs={tabs}
                conversation={conversation}
                aboutOpen={aboutOpen}
                showAbout={showChat}
                onActivate={activateTab}
                onClose={closeFile}
                onToggleAbout={() => {
                  setAboutMounted(true);
                  setAboutOpen((v) => !v);
                }}
              />
            </div>
          </div>
        </div>
        {/* Панель «О задаче» — полновысотная вталкивающая колонка справа (не
          оверлей: чат и кнопка отправки остаются доступны — вердикт владельца;
          занимает верхнюю полосу карточки, шапка панели продолжает полосу
          вкладок). */}
        <div
          className={cn(
            'h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            aboutOpen ? 'w-[22.5rem]' : 'w-0',
          )}
        >
          {aboutMounted ? <TaskAboutDrawer task={task} onClose={closeAbout} /> : null}
        </div>
      </div>
    </ViewerHostProvider>
  );
}
