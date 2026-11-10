import { useEffect, useMemo, useRef, useState } from 'react';
import { Waypoints } from 'lucide-react';
import type { LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useCloseCard } from '../../../../app/shell/use-card-stack.js';
import { ApiError } from '../../../../shared/api-client.js';
import { useReadEntityNotifications } from '../../../../shared/api/read-entity-notifications.js';
import { useLetterConversation } from '../../../../shared/chat/chat-queries.js';
import { ChatSidePanel } from '../../../../shared/chat/chat-side-panel.js';
import { CardDataColumn } from '../../../../shared/ui/entity-card/card-data-column.js';
import { CardDataSplitter } from '../../../../shared/ui/entity-card/card-data-splitter.js';
import {
  CardWidthHint,
  PANEL_HIDDEN_HINT,
} from '../../../../shared/ui/entity-card/card-width-hint.js';
import { solveCardWidths } from '../../../../shared/ui/entity-card/card-tabs-width.js';
import { useCardTabs } from '../../../../shared/ui/entity-card/use-card-tabs.js';
import { useElementWidth } from '../../../../shared/ui/use-element-width.js';
import { useDeleteSpamLetter, useJoinLetter } from '../../api/letters-mutations.js';
import { useMarkLetterViewed } from '../../api/mark-letter-viewed.js';
import { useLetterDetail } from '../../api/letters-queries.js';
import {
  activateTab,
  closeFileTab,
  fileIdOf,
  fileTabId,
  initialTabs,
  openFileTab,
  pruneFileTabs,
  type LetterTabId,
  type LetterTabsState,
} from '../../lib/letter-tabs.js';
import { useCloseAfterRegistration } from '../../lib/use-close-after-registration.js';
import { useLetterBranch } from '../../lib/use-letter-branch.js';
import { useLetterBranchWidth } from '../../lib/use-letter-branch-width.js';
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
// Побочный эффект: превью ссылок на письма в чате (link-previews); карточка —
// eager-импорт стека, поэтому реестр заполнен на старте.
import '../letter-link-preview.js';

/** Стабильные вкладки письма; файлы — динамические. */
const LETTER_STABLE_TABS = ['body', 'chat', 'history'] as const;

/** Стартовая вкладка: «Письмо»; у письма без документа (текста-PDF ещё
 *  нет или отказ конвертера) участнику — сразу «Чат». */
function defaultTabOf(letter: LetterDetail): LetterTabId {
  return letter.body.kind === 'none' && letter.access.isParticipant ? 'chat' : 'body';
}

/**
 * Карточка письма (#55, U7; дизайн #56; области вкладок — #746): слева
 * «ёлочка» связей и доска реквизитов с баром действий, справа — 1–2 области
 * вкладок («Письмо», «Чат», «История», вложения) и панель беседы. Ширины
 * решает общий solver: данные 340→320, чат — буфер, панель 300 не сжимается
 * (временно скрывается), «ёлочка» сворачивается первой. Порядок/области/
 * ширины/панель — личные настройки сотрудника (#745).
 * Открытие карточки гасит личную точку «я ещё не открывал» в «Новых».
 */
