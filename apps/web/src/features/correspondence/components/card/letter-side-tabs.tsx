import { FileText, History, Loader2, MessageSquare, MessagesSquare } from 'lucide-react';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
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
import { cn } from '@nodus/ui/lib/utils';

import { useLetterConversation } from '../../../../shared/chat/chat-queries.js';
import { ChatPanelToggle } from '../../../../shared/chat/chat-side-panel.js';
import { ConversationPane } from '../../../../shared/chat/conversation-pane.js';
import { FileTypeIcon } from '../../../../shared/files/file-type-icon.js';
import { CardTabStrip, type CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import {
  fileIdOf,
  fileTabId,
  type LetterTabId,
  type LetterTabsState,
} from '../../lib/letter-tabs.js';
import { LetterBodyView } from '../letter-body-view.js';
import { LetterHistory } from './letter-history.js';

/** Чат письма (Р10; редизайн #56 — обсуждение живёт и у незарегистриро-
 *  ванного): участнику — обычная беседа мессенджера (композер в покое h-16
 *  = бару действий — одна горизонталь), остальным — объяснение и
 *  «Присоединиться к обсуждению» / «Начать обсуждение» (канцелярия до
 *  регистрации), если письмо ещё в работе. */
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
            {/* Outline, а не заливка: primary на экране один («Зарегистрировать»
                в баре действий), а то же действие в баре — outline-кнопка:
                одно действие — один вес в обоих входах. */}
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
 * Правая панель карточки письма (#55, U7): «Письмо», «Чат» и «Текст
 * письма» (когда текстовая часть есть — редизайн #56) — неснимаемые
 * вкладки, вложения — закрываемые (≤ 6, `letter-tabs.ts`). Содержимое
 * вкладки монтируется при первом показе и дальше живёт скрытым
 * (`invisible` + `inert`, не `display: none`): прокрутка, страница и
 * масштаб документа при возврате на вкладку на месте. ←/→ на полосе —
 * соседняя вкладка.
 */
export function LetterSideTabs({
  letter,
  tabs,
  joining,
  panelOpen,
  onActivate,
  onClose,
  onJoin,
  onPanelToggle,
}: {
  letter: LetterDetail;
  tabs: LetterTabsState;
  joining: boolean;
  /** Панель вложений беседы (как в мессенджере) открыта — тоггл подсвечен. */
  panelOpen: boolean;
  /** Текстовая часть письма (role body при документе) — вкладка «Текст
   *  письма»; null — вкладки нет. */
  onActivate: (tab: LetterTabId) => void;
  onClose: (attachmentId: string) => void;
  onJoin: () => void;
  onPanelToggle: () => void;
}) {
  const baseId = useId();
  const { data: conversation } = useLetterConversation(letter.id, letter.access.isParticipant);
  const domId = (tab: LetterTabId) => `${baseId}-${tab.replace(':', '-')}`;

  const strip: CardTabDef[] = [
    { id: 'body', label: ui.letters.card.tabBody, icon: <FileText className="size-3.5" /> },
    {
      id: 'chat',
      label: ui.letters.card.tabChat,
      icon: <MessageSquare className="size-3.5" />,
      badge: conversation?.unreadCount,
    },
    {
      id: 'history',
      label: ui.letters.card.history,
      icon: <History className="size-3.5" />,
    },
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

  function onStripKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = strip.findIndex((tab) => tab.id === tabs.active);
    const next =
      strip[(index + (event.key === 'ArrowRight' ? 1 : -1) + strip.length) % strip.length];
    if (!next) return;
    event.preventDefault();
    onActivate(next.id as LetterTabId);
    document.getElementById(`${domId(next.id as LetterTabId)}-tab`)?.focus();
  }

  const panel = (tab: LetterTabId): ReactNode => {
    if (tab === 'body') return <LetterBodyView letter={letter} />;
    if (tab === 'chat') return <LetterChatTab letter={letter} joining={joining} onJoin={onJoin} />;
    if (tab === 'history') return <LetterHistory letterId={letter.id} />;
    const fileId = fileIdOf(tab);
    return fileId ? <LetterBodyView letter={letter} attachmentId={fileId} /> : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CardTabStrip
        label={ui.letters.card.tabsLabel}
        tabs={strip}
        active={tabs.active}
        onActivate={(id) => onActivate(id as LetterTabId)}
        onClose={(id) => {
          const fileId = fileIdOf(id as LetterTabId);
          if (fileId) onClose(fileId);
        }}
        idPrefix={baseId}
        onKeyDown={onStripKeyDown}
        actions={
          tabs.active === 'chat' && conversation ? (
            <ChatPanelToggle open={panelOpen} onToggle={onPanelToggle} />
          ) : null
        }
      />
      <div className="relative min-h-0 flex-1">
        {strip
          .filter((tab) => tabs.visited.includes(tab.id as LetterTabId))
          .map((tab) => {
            const tabId = tab.id as LetterTabId;
            const active = tabId === tabs.active;
            return (
              <div
                key={tab.id}
                role="tabpanel"
                id={`${domId(tabId)}-panel`}
                aria-labelledby={`${domId(tabId)}-tab`}
                inert={!active}
                className={cn('absolute inset-0', !active && 'invisible')}
              >
                {panel(tabId)}
              </div>
            );
          })}
      </div>
    </div>
  );
}
