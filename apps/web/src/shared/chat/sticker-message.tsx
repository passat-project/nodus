import { memo, type ReactNode } from 'react';
import type { ChatMessage, MessageAttachment } from '@nodus/contracts';
import { Message, MessageAvatar, MessageContent } from '@nodus/ui/components/message';
import { cn } from '@nodus/ui/lib/utils';

import { PersonAvatar } from '../ui/person-avatar.js';
import { useChatPrefs } from './chat-prefs.js';
import { MessageMeta } from './message-meta.js';
import { MessageReactions } from './chat-message.js';
import { useJumpStore } from './jump-store.js';
import { ReplyHeader } from './message-headers.js';
import { ReactionPicker } from './reaction-picker.js';
import { StickerWindowTrigger } from './sticker-pack-window.js';

/**
 * Стикер-сообщение (#143, модель Telegram/Битрикс24): БЕЗ пузыря — крупный
 * глиф (прецеденты обхода пузыря: одиночный эмодзи #130, надгробие A5),
 * метка времени под ним; имя автора не выводится (канон Telegram), для AT —
 * sr-only как в обычных сообщениях без видимого имени. Клик по стикеру —
 * поповер пака (сетка + «Добавить пак», дистрибуция «из чата»).
 */

/** Вложение-стикер сообщения (kind='sticker') или undefined. */
export function stickerAttachmentOf(message: ChatMessage): MessageAttachment | undefined {
  return message.attachments.find((a) => a.kind === 'sticker');
}

/** Кегль стикера в ленте — единый для чатов и постов канала: ПОТОЛОК
 *  208 CSS px (≈260 экранных при ui-scale 1.25) — паритет Telegram Desktop
 *  (maxStickerSize 256px, research Exa; вердикт владельца 01.10 #175).
 *  Мягкие углы (#288, вердикт владельца 14.10): скругление CSS-клипом,
 *  файлы не обрабатываются. Именно MAX, а не фиксированный квадрат:
 *  бокc обнимает картинку (сохраняя пропорции), иначе у неквадратных
 *  стикеров радиус резал углы ПУСТЫХ полей object-contain, а не рисунка
 *  (репро владельца 14.10: «прямоугольный не скруглился»). */
export const stickerFeedClass = 'max-h-52 max-w-52 rounded-2xl object-contain';

/** Рендер одного стикера — в собственном модуле `sticker-glyph.ts` (#288:
 *  глиф нужен цитате ответа в message-headers без цикла импортов). */
import { StickerGlyph } from './sticker-glyph.js';
export { StickerGlyph } from './sticker-glyph.js';

/** Стикер-сообщение: глиф 208px + мета; ховер-реакции — та же механика,
 *  что у пузырей (group/bubble-контейнер для ReactionPicker). */
