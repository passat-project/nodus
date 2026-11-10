import { FileText, History, Loader2, MessageSquare, MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';
import { Spinner } from '@nodus/ui/components/spinner';

import { useLetterConversation } from '../../../../shared/chat/chat-queries.js';
import { ChatPanelToggle } from '../../../../shared/chat/chat-side-panel.js';
import { ConversationPane } from '../../../../shared/chat/conversation-pane.js';
import { FileTypeIcon } from '../../../../shared/files/file-type-icon.js';
import { CardTabAreas } from '../../../../shared/ui/entity-card/card-tab-areas.js';
import type { CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import type {
  CardTabGroup,
  CardTabsState,
} from '../../../../shared/ui/entity-card/card-tabs-model.js';
import {
  fileIdOf,
  fileTabId,
  type LetterTabId,
  type LetterTabsState,
} from '../../lib/letter-tabs.js';
import { LetterBodyView } from '../letter-body-view.js';
import { LetterHistory } from './letter-history.js';

/** Чат письма (Р10; редизайн #56): участнику — обычная беседа мессенджера,
 *  остальным — объяснение и «Присоединиться/Начать обсуждение». */
function LetterChatTab({
  letter,
  joining,
  onJoin,
}: {
  letter: LetterDetail;
  joining: boolean;
  onJoin: () => void;
}) {
  const { data, error } = useLetterConversation(letter.id, letter.access.isParticipant);
  const joinLabel =
    letter.registeredAt === null ? ui.letters.card.startDiscussion : ui.letters.card.join;

  if (letter.access.isParticipant && data) {
    return (
      <ConversationPane
        conversationId={data.id}
        conversation={data}
        emptyLabel={ui.letters.card.chatEmpty}
        composerClassName="flex min-h-16 flex-col justify-end"
      />
    );
  }
  if (letter.access.isParticipant) {
    return (
      <div className="grid h-full place-items-center bg-chat-zone p-6 text-center">
        {error ? (
          <Empty>
            <EmptyTitle>{ui.common.loadError}</EmptyTitle>
          </Empty>
        ) : (
          <Spinner className="size-5" />
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-chat-zone p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle>{ui.letters.card.chatGuestTitle}</EmptyTitle>
          <EmptyDescription>{ui.letters.card.chatGuestHint}</EmptyDescription>
        </EmptyHeader>
        {letter.access.canJoin ? (
          <EmptyContent>
            <Button
              variant="outline"
              onClick={onJoin}
              disabled={joining}
              aria-busy={joining || undefined}
            >
              {joining ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MessageSquare data-icon="inline-start" />
              )}
              {joinLabel}
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}

/**
 * Правая панель карточки письма (#55, #56; области вкладок — #746):
 * «Письмо», «Чат» и «История» + закрываемые вложения. Движок общий с
 * проектом/задачей: 1–2 области, перестановка/перенос, ширины. Содержимое
 * монтируется один раз и живёт скрытым — при переносе между областями не
 * ремаунтится (позиция/масштаб документа сохраняются).
 */
export function LetterSideTabs({
  letter,
  tabs,
  joining,
  panelOpen,
  state,
  groupW,
  collapsedGroupId,
  onStateChange,
  onGroupWidthsChange,
  groupMin,
  onActivate,
  onClose,
  onJoin,
  onPanelToggle,
  onHideTab,
  canHideTab,
}: {
  letter: LetterDetail;
  tabs: LetterTabsState;
  joining: boolean;
  panelOpen: boolean;
  state: CardTabsState;
  groupW: number[];
  collapsedGroupId: string | null;
  onStateChange: (next: CardTabsState) => void;
  onGroupWidthsChange: (widths: number[]) => void;
  groupMin?: (group: CardTabGroup) => number;
  onActivate: (tab: LetterTabId) => void;
  onClose: (attachmentId: string) => void;
  onJoin: () => void;
  onPanelToggle: () => void;
  onHideTab?: (tabId: string) => void;
  canHideTab?: (tabId: string) => boolean;
}) {
  const { data: conversation } = useLetterConversation(letter.id, letter.access.isParticipant);
  const strip: CardTabDef[] = [
    { id: 'body', label: ui.letters.card.tabBody, icon: <FileText className="size-3.5" /> },
    {
      id: 'chat',
      label: ui.letters.card.tabChat,
      icon: <MessageSquare className="size-3.5" />,
      badge: conversation?.unreadCount,
    },
    { id: 'history', label: ui.letters.card.history, icon: <History className="size-3.5" /> },
    ...tabs.files.flatMap((fileId) => {
      const file = letter.attachments.find((a) => a.id === fileId);
      return file
        ? [
            {
              id: fileTabId(fileId),
              label: file.name,
              icon: <FileTypeIcon mime={file.mime} className="size-3.5" />,
              title: file.name,
              closable: true,
            },
          ]
        : [];
    }),
  ];
  const lastGroupId = collapsedGroupId
    ? (state.groups.find((group) => group.id !== collapsedGroupId)?.id ?? null)
    : (state.groups[state.groups.length - 1]?.id ?? null);

  const panel = (tab: LetterTabId): ReactNode => {
    if (tab === 'body') return <LetterBodyView letter={letter} />;
    if (tab === 'chat') return <LetterChatTab letter={letter} joining={joining} onJoin={onJoin} />;
    if (tab === 'history') return <LetterHistory letterId={letter.id} />;
    const fileId = fileIdOf(tab);
    return fileId ? <LetterBodyView letter={letter} attachmentId={fileId} /> : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CardTabAreas
        label={ui.letters.card.tabsLabel}
        tabs={strip}
        state={state}
        onStateChange={(next) => {
          onStateChange(next);
          const group =
            next.groups.find((entry) => entry.id === next.focusGroupId) ?? next.groups[0];
          if (group) onActivate(group.active as LetterTabId);
        }}
        renderPanel={(tabId) => panel(tabId as LetterTabId)}
        groupW={groupW}
        collapsedGroupId={collapsedGroupId}
        onGroupWidthsChange={onGroupWidthsChange}
        groupMin={groupMin}
        onCloseTab={(tabId) => {
          const fileId = fileIdOf(tabId as LetterTabId);
          if (fileId) onClose(fileId);
        }}
        onHideTab={onHideTab}
        canHideTab={canHideTab}
        actions={(group) =>
          group.id === lastGroupId && group.active === 'chat' && conversation ? (
            <ChatPanelToggle open={panelOpen} onToggle={onPanelToggle} />
          ) : null
        }
      />
    </div>
  );
}
