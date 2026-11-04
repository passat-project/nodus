import { useEffect, useRef, useState } from 'react';
import { Waypoints } from 'lucide-react';
import type { LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useRailShrink } from '../../../../app/shell/right-rail.js';
import { useCloseCard } from '../../../../app/shell/use-card-stack.js';
import { useLetterConversation } from '../../../../shared/chat/chat-queries.js';
import { CHAT_PANEL_W, ChatSidePanel } from '../../../../shared/chat/chat-side-panel.js';
import { ApiError } from '../../../../shared/api-client.js';
import { useReadEntityNotifications } from '../../../../shared/api/read-entity-notifications.js';
import { CardDataColumn } from '../../../../shared/ui/entity-card/card-data-column.js';
import {
  ROW_MAIN_MIN_W,
  SHRINK_ORDER,
  chatColumnWidth,
  rowMinWidthsCss,
} from '../../../../shared/ui/branch-panel.js';
import {
  MIN_CHAT_W,
  MIN_CHAT_WITH_PANEL,
  useChatWidth,
} from '../../../../shared/ui/use-chat-width.js';
import { useDeleteSpamLetter, useJoinLetter } from '../../api/letters-mutations.js';
import { useMarkLetterViewed } from '../../api/mark-letter-viewed.js';
import { useLetterDetail } from '../../api/letters-queries.js';
import {
  activateTab,
  closeFileTab,
  fileIdOf,
  initialTabs,
  openFileTab,
  pruneFileTabs,
  type LetterTabId,
  type LetterTabsState,
} from '../../lib/letter-tabs.js';
import { SpamConfirmDialog } from '../spam-confirm-dialog.js';
import { InviteParticipantDialog } from './invite-participant-dialog.js';
import { LetterActionBar } from './letter-action-bar.js';
import { LetterAttributes } from './letter-attributes.js';
import { LetterAttachedRefsBlock } from './letter-attached-refs.js';
import { LetterCardSkeleton } from './letter-card-skeleton.js';
import { LetterFieldsBoard } from './letter-fields-board.js';
import { LetterFilesBlock } from './letter-files-block.js';
import { LetterRelationsDrawer } from './letter-relations-drawer.js';
import { LetterSideTabs } from './letter-side-tabs.js';
import { useCloseAfterRegistration } from '../../lib/use-close-after-registration.js';
import { useLetterBranch } from '../../lib/use-letter-branch.js';
import { useLetterBranchWidth } from '../../lib/use-letter-branch-width.js';
// Побочный эффект: превью ссылок на письма в чате (link-previews); карточка —
// eager-импорт стека, поэтому реестр заполнен на старте.
import '../letter-link-preview.js';

/** Стартовая вкладка: «Письмо»; у письма без документа (текста-PDF ещё
 *  нет или отказ конвертера) участнику — сразу «Чат». */
function defaultTabOf(letter: LetterDetail): LetterTabId {
  return letter.body.kind === 'none' && letter.access.isParticipant ? 'chat' : 'body';
}

/** Регистрация письма в карточке (окном или кнопкой без окна): списки
 *  рефечатся сразу — строка уходит из «Новые» и появляется во «Входящих» без
 *  F5, после чего карточка закрывается — возврат к списку «Новых»
 *  (вердикт владельца 28.10). */

/**
 * Карточка письма (#55, U7; редизайн #56, стек ADR-0009, `?cards=letter:<id>`;
 * выравнивание с задачей/проектом — 04.11.2026): полосы цепочки над зонами
 * НЕТ, вкладки правой зоны — на верхнем уровне (общая `CardTabStrip`);
 * слева — доска реквизитов (незарегистрированное — ФОРМА: поля по месту,
 * обязательные помечены), атрибуты типа и «Файлы», и
 * замоноличенный бар h-16 («Зарегистрировать» при заполненных полях идёт
 * без окна; после успешной регистрации карточка закрывается — возврат к
 * списку «Новых»); справа — панель вкладок «Письмо» (документ: выбор
 * канцелярии или текст-PDF) / «Чат» / вложения по канону «чат — буфер
 * сужений».
 * Открытие карточки гасит личную точку «я ещё не открывал» в «Новых».
 * Тема — в хроме слайдера (`LetterTitle`), в теле не дублируется.
 */
