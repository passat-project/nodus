import {
  Bell,
  BellOff,
  FileText,
  Image as ImageIcon,
  Link2,
  Music,
  Users,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ConversationListItem, VaultItemType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useConversations } from './chat-queries.js';
import { chatConversationUrl } from './messenger-nav.js';
import { useUpdateConversation } from './conversation-actions.js';
import { ConversationAvatar } from './conversation-avatar.js';
import { conversationTitle } from './conversations.js';
import { useConversationSubtitle } from './conversation-subtitle.js';
import { useConversationVaultCounts } from './vault-api.js';
import { useAuthStore } from '../auth-store.js';

/**
 * Панель-профиль беседы (#211, ревизия владельца 05.10 — модель Telegram):
 * большой аватар, название, живая подпись (та же логика, что у бара) и
 * действия «Звук» (mute — тот же PATCH, что в ПКМ-меню) и «Копировать
 * ссылку»; ниже — кликабельные категории-счётчики (O(1) из денормализованных
 * stats) без превью: клик открывает окно категории (vault-window). Пустые
 * категории скрыты, как в Telegram.
 */
export function ChatProfilePane({
  conversationId,
  conversation,
  onOpenVaultType,
  onOpenMembers,
}: {
  conversationId: string;
  /** Строка «Участники · N» над категориями (хост без шапки беседы —
   *  панель «О задаче», #252): открывает вид участников. */
  onOpenMembers?: () => void;
  /** Беседа из кэша хоста; карточки-хосты могут не передать — берём из списка. */
  conversation?: ConversationListItem;
  onOpenVaultType: (type: VaultItemType) => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const list = useConversations();
  const item = conversation ?? list.data?.items.find((c) => c.id === conversationId) ?? null;
  const counts = useConversationVaultCounts(conversationId);
  const update = useUpdateConversation();
  const subtitle = useConversationSubtitle(item);

  function toggleMute() {
    if (!item) return;
    update.mutate({ id: item.id, body: { muted: !item.muted } });
  }

  async function copyLink() {
    try {
      // Ссылка несёт вкладку по типу беседы (#1062): получатель открывает
      // чат задачи на «Чатах задач и писем», а не на пустом списке «Чатов».
      await navigator.clipboard.writeText(
        `${window.location.origin}${chatConversationUrl(conversationId, { type: item?.type })}`,
      );
      toast(ui.common.linkCopied);
    } catch {
      /* буфер обмена недоступен — без тоста */
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {item ? (
        <div className="flex shrink-0 flex-col items-center gap-1.5 px-4 pb-4">
          <ConversationAvatar conversation={item} meId={meId} className="size-20" />
          <div className="mt-1 w-full text-center">
            <div className="truncate text-sm font-semibold">{conversationTitle(item, meId)}</div>
            <div className="truncate text-xs font-medium text-muted-foreground">{subtitle}</div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleMute}>
              {item.muted ? <BellOff data-testid="muted" /> : <Bell />}
              {ui.chat.profileSound}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              <Link2 />
              {ui.common.copyLink}
            </Button>
          </div>
        </div>
      ) : null}
      <nav className="flex flex-col gap-0.5" aria-label={ui.chat.panelTitle}>
        {item && onOpenMembers ? (
          <button
            type="button"
            onClick={onOpenMembers}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <Users className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-1 truncate text-sm">{ui.chat.membersPanelTitle}</span>
            <span className="font-mono text-label-sm tabular-nums text-muted-foreground">
              {item.membersCount}
            </span>
          </button>
        ) : null}
        {(
          [
            ['image', ui.chat.vaultImages, ImageIcon],
            ['video', ui.chat.vaultVideos, Video],
            ['audio', ui.chat.vaultAudios, Music],
            ['document', ui.chat.vaultFiles, FileText],
            ['link', ui.chat.vaultLinks, Link2],
          ] as const
        ).map(([type, label, Icon]) => {
          const count = counts.data?.[type] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onOpenVaultType(type)}
              title={ui.chat.vaultOpenCategory}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 truncate text-sm">{label}</span>
              <span className="font-mono text-label-sm tabular-nums text-muted-foreground">
                {count}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
