import { Ban } from 'lucide-react';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Message, MessageAvatar, MessageContent } from '@nodus/ui/components/message';
import { Bubble, BubbleContent } from '@nodus/ui/components/bubble';

import { withoutPatronymic, shortPersonName } from '../lib/format.js';
import { personTone } from '../ui/person-tone.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { BubbleOutline } from './bubble-outline.js';
import { useChatPrefs } from './chat-prefs.js';
import { MetaGhost, MetaPin } from './message-media-bubble.js';

/**
 * Надгробие удалённого сообщения (#163, вердикт владельца 30.09 «по ответам»):
 * строка ВНУТРИ пузыря серии — пузырь с аватаром, именем и метой рендерит
 * chat-message как у обычного сообщения (серия своего автора не рвётся,
 * message-groups). Раньше (A5, #87) был отдельный чип без автора — правило
 * следа «по прочтениям» отменено: надгробие живёт только как якорь цепочки
 * ответов. Приглушённый курсив + иконка, role="status" для скринридеров;
 * КТО удалил — не раскрываем (аудит I9 знает), но своё/чужое различаем текстом.
 */
export function MessageTombstone({ mine }: { mine: boolean }) {
  return (
    <span
      role="status"
      // data-slot обязателен (#132): правило примитива
      // group-data-[align=end]/message:*:data-slot:self-end прижимает к
      // правому краю в two-sided только детей С data-slot — без него надгробие
      // всегда сидело слева (пузыри прижаты, у них data-slot есть).
      data-slot="message-tombstone"
      className="inline-flex w-fit items-center gap-1.5 text-sm italic text-muted-foreground"
    >
      <Ban className="size-3.5 shrink-0" strokeWidth={1.75} />
      {mine ? ui.chat.deletedByYou : ui.chat.deletedPlaceholder}
    </span>
  );
}

/**
 * Пузырь-надгробие ЧАТА (#163): обычный пузырь серии (аватар/имя/мета/
 * хвостик несёт серия), внутри приглушённая строка «Сообщение удалено».
 * Вынесено из chat-message (I5): ветка надгробия самодостаточна — контент
 * обнулён сервером, вложений/медиа не бывает.
 */
export function TombstoneBubble({
  message,
  mine,
  showName,
  avatarSlot,
  tail,
}: {
  message: ChatMessage;
  mine: boolean;
  showName: boolean;
  avatarSlot: 'avatar' | 'none';
  tail: boolean;
}) {
  const align = useChatPrefs((s) => s.align);
  const atEnd = mine && align === 'both';
  const variant = mine ? 'default' : 'card';
  return (
    <Message align={atEnd ? 'end' : 'start'} className="group/msg">
      {avatarSlot === 'avatar' ? (
        <MessageAvatar>
          <PersonAvatar
            name={message.author.displayName}
            avatarUrl={message.author.avatarUrl}
            decorative
            className="size-7"
          />
        </MessageAvatar>
      ) : null}
      <MessageContent>
        {showName ? null : (
          <span className="sr-only">{withoutPatronymic(message.author.displayName)}: </span>
        )}
        <Bubble variant={variant}>
          <BubbleOutline side={tail ? (atEnd ? 'right' : 'left') : null} variant={variant} />
          <BubbleContent
            className={cn(
              'relative flex flex-col gap-[2px] px-2.5 pt-2.5 pb-[8px] leading-tight',
              tail && (atEnd ? 'rounded-br-none' : 'rounded-bl-none'),
            )}
          >
            {showName ? (
              // Персональный цвет автора (#180), оптическая компенсация #181.
              <span
                className={cn(
                  '-mt-[3px] text-sm leading-[19px] font-semibold',
                  personTone(message.author.id),
                )}
              >
                {shortPersonName(message.author.displayName)}
              </span>
            ) : null}
            {/* Надгробие + время: та же пара призрак+булавка (стабильная
                модель Telegram, раунд 10 — как у живых сообщений). */}
            <span className="-mt-[3px] flex flex-wrap items-center gap-x-1.5">
              <MessageTombstone mine={mine} />
              <MetaGhost message={message} mine={mine} />
            </span>
            <MetaPin message={message} mine={mine} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
