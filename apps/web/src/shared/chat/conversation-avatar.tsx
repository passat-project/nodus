import { ListTodo, Megaphone, Users } from 'lucide-react';
import type { ConversationListItem, ConversationType } from '@nodus/contracts';

import { NotesGlyph } from '../ui/notes-glyph.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { cn } from '@nodus/ui/lib/utils';

import { conversationAvatarUrl, conversationTitle, isNotesConversation } from './conversations.js';

/** Маркер типа беседы на аватаре (список единый, без секций — тип читается
 *  глифом): канал — мегафон, группа — участники, чат задачи — список;
 *  личные — без маркера (аватар собеседника сам по себе). */
export const conversationTypeIcon: Partial<Record<ConversationType, typeof Megaphone>> = {
  project_channel: Megaphone,
  group: Users,
  task: ListTodo,
};

/**
 * Аватар беседы с глифом типа — единый для списка бесед, экспресс-полосы
 * и диалога пересылки (#87: shared-слой, дубли из фич убраны). Фото: загруженный
 * аватар беседы, у личного чата — фото собеседника из `membersPreview` (#726):
 * иначе личка навсегда оставалась на инициалах при установленном фото.
 */
export function ConversationAvatar({
  conversation,
  meId,
  className,
}: {
  conversation: ConversationListItem;
  meId?: string | null;
  className?: string;
}) {
  const TypeIcon = conversationTypeIcon[conversation.type];
  return (
    <span className={cn('relative shrink-0', className)}>
      {isNotesConversation(conversation, meId) ? (
        <NotesGlyph className="size-full" />
      ) : (
        <PersonAvatar
          name={conversationTitle(conversation, meId)}
          avatarUrl={conversationAvatarUrl(conversation, meId)}
          className="size-full"
        />
      )}
      {TypeIcon ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-muted p-0.5 text-muted-foreground"
        >
          <TypeIcon className="size-3" strokeWidth={1.75} />
        </span>
      ) : null}
    </span>
  );
}
