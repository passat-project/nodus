import { ArrowUpRight, CheckSquare, Copy, Forward, Star, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, FavoriteCard } from '@nodus/contracts';
import { stripMentionTokens, ui } from '@nodus/contracts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';
import { toast } from 'sonner';

import { useChatHostNavigation } from './chat-host.js';
import { useForwardDialog } from './dialog-stores.js';
import { useRemoveFavorite } from './favorites-api.js';
import { useJumpStore } from './jump-store.js';
import { closeMenuThenRun } from './menu-close.js';
import { useSelectionStore } from './selection-store.js';
import { copyMessagesAsText } from './use-selection-keys.js';

/**
 * ПКМ-меню карточки избранного (#171, ревизия 04.10: действий на пузыре
 * НЕТ — только контекстное меню, как у сообщений): прыжок к оригиналу,
 * копирование текста, пересылка, снятие звезды. Поверхность — та же,
 * что у MessageMenu (пузырь/надгробие/медиа).
 *
 * Окно-источник «Избранного» (#237, вердикт владельца 07.10 — «выбор +
 * базовые команды, как в Telegram»): при scope меню включается в селект
 * этого окна — «Выбрать» в покое, в режиме — батч-команды. Пересылка
 * батчем идёт ОРИГИНАЛАМИ из беседы-источника (форвард-валидатор ищет
 * источники в одной беседе — в окне-источнике все карточки из неё,
 * в отличие от смешанной витрины #215); удаление батча = снять звёзды.
 */
export function FavoriteMenu({
  card,
  scope,
  selectionActive = false,
  messagesOfSelection,
  children,
}: {
  card: FavoriteCard;
  /** Скоуп селекта хоста; задан только в окне-источнике (#237). */
  scope?: string;
  selectionActive?: boolean;
  /** Выделенные строки окна (копирование батчем). */
  messagesOfSelection?: () => ChatMessage[];
  children: ReactNode;
}) {
  const remove = useRemoveFavorite();
  const nav = useChatHostNavigation();
  /** #273: меню управляемое — closeFirst-пункт закрывает его ЯВНО, а не
   *  через неявный handleSelect Radix. */
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const inSourceWindow = scope !== undefined;
  const hasSelection = useSelectionStore(
    (s) => inSourceWindow && s.scope === scope && s.ids.length > 0,
  );
  const selectedIds = useSelectionStore((s) =>
    inSourceWindow && s.scope === scope ? s.ids : EMPTY_IDS,
  );
  const batchMode = inSourceWindow && selectionActive && hasSelection;

  function showInChat() {
    useJumpStore.getState().request(card.conversationId, card.messageId, card.threadRootId);
    if (nav) nav.openConversation(card.conversationId, card.threadRootId);
    else toast(ui.chat.jumpNotFound);
  }

  /** #132 р.2 / #273: смена режима селекта — меню закрывается ЯВНО, действие
   *  после анимации закрытия (без морфинга содержимого). */
  function runAfterClose(run: () => void) {
    closeMenuThenRun(() => setMenuOpen(false), run);
  }

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          className="block"
          onContextMenuCapture={(event) => {
            const target = event.target as HTMLElement | null;
            const onSurface = target?.closest?.(
              '[data-slot="bubble-content"], [data-slot="message-tombstone"], [data-slot="sticker-surface"], [data-slot="media-message"]',
            );
            if (!onSurface) {
              event.stopPropagation();
              return;
            }
          }}
          data-chat-message={card.messageId}
          data-favorite-card={card.messageId}
        >
          {children}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {batchMode ? (
          <>
            {!card.deletedAt ? (
              <ContextMenuItem
                onClick={() =>
                  // Ключи селекта карточек = id оригиналов (server bookmark,
                  // #171) — маппинг не нужен; беседа-источник одна на окно.
                  useForwardDialog.getState().open(card.conversationId, [...selectedIds])
                }
              >
                <Forward className="size-4" strokeWidth={1.75} />
                {ui.chat.forwardSelected}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              variant="destructive"
              onClick={() => {
                for (const id of selectedIds) remove.mutate(id);
                useSelectionStore.getState().exit();
              }}
            >
              <Star className="size-4" strokeWidth={1.75} />
              {ui.chat.unfavoriteSelected}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => copyMessagesAsText(messagesOfSelection?.() ?? [])}>
              <Copy className="size-4" strokeWidth={1.75} />
              {ui.chat.copySelected}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => runAfterClose(() => useSelectionStore.getState().exit())}
            >
              <X className="size-4" strokeWidth={1.75} />
              {ui.chat.clearSelection}
            </ContextMenuItem>
          </>
        ) : (
          <>
            {!card.obliterated ? (
              <ContextMenuItem onClick={showInChat}>
                <ArrowUpRight className="size-4" strokeWidth={1.75} />
                {ui.chat.showInChat}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              onClick={() => {
                navigator.clipboard
                  // Упоминания — отображаемым текстом без разметки (#176).
                  .writeText(stripMentionTokens(card.text))
                  .then(() => toast.success(ui.chat.copied))
                  .catch(() => toast.error(ui.common.copyError));
              }}
            >
              <Copy className="size-4" strokeWidth={1.75} />
              {ui.chat.menu.copy}
            </ContextMenuItem>
            {!card.deletedAt ? (
              <ContextMenuItem
                onClick={() =>
                  useForwardDialog.getState().open(card.conversationId, [card.messageId])
                }
              >
                <Forward className="size-4" strokeWidth={1.75} />
                {ui.chat.menu.forward}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem variant="destructive" onClick={() => remove.mutate(card.messageId)}>
              <Star className="size-4" strokeWidth={1.75} />
              {ui.chat.unfavorite}
            </ContextMenuItem>
            {inSourceWindow && !card.deletedAt ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() =>
                    runAfterClose(() =>
                      useSelectionStore.getState().enter(
                        scope!,
                        // Ключ селекта карточки = id оригинала (стабилен).
                        card.messageId,
                      ),
                    )
                  }
                >
                  <CheckSquare className="size-4" strokeWidth={1.75} />
                  {ui.chat.menu.select}
                </ContextMenuItem>
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const EMPTY_IDS: string[] = [];