export function LetterCard({ letterId }: { letterId: string }) {
  const { data: letter, isLoading, error } = useLetterDetail(letterId);
  useReadEntityNotifications('letter', letterId);
  useMarkLetterViewed(letterId);
  const join = useJoinLetter(letterId);
  const deleteSpam = useDeleteSpamLetter();
  const closeCard = useCloseCard();
  const branch = useLetterBranch(letterId);
  const [spamOpen, setSpamOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tabsState, setTabsState] = useState<LetterTabsState | null>(null);
  const { data: conversation } = useLetterConversation(
    letterId,
    Boolean(letter?.access.isParticipant),
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const noChatRef = useRef<HTMLDivElement>(null);
  const rowWidth = useElementWidth(rowRef);
  const branchWidth = useLetterBranchWidth({
    rowRef,
    panelRef: branchRef,
    chatRef: noChatRef,
  });
  const branchActualW = useElementWidth(branchRef);

  const baseTabs = tabsState ?? (letter ? initialTabs(defaultTabOf(letter)) : null);
  const tabs = baseTabs ?? null;
  const attachmentIds = letter?.attachments.map((file) => file.id) ?? [];
  const prunedTabs = tabs ? pruneFileTabs(tabs, attachmentIds) : null;
  const fileTabs = (prunedTabs?.files ?? []).map(fileTabId);
  const cardTabs = useCardTabs({
    kind: 'letter',
    stableTabs: LETTER_STABLE_TABS,
    fileTabs,
    defaultActive: letter ? defaultTabOf(letter) : 'body',
    requestedActive: prunedTabs?.active,
  });
  const { state } = cardTabs;

  const branchRendered =
    branch.open && rowWidth >= 320 + 420 + Math.min(branchWidth.branchW, rowWidth / 2);
  const effectiveBranchW = branchRendered ? branchActualW : 0;
  const chatActive = state.groups.some((group) => group.active === 'chat');
  const panelRequested = cardTabs.panelOpen && chatActive && Boolean(conversation);
  const solved = useMemo(
    () =>
      solveCardWidths({
        rowWidth: Math.max(0, rowWidth - effectiveBranchW),
        dataEnabled: true,
        dataPref: cardTabs.widths.data,
        panelOpen: panelRequested,
        panelW: 300,
        groups: state.groups.map((group, index) => ({
          id: group.id,
          isChat: group.tabs.includes('chat'),
          prefW: cardTabs.widths.groups?.[index],
        })),
      }),
    [cardTabs.widths, effectiveBranchW, panelRequested, rowWidth, state.groups],
  );
  const dataW = solved.dataW || 340;
  const dataMax = Math.max(
    320,
    rowWidth - effectiveBranchW - (solved.panelRendered ? 300 : 0) - 280,
  );

  useCloseAfterRegistration(letter, letterId, closeCard);
  useEffect(() => {
    setTabsState(null);
  }, [letterId]);

  if (!letter && error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {ui.letters.card.notFound}
      </div>
    );
  }
  if (isLoading || !letter || !prunedTabs) {
    return <LetterCardSkeleton sideW={solved.groupW[0] ?? 680} />;
  }

  const updateTabs = (change: (state: LetterTabsState) => LetterTabsState) =>
    setTabsState((current) =>
      change(pruneFileTabs(current ?? initialTabs(defaultTabOf(letter)), attachmentIds)),
    );
  const bodyAttachmentId = letter.body.kind === 'none' ? null : letter.body.attachmentId;
  const activeFileId =
    fileIdOf(prunedTabs.active) ?? (prunedTabs.active === 'body' ? bodyAttachmentId : null);

  const openAttachment = (attachmentId: string) =>
    updateTabs((current) =>
      attachmentId === bodyAttachmentId
        ? activateTab(current, 'body')
        : openFileTab(current, attachmentId),
    );
  const onJoin = () =>
    join.mutate(undefined, {
      onSuccess: () => updateTabs((current) => activateTab(current, 'chat')),
    });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={rowRef} className="relative flex min-h-0 flex-1">
        <div
          ref={branchRef}
          className={cn(
            'min-h-0 shrink-0 overflow-hidden',
            !branchWidth.dragging && 'transition-[width] duration-200 ease-out',
          )}
          style={{ width: branchRendered ? branchWidth.branchW : 0 }}
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

        <div
          ref={dataRef}
          className="@container relative flex min-h-0 shrink-0 flex-col border-r border-border"
          style={{ width: dataW, minWidth: dataW }}
        >
          {branchRendered ? (
            <div
              onPointerDown={(event) =>
                branchWidth.onDividerDown(event, { floor: 280, widthFor: (w) => w })
              }
              onDoubleClick={branchWidth.onDividerReset}
              role="separator"
              aria-orientation="vertical"
              aria-label={ui.common.resizePanel}
              title={ui.common.resizePanel}
              className="group absolute top-0 left-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize"
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
          <CardDataSplitter
            dataRef={dataRef}
            dataW={dataW}
            max={dataMax}
            onCommit={cardTabs.setDataWidth}
            onReset={() => cardTabs.setDataWidth(340)}
          />
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <LetterSideTabs
            letter={letter}
            tabs={prunedTabs}
            joining={join.isPending}
            panelOpen={cardTabs.panelOpen && chatActive}
            state={state}
            groupW={solved.groupW}
            collapsedGroupId={solved.collapsedGroupId}
            onStateChange={cardTabs.setState}
            onGroupWidthsChange={cardTabs.setGroupWidths}
            groupMin={(group) =>
              group.tabs.includes('chat') ? (solved.panelRendered ? 280 : 420) : 280
            }
            onActivate={(tab) => updateTabs((current) => activateTab(current, tab))}
            onClose={(attachmentId) => updateTabs((current) => closeFileTab(current, attachmentId))}
            onJoin={onJoin}
            onPanelToggle={() => cardTabs.setPanelOpen(!cardTabs.panelOpen)}
            onHideTab={cardTabs.toggleHidden}
            canHideTab={(id) => (LETTER_STABLE_TABS as readonly string[]).includes(id)}
          />
          {panelRequested && !solved.panelRendered ? (
            <CardWidthHint text={PANEL_HIDDEN_HINT} className="absolute top-11 right-2 z-10" />
          ) : null}
        </div>

        {conversation && solved.panelRendered ? (
          <ChatSidePanel
            conversationId={conversation.id}
            conversation={conversation}
            open
            onClose={() => cardTabs.setPanelOpen(false)}
            title={ui.chat.aboutChat}
            headerClass="h-10"
          />
        ) : null}
      </div>

      <SpamConfirmDialog
        open={spamOpen}
        onCancel={() => setSpamOpen(false)}
        onConfirm={() => {
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
