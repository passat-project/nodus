import type { ChatMessage } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@nodus/ui/components/tooltip';

import { shortPersonName } from '../lib/format.js';
import { useReactionToggle } from './reaction-mutations.js';
import { ReactionGlyph } from './reaction-glyph.js';
import { PersonAvatar } from '../ui/person-avatar.js';

/** Реакции сообщения: плоские моно-чипы на токенах. Чип — кнопка
 *  (#124, канон Telegram): клик toggle'ит свою реакцию оптимистично. Ховер по
 *  чипу — тултип «кто поставил»: аватар+ФИО списком (вердикт 27.09 п.4; один
 *  поставивший — одна строка). users — опционально на рендере: api без поля
 *  (например, собран из main при деве с новым фронт-деревом) не роняет ленту,
 *  тултип просто не показывается. Key включает count/mine: смена реакции
 *  перемонтирует чип и проигрывает pop-анимацию (reaction-pop, globals).
 *  Тон — по поверхности (#127): на залитом своём пузыре чипы в акценте пузыря
 *  (зелёный/светло-синий), на чужом пузыре и постах канала — info/нейтраль.
 *  Файл отдельный от chat-message.tsx: потребитель стикер-сообщения
 *  (#143) не должен закольцовывать импорты (I5, одна ответственность). */
export function MessageReactions({
  message,
  onFilled = false,
}: {
  message: ChatMessage;
  /** Чипы на залитом своём пузыре — акцент пузыря вместо info. */
  onFilled?: boolean;
}) {
  const toggle = useReactionToggle(message.conversationId);
  if (message.reactions.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {message.reactions.map((reaction) => {
        const users = reaction.users ?? [];
        const chip = (
          <button
            type="button"
            aria-pressed={reaction.mine}
            aria-label={`${reaction.emoji} ${reaction.count}`}
            onClick={() =>
              toggle.mutate({
                messageId: message.id,
                emoji: reaction.emoji,
                remove: reaction.mine,
              })
            }
            className={cn(
              'reaction-pop inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-label-sm tabular-nums transition-colors',
              onFilled
                ? cn(
                    // Текст чипа на залитом пузыре — foreground поверхности
                    // (акцент на тёмной заливке не дотягивал AA, валидатор
                    // #127); hue реакции несут бордюр и подложка.
                    reaction.mine
                      ? 'border-bubble-out-accent/50 bg-bubble-out-accent/20 text-bubble-out-foreground'
                      : 'border-bubble-out-accent/30 bg-transparent text-bubble-out-foreground/80 hover:bg-bubble-out-accent/10',
                  )
                : reaction.mine
                  ? 'border-info/40 bg-info-soft/60 text-info'
                  : 'border-border bg-accent/40 text-muted-foreground hover:border-foreground/40',
            )}
          >
            <ReactionGlyph emoji={reaction.emoji} className="size-4" />
            {reaction.count}
          </button>
        );
        if (users.length === 0) {
          return <span key={`${reaction.emoji}:${reaction.count}:${reaction.mine}`}>{chip}</span>;
        }
        return (
          <Tooltip key={`${reaction.emoji}:${reaction.count}:${reaction.mine}`}>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent side="top" className="p-1">
              <span className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                {users.map((user) => (
                  <span key={user.id} className="flex items-center gap-1.5 px-1.5 py-0.5">
                    <PersonAvatar
                      name={user.displayName}
                      avatarUrl={user.avatarUrl}
                      decorative
                      className="size-5 shrink-0"
                    />
                    <span className="text-xs">{shortPersonName(user.displayName)}</span>
                  </span>
                ))}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
