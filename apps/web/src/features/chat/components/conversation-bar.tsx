import { Camera, Search, SquareArrowOutUpRight, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { avatarIssueMessage, validateAvatarFile } from '../../../shared/chat/avatar-upload.js';
import { ChatPanelToggle } from '../../../shared/chat/chat-side-panel.js';
import { buildSubtitle, findPeer, memberName } from '../../../shared/chat/conversation-subtitle.js';
import {
  canAddMembers,
  canChangeInfo,
  conversationTitle,
  isNotesConversation,
  isRenamableConversation,
} from '../../../shared/chat/conversations.js';
import {
  useRemoveConversationAvatar,
  useRenameConversation,
  useSetConversationAvatar,
} from '../../../shared/chat/manage-api.js';
import { useIsOnline } from '../../../shared/socket/presence-store.js';
import { useTypingStore } from '../../../shared/socket/typing-store.js';
import { NotesGlyph } from '../../../shared/ui/notes-glyph.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';

/**
 * Бар беседы: аватар/закладка, название, подпись, «Открыть задачу», тоггл
 * панели беседы СПРАВА (канон кнопки «О задаче»). Живёт в колонке ленты
 * хоста: при открытии окна треда сжимается вместе с лентой — тоггл стоит
 * на правом краю ЛЕНТЫ (вердикт владельца 15.09.2026); при открытии панели
 * уезжает влево по закону панели.
 *
 * #186: аватар кликабелен при праве changeInfo (загрузка/смена, ПКМ — убрать),
 * название переименовывается кликом (inline, Enter/Esc), подпись групп/каналов —
 * кнопка «N участников» (панель участников), слева от тоггла — добавление
 * участников (право addMembers).
 *
 * Подпись живая (realtime #104): «печатает…» перекрывает типовой подзаголовок;
 * в direct статус собеседника — из WS presence (до этого — статичная строка).
 */
export function ConversationBar({
  conversation,
  panelOpen,
  onPanelToggle,
  onOpenSearch,
  onOpenMembers,
  onAddMembers,
}: {
  conversation: ConversationListItem;
  panelOpen: boolean;
  onPanelToggle: () => void;
  /** Лупа: раскрыть правую панель в режиме поиска (модель Битрикс24). */
  onOpenSearch: () => void;
  onOpenMembers: () => void;
  onAddMembers: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const openCard = useOpenCard();
  const typing = useTypingStore((s) => s.entries[conversation.id] ?? null);
  const typingVisible = typing !== null && typing.expiresAt > Date.now() && typing.userId !== meId;
  const peer = conversation.type === 'direct' ? findPeer(conversation, meId) : null;
  const peerOnline = useIsOnline(peer?.id);

  const title = conversationTitle(conversation, meId);
  const canEditInfo = canChangeInfo(conversation) && isRenamableConversation(conversation);
  const showMembersControls =
    conversation.type === 'group' || conversation.type === 'project_channel';

  const setAvatar = useSetConversationAvatar();
  const removeAvatar = useRemoveConversationAvatar(conversation.id);
  const rename = useRenameConversation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickAvatarFile() {
    fileInputRef.current?.click();
  }

  function onAvatarPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const issue = validateAvatarFile(file);
    if (issue) {
      toast.error(avatarIssueMessage(issue));
      return;
    }
    setAvatar.mutate({ conversationId: conversation.id, file });
  }

  function startEditing() {
    setTitleDraft(conversation.title ?? '');
    setEditingTitle(true);
  }

  function commitTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === conversation.title) return;
    rename.mutate({ id: conversation.id, title: next });
  }

  const typingName = typingVisible ? memberName(conversation, typing.userId) : null;
  const isFavorites = isNotesConversation(conversation, meId);
  // Кнопка сущности беседы — ВЗАИМОИСКЛЮЧАЮЩЕ: чат задачи → «Открыть задачу»,
  // канал проекта → «Открыть проект» (#753), чат письма → «Открыть письмо»
  // (#754). Беседа без привязки (старые данные/моки) — без кнопки: мёртвых
  // кнопок нет.
  const linkedCard =
    conversation.type === 'task' && conversation.task
      ? { label: ui.chat.openTask, ref: { kind: 'task' as const, id: conversation.task.id } }
      : conversation.type === 'project_channel' && conversation.project
        ? {
            label: ui.chat.openProject,
            ref: { kind: 'project' as const, id: conversation.project.id },
          }
        : conversation.type === 'letter' && conversation.letter
          ? {
              label: ui.chat.openLetter,
              ref: { kind: 'letter' as const, id: conversation.letter.id },
            }
          : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      {isFavorites ? (
        <NotesGlyph className="size-9 shrink-0" />
      ) : canEditInfo ? (
        // Аватар беседы при праве changeInfo: клик — выбор файла (загрузка/
        // смена), ПКМ — меню с заменой и удалением (канон контекстных меню).
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={pickAvatarFile}
              title={conversation.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
              aria-label={conversation.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
              className="group relative size-9 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-port"
            >
              <PersonAvatar name={title} avatarUrl={conversation.avatarUrl} className="size-full" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={pickAvatarFile}>
              {conversation.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
            </ContextMenuItem>
            {conversation.avatarUrl ? (
              <ContextMenuItem variant="destructive" onClick={() => removeAvatar.mutate()}>
                {ui.common.avatarRemove}
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <PersonAvatar name={title} avatarUrl={conversation.avatarUrl} className="size-9 shrink-0" />
      )}
      {canEditInfo ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onAvatarPicked}
          aria-hidden
          tabIndex={-1}
        />
      ) : null}
      <div className="min-w-0">
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            onBlur={() => setEditingTitle(false)}
            autoFocus
            aria-label={ui.chat.renameTitle}
            title={ui.chat.titleSaveHint}
            maxLength={128}
            className="w-full rounded-md border border-port bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none"
          />
        ) : (
          // -mx на усечённой ОБЁРТКЕ, не на кнопке: граница клипа (truncate)
          // раздвигается на ширину ховер-пилюли, и её скругления видны с обеих
          // сторон; сама кнопка усекает длинное название (многоточие).
          <div className="-mx-1.5 truncate text-sm font-semibold">
            {canEditInfo ? (
              <button
                type="button"
                onClick={startEditing}
                title={ui.chat.renameTitle}
                className="block w-fit max-w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-accent"
              >
                {title}
              </button>
            ) : (
              title
            )}
          </div>
        )}
        <div className="truncate text-xs font-medium text-muted-foreground">
          {buildSubtitle(conversation, meId, {
            typingName,
            peerOnline,
            onOpenMembers,
          })}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {linkedCard ? (
          <OpenCardButton label={linkedCard.label} onClick={() => openCard(linkedCard.ref)} />
        ) : null}
        {showMembersControls && canAddMembers(conversation) ? (
          <button
            type="button"
            onClick={onAddMembers}
            aria-label={ui.chat.membersAddMore}
            title={ui.chat.membersAddMore}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <UserPlus className="size-4" strokeWidth={1.75} />
          </button>
        ) : null}
        {/* Лупа поиска (все чаты, канон Telegram — #171 ревизия 04.10,
            раунд 3): слева от тоггла панели; клик раскрывает ПРАВУЮ панель
            в режиме поиска (строка + топ-выдача + воронка фильтров,
            модель Битрикс24 — вердикт владельца). */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={ui.chat.searchMessages}
          title={ui.chat.searchMessages}
          className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="size-4" strokeWidth={1.75} />
        </button>
        <ChatPanelToggle open={panelOpen} onToggle={onPanelToggle} />
      </div>
    </header>
  );
}

/** Кнопка сущности беседы в баре (#753/#754): «Открыть задачу/проект/письмо» —
 *  один вид на все типы (текст + иконка, рамка, до «Добавить участников»/
 *  поиска/тоггла), открывает карточку сущности поверх мессенджера (стек
 *  ADR-0009). */
function OpenCardButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
    >
      {label}
      <SquareArrowOutUpRight className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}