export const StickerMessageView = memo(function StickerMessageView({
  message,
  attachment,
  mine,
  avatarSlot = 'avatar',
  reactionsHidden = false,
  reactionsRow,
  receiptsHidden = false,
  children,
}: {
  message: ChatMessage;
  attachment: MessageAttachment;
  mine: boolean;
  /** Слот аватара: 'avatar' — свой (вне серий); 'none' — колонку держит
   *  grid серии (message-run.tsx, #164). */
  avatarSlot?: 'avatar' | 'none';
  reactionsHidden?: boolean;
  /** Замена ряда реакций (карточки избранного: личные метки — #215). */
  reactionsRow?: ReactNode;
  /** Витрина «Избранного» (#215): мета «просмотрено» выключена. */
  receiptsHidden?: boolean;
  /** Пилюля реакций хозяина (ReactionPicker / пилюля личных меток). */
  children?: ReactNode;
}) {
  const align = useChatPrefs((s) => s.align);
  const atEnd = mine && align === 'both';
  const meta = attachment.sticker ?? null;
  return (
    <Message align={atEnd ? 'end' : 'start'} className="group/msg">
      {/* Аватар автора — ВИДИМЫЙ (вердикт владельца 30.09: «скидываются
          анонимно»): стикер = обычное сообщение, авторство видно всегда. */}
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
        {/* Имя стикер НЕ показывает никогда (канон Telegram) — sr-only автор
            обязателен ВСЕГДА, включая слот с видимым аватаром (валидатор
            #164: иначе стикер вне серии терял атрибуцию, которую пузырь
            там же имеет). */}
        <span className="sr-only">{message.author.displayName}: </span>
        {/* w-fit: колонка по ширине глифа (не на всю строку ленты) — иначе
            мета/реакции убегают к правому краю экрана (ревизия 30.09).
            data-slot обязателен: MessageContent прижимает вправо (align=end,
            «По обе стороны») только детей с data-slot — без него стикер
            оставался слева при аватаре справа (баг-вердикт 30.09, #164). */}
        <span data-slot="sticker-message" className="flex w-fit flex-col">
          {/* Ряд «глиф + цитата» (#297, ревизия владельца 15.10, модель
              Telegram): цитата СПРАВА от глифа (у своих — слева, row-reverse),
              ВНЕ плиты выделения и с зазором, в который проходит рамка
              селекта: цитата больше не растягивает строку стикера и не
              уводит якорь реакций от глифа (репорт владельца: «стикер 160px,
              цитата 220px, реакции далеко»). */}
          <span className={cn('flex w-fit items-start gap-1.5', atEnd && 'flex-row-reverse')}>
            {/* Плита выделения — ТОЛЬКО глиф (канон 14.10: рамка обнимает
                стикер); она же якорь ховер-пилюли реакций и метки времени
                (group/bubble + relative). В базе прозрачна с прозрачным
                бордером (layout стабилен), data-selected красит целиком
                (globals.css). */}
            <span className="group/bubble relative flex w-fit flex-col">
              <span
                data-slot="sticker-body"
                className="flex w-fit flex-col rounded-2xl border border-transparent p-2"
              >
                <StickerWindowTrigger message={message} attachment={attachment} plate={false}>
                  <StickerGlyph
                    url={attachment.url ?? ''}
                    mime={attachment.mime}
                    alt={meta ? `${meta.packTitle} ${meta.emojis.join(' ')}` : undefined}
                    className={stickerFeedClass}
                  />
                </StickerWindowTrigger>
              </span>
              {/* Метка времени стикера — ТОЛЬКО по ховеру и СБОКУ глифа снизу
                  (Telegram; вердикт владельца 15.10): под глифом её пересекал
                  кружок реакций. Пилюля на подложке — читаема и над низким
                  глифом, и рядом с цитатой. pointer-events-none — не мешает
                  ховеру панели реакций. */}
              <span
                className={cn(
                  // Правее кружка реакций (пилюля торчит за плиту на 12dp):
                  // ml/mr-3.5 = 14dp — метка не пересекает кружок (репорт
                  // владельца 15.10, ревизия 2). Заливка-пилюля как в
                  // Telegram — читается на любом фоне ленты.
                  'pointer-events-none absolute bottom-1 z-10 rounded-full bg-muted/80 px-2 opacity-0 transition-opacity duration-150 group-hover/bubble:opacity-100',
                  atEnd ? 'right-full mr-3.5' : 'left-full ml-3.5',
                )}
              >
                <MessageMeta
                  message={message}
                  onFilled={false}
                  ticks={mine}
                  noReceipts={receiptsHidden}
                />
              </span>
              {reactionsHidden
                ? null
                : (children ?? <ReactionPicker message={message} atEnd={atEnd} />)}
            </span>
            {/* Цитата ответа (#288): связь стикер-ответ видима; клик — прыжок
                с подсветкой. Ширина фикс w-40, длинное обрезается; стоит
                В ПОТОКЕ рядом с глифом (наложение на глиф запрещено
                вердиктом 14.10), верхняя кромка — по верхней кромке глифа
                (mt-2 = паддинг плиты). Фон — штатная полупрозрачная цитата. */}
            {message.reply ? (
              // Верх цитаты — ТОЧНО по верху глифа: паддинг плиты p-2 + её
              // бордер 1px (ревизия владельца 15.10: цитата висела на пару
              // пикселей выше стикера).
              <span className="mt-[calc(0.5rem+1px)] w-40 shrink-0">
                <ReplyHeader
                  reply={message.reply}
                  onFilled={mine}
                  onClick={() => {
                    const reply = message.reply;
                    if (reply)
                      useJumpStore
                        .getState()
                        .request(message.conversationId, reply.id, message.threadRootId);
                  }}
                />
              </span>
            ) : null}
          </span>
          {/* Чипы реакций — под плитой с минимальным зазором (вердикт
              владельца 15.10: вплотную к рамке селекта — некрасиво). Тон
              muted: стикер без поверхности (#127). Слот витрины
              «Избранного» — личные метки вместо публичных реакций (#215). */}
          <span
            className={cn('mt-1 flex w-fit items-end gap-2', atEnd && 'flex-row-reverse self-end')}
          >
            {reactionsRow ?? <MessageReactions message={message} onFilled={false} />}
          </span>
        </span>
      </MessageContent>
    </Message>
  );
});