export function LetterCard({ letterId }: { letterId: string }) {
  const { data: letter, isLoading, error } = useLetterDetail(letterId);
  // Открыл письмо — его уведомления прочитаны (как у задачи, #252), а личная
  // точка «я ещё не открывал» в «Новых» погашена (редизайн #56).
  useReadEntityNotifications('letter', letterId);
  useMarkLetterViewed(letterId);
  const join = useJoinLetter(letterId);
  const deleteSpam = useDeleteSpamLetter();
  const closeCard = useCloseCard();
  // «Ёлочка» (#461, В1): выдвижная колонка слева, зеркало ветки задачи.
  const branch = useLetterBranch(letterId);
  const [spamOpen, setSpamOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Вкладки — до первого действия производные от письма (стартовая вкладка).
  const [tabsState, setTabsState] = useState<LetterTabsState | null>(null);
  // Панель вложений беседы (#55): как в мессенджере — тоггл в полосе вкладок
  // «Чата», панель — вталкивающая колонка справа от вкладок карточки.
  const [panelOpen, setPanelOpen] = useState(false);
  // Беседа письма — одна на карточку: тот же кэш, что у вкладки «Чат»
  // (хук до ранних возвратов — порядок хуков неизменен).
  const { data: conversation } = useLetterConversation(
    letterId,
    Boolean(letter?.access.isParticipant),
  );
  const sideRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  // Канон «чат — буфер сужений» (#63) в редакции #461: ЛЮБОЕ стоящее
  // сужение ряда — рельса, панель беседы, «ёлочка» (её ТЕКУЩАЯ тянущаяся
  // ширина) — сначала съедает колонку чата ДО ЕЁ МИНИМУМА (открытая панель —
  // MIN_CHAT_WITH_PANEL), дальше — порядок уступок flex-ряда (SHRINK_ORDER).
  // Рендер и оба drag ходят по ОДНОЙ формуле chatColumnWidth.
  const railShrink = useRailShrink();
  const panelShrink = panelOpen ? CHAT_PANEL_W : 0;
  // Открытая панель беседы ИЛИ «ёлочка» — чат сужается до пола «при
  // открытой панели» (канон #63, как у ветки задачи): иначе на узком окне
  // панель упирается в свой минимум и ряд вылезает за карточку.
  const chatFloor = panelOpen || branch.open ? MIN_CHAT_WITH_PANEL : MIN_CHAT_W;
  const branchWidth = useLetterBranchWidth({
    rowRef,
    panelRef: branchRef,
    chatRef: sideRef,
  });
  const branchColumnW = branch.open ? branchWidth.branchW : 0;
  const { chatW, onDividerDown, dragging } = useChatWidth(
    sideRef,
    railShrink + panelShrink + branchColumnW,
    chatFloor,
  );
  const chatWidthFor = (branchW: number) =>
    chatColumnWidth(chatW, railShrink + panelShrink + branchW, chatFloor);
  const sideW = chatWidthFor(branchColumnW);
  const resizing = dragging || branchWidth.dragging;
  const rowMins = rowMinWidthsCss(chatFloor, branch.open);

  useCloseAfterRegistration(letter, letterId, closeCard);
  useEffect(() => {
    setTabsState(null);
    setPanelOpen(false);
  }, [letterId]);

  if (!letter && error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {ui.letters.card.notFound}
      </div>
    );
  }
  if (isLoading || !letter) return <LetterCardSkeleton sideW={sideW} />;

  const attachmentIds = letter.attachments.map((file) => file.id);
  const tabs = pruneFileTabs(tabsState ?? initialTabs(defaultTabOf(letter)), attachmentIds);
  // Панель живёт только у вкладки «Чат»: ушли на «Письмо»/файл — закрываем.
  const chatActive = tabs.active === 'chat';
  const panelVisible = panelOpen && chatActive && Boolean(conversation);
  const updateTabs = (change: (state: LetterTabsState) => LetterTabsState) =>
    setTabsState((state) =>
      change(pruneFileTabs(state ?? initialTabs(defaultTabOf(letter)), attachmentIds)),
    );
  const bodyAttachmentId = letter.body.kind === 'none' ? null : letter.body.attachmentId;
  // Подсветка плитки: файл активной вкладки, у «Письма» — его документ,
  // у «Текста письма» — текстовая часть.
  const activeFileId = fileIdOf(tabs.active) ?? (tabs.active === 'body' ? bodyAttachmentId : null);

  /** Файл из блока «Файлы» — своя вкладка; главный — вкладка «Письмо». */
  const openAttachment = (attachmentId: string) =>
    updateTabs((state) =>
      attachmentId === bodyAttachmentId
        ? activateTab(state, 'body')
        : openFileTab(state, attachmentId),
    );
  const onJoin = () =>
    join.mutate(undefined, { onSuccess: () => updateTabs((state) => activateTab(state, 'chat')) });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={rowRef} className="relative flex min-h-0 flex-1">
        {/* Панель «Связи» — «ёлочка» (#461, В1): выдвижная колонка ПЕРЕД
            зоной данных (зеркало ветки задачи #365), ширина тянется
            перегородкой с памятью (дефолт 300px); монтируется раз и живёт
            при навигации — раскрытия и сессия переходов не теряются. */}
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
          {branch.mounted ? (
            <LetterRelationsDrawer
              rootId={branch.rootId}
              currentId={letterId}
              canManage={letter.canManageRelations}
              canBack={branch.canBack}
              onBack={branch.back}
              onNavigate={branch.navigate}
              onClose={branch.close}
            />
          ) : null}
        </div>
        {/* Левая зона: скроллится только контент, бар h-16 замоноличен (его
            верхняя линия — одна горизонталь с композером чата). border-r —
            структурная граница с панелью; ручка — оверлей поверх неё.
            @container — сетка полей и бар перестраиваются от ширины зоны;
            колонка данных — общая с задачей/проектом (`CardDataColumn`). */}
        <div
          className={cn(
            'relative flex min-h-0 min-w-0 flex-col border-r border-border @container',
            !resizing && 'transition-[min-width] duration-200 ease-out',
          )}
          style={{ flex: `1 ${SHRINK_ORDER.main} ${ROW_MAIN_MIN_W}px`, minWidth: rowMins.main }}
        >
          {/* Перегородка «ёлочки» (#461): оверлей поверх её границы (border-r
              панели = левый край этой зоны), механика ручки ветки задачи —
              drag в rAF, двойной клик — дефолтная ширина. */}
          {branch.open ? (
            <div
              onPointerDown={(event) =>
                branchWidth.onDividerDown(event, { floor: chatFloor, widthFor: chatWidthFor })
              }
              onDoubleClick={branchWidth.onDividerReset}
              role="separator"
              aria-orientation="vertical"
              aria-label={ui.common.resizePanel}
              title={ui.common.resizePanel}
              className="group absolute top-0 left-0 z-10 h-full w-3 -translate-x-1/2 cursor-col-resize"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          ) : null}
          <CardDataColumn
            gutter={
              <button
                type="button"
                onClick={branch.toggle}
                aria-expanded={branch.open}
                aria-label={ui.letters.relations.toggle}
                title={ui.letters.relations.toggle}
                className={cn(
                  'rounded-lg p-1.5 transition-colors hover:bg-accent',
                  branch.open ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <Waypoints className="size-4" strokeWidth={1.75} />
              </button>
            }
          >
            <LetterFieldsBoard letter={letter} />
            <LetterAttributes letter={letter} />
            <LetterAttachedRefsBlock letter={letter} />
            <LetterFilesBlock letter={letter} activeId={activeFileId} onOpen={openAttachment} />
          </CardDataColumn>
          <div className="flex h-16 shrink-0 items-center border-t border-border px-5">
            <LetterActionBar
              letter={letter}
              onInvite={() => setInviteOpen(true)}
              onDeleteSpam={() => setSpamOpen(true)}
            />
          </div>
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

        {/* Панель вкладок — буфер сужений: transition только для программных
            сужений (рельса), во время drag снят — ширина идёт императивно. */}
        <div
          ref={sideRef}
          className={cn(
            'min-h-0 overflow-hidden',
            !dragging && 'transition-[width] duration-200 ease-out',
          )}
          style={{
            width: sideW,
            minWidth: chatFloor,
            flexShrink: SHRINK_ORDER.chat,
          }}
        >
          <LetterSideTabs
            letter={letter}
            tabs={tabs}
            joining={join.isPending}
            panelOpen={panelVisible}
            onActivate={(tab) => {
              if (tab !== 'chat') setPanelOpen(false);
              updateTabs((state) => activateTab(state, tab));
            }}
            onClose={(attachmentId) => updateTabs((state) => closeFileTab(state, attachmentId))}
            onJoin={onJoin}
            onPanelToggle={() => setPanelOpen((open) => !open)}
          />
        </div>

        {/* Панель вложений беседы письма — полновысотная вталкивающая
            колонка справа (канон мессенджера: чат и композер остаются
            доступны), шапка продолжает полосу вкладок карточки. */}
        {conversation ? (
          <ChatSidePanel
            conversationId={conversation.id}
            conversation={conversation}
            open={panelVisible}
            onClose={() => setPanelOpen(false)}
            title={ui.chat.aboutChat}
            headerClass="h-10"
          />
        ) : null}
      </div>

      <SpamConfirmDialog
        open={spamOpen}
        onCancel={() => setSpamOpen(false)}
        onConfirm={() => {
          // Удаление оптимистично (Р12): карточка закрывается сразу, строка
          // уходит из «Новых»; отказ сервера вернёт строку и покажет тост.
          setSpamOpen(false);
          closeCard();
          deleteSpam.mutate(letter.id);
        }}
      />
      <InviteParticipantDialog
        letterId={letter.id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </div>
  );
}
