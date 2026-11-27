import type { ChatMessage } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { withoutPatronymic } from '../lib/format.js';
import { personTone } from '../ui/person-tone.js';
import { snapDevicePx } from '../ui/ui-scale.js';
import { attachmentsLayout, mediaBubbleWidth, MessageAttachments } from './attachments.js';
import { MessageReactions } from './chat-message.js';
import { useChatHostNavigation } from './chat-host.js';
import { jumpToForwardSource } from './forward-source-jump.js';
import { ForwardedHeader } from './message-headers.js';
import { messageSurface } from './message-surface.js';
import {
  MediaArea,
  MediaTimeChip,
  MetaGhost,
  MetaPin,
  SelectRing,
} from './message-media-bubble.js';
import { MessageMeta } from './message-meta.js';
import { UrgentChips } from './urgent-chips.js';
import { hasEntityPreviews, MessageText } from './message-text.js';
import { linkCardVisible, MessageLinkPreview } from './link-preview-card.js';
import { ThreadStrip, ThreadStripEnter } from './post-thread-strip.js';
import { ReactionPicker } from './reaction-picker.js';
import { StickerGlyph, stickerAttachmentOf, stickerFeedClass } from './sticker-message.js';
import { StickerWindowTrigger } from './sticker-pack-window.js';
import { MessageTombstone } from './tombstone.js';

/**
 * Карточка поста канала — ЕДИНАЯ сущность «сообщение» для ленты новостей
 * (#127): поверхность из общей точки решения (message-surface), мягкая
 * карточка БЕЗ хвостика. Вердикт владельца 30.09 (#164): аватар вынесен в
 * колонку слева, как у пузырей чата — рендер поста идёт через тот же
 * run-grid (MessageRunView), один пост = серия из одного сообщения; имя
 * автора — ПЕРВАЯ строка карточки (только у первого ЧУЖОГО поста серии,
 * свои БЕЗ имени — канон чатов #180).
 *
 * Медиа-стиль Telegram (#187): изображение — ЧАСТЬ карточки, full-bleed
 * (без боковых полей; ширина картинки = ширина карточки), шапка имени и
 * подпись — блоки с полями 10px (#181); потолок ширины — ОТНОСИТЕЛЬНЫЙ
 * min(100%, 42rem): при сужении ленты (окно треда) пост сжимается вместе
 * с ней, а не обрезается справа (баг #187 Ф1а); пропорции картинки держит
 * aspect-ratio плитки (attachment-gallery).
 *
 * Надгробие удалённого поста (#163 «по ответам»): пост с живым тредом
 * остаётся двухуровневой карточкой — сверху приглушённая строка «Сообщение
 * удалено», снизу ТА ЖЕ полоса обсуждения (кнопка) — доступ к обсуждениям
 * сохраняется. Без живых ответов сервер убирает пост бесследно.
 */
export function PostCard({
  message,
  mine,
  atEnd,
  showName,
  repliesCount,
  participants,
  lastReplyAt,
  threadUnread,
  reactionsHidden,
  threadOpen,
  onToggleThread,
}: {
  message: ChatMessage;
  mine: boolean;
  /** «По обе стороны»: свой пост прижат вправо (аватар — справа, зеркало run-grid). */
  atEnd: boolean;
  /** Имя автора первой строкой — только у ПЕРВОГО ЧУЖОГО поста серии. */
  showName: boolean;
  repliesCount: number;
  participants: ChatMessage['author'][];
  lastReplyAt: string | null;
  /** Точка «есть новые» в треде (наблюдателю, раунд 3). */
  threadUnread: boolean;
  /** Режим выделения: реакции недоступны (#132 р.4). */
  reactionsHidden: boolean;
  /** Окно треда ЭТОГО поста сейчас открыто (полоса = тумблер, #1021). */
  threadOpen: boolean;
  /** Открыть/закрыть тред. КЛИКОВЫЙ вход — только полоса-тумблер (решение
   *  владельца 24.11.2026, #1021): клик по телу поста тред не открывает,
   *  полоса в открытом состоянии подписана «Свернуть ←» (#1061); крестик
   *  «Закрыть» есть в шапке окна треда (side, вердикт 25.11.2026).
   *  Существующий вход ПКМ «Ответить» сохранён — тоже открывает тред. */
  onToggleThread: () => void;
}) {
  const surface = messageSurface(mine);
  const host = useChatHostNavigation();
  const sticker = stickerAttachmentOf(message);
  const layout = attachmentsLayout(message.attachments);
  const media = (layout.mode === 'single' || layout.mode === 'gallery') && !sticker;
  // Соло-медиа без текста (р.3 п.2): время — чип на картинке, не нижний блок.
  const imageOnly = media && !message.text?.trim();
  // Ширина медиа-поста задаёт вложение (механика Telegram, #150/#187); у
  // поста всегда есть нижняя полоса обсуждения и, как правило, текст — пол
  // колонки текста держим всегда. Device-снап: дробный DPR даёт субпиксельные
  // рёбра картинки — «пляшущие» дуги AA у скруглений (#187 раунд 5 п.7).
  const rawWidth = media ? mediaBubbleWidth(message.attachments, { hasTextColumn: true }) : null;
  const postWidth = rawWidth === null ? null : snapDevicePx(rawWidth);
  // Соло-медиа пост: реакции — ЧИПАМИ ПОД карточкой (раунд 5 п.6, как у
  // сообщений чата), НЕ создают нижний бар внутри карточки.
  const soloMedia = imageOnly && media;
  // Текст с карточками-превью (flex-col) — мета строкой ниже, не уголком.
  const entityRow = Boolean(message.text && hasEntityPreviews(message.text));
  // OG-карточка под текстом — мета строкой ПОД карточкой (#238): булавка
  // (absolute bottom) перекрывала карточку; условие видимости общее с
  // MessageLinkPreview (#240).
  const linkRow = linkCardVisible(message.text, message.linkPreview);

  // Надгробие: контент обнулён сервером (текст/вложения/реакции), действий
  // нет — остаётся шапка автора, строка удаления и полоса обсуждения.
  if (message.deletedAt) {
    return (
      <div
        className={cn(
          surface.fill,
          'relative w-fit max-w-[min(100%,42rem)] overflow-hidden rounded-xl border border-border text-left',
        )}
        data-slot="post-surface"
        data-surface={surface.tone}
      >
        {/* Имя в надгробии — у ЧУЖИХ постов (контент пуст, авторство — опора
            цепочки обсуждения #163); свой удалённый пост БЕЗ имени, как свои
            живые посты (канон чатов #180) — AT получает sr-only. */}
        {showName ? (
          <span
            className={cn(
              '-mt-[3px] block px-2.5 pt-2.5 text-sm leading-[19px] font-semibold',
              personTone(message.author.id),
            )}
          >
            {withoutPatronymic(message.author.displayName)}
          </span>
        ) : (
          <span className="sr-only">{message.author.displayName}: </span>
        )}
        <span className={cn('block px-2.5 pb-2.5', showName ? 'pt-[2px]' : 'pt-[7px]')}>
          <MessageTombstone mine={mine} />
        </span>
        {repliesCount > 0 ? (
          <button
            type="button"
            onClick={onToggleThread}
            aria-expanded={threadOpen}
            className="flex h-8 w-full cursor-pointer items-center gap-2 border-t border-border/60 bg-current/10 px-2.5 text-left transition-colors hover:bg-current/20"
          >
            <ThreadStrip
              surface={surface}
              participants={participants}
              repliesCount={repliesCount}
              lastReplyAt={lastReplyAt}
              threadUnread={threadUnread}
            />
            <ThreadStripEnter surface={surface} open={threadOpen} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* Карточка НЕ открывает тред кликом по себе (решение владельца
          24.11.2026, #1021): единственная точка — полоса «Обсудить» ниже.
          Поэтому без role="button"/onClick: выделение текста, ссылки и
          реакции живут как обычный контент. */}
      <div
        className={cn(
          surface.fill,
          'relative w-fit max-w-[min(100%,42rem)] rounded-xl text-left transition-colors group/msg group/bubble',
          // Медиа-пост — БЕЗ рамки вообще (раунд 4: даже прозрачный бордер
          // давал 1px-полосу фона вдоль картинки — background-clip:border-box
          // красит фон ПОД прозрачным бордером, инсет = «линии вокруг
          // изображения»); текстовый пост — hairline.
          media ? 'border-0' : 'border border-border hover:border-input',
        )}
        data-slot="post-surface"
        data-surface={surface.tone}
        style={postWidth ? { width: postWidth, maxWidth: '100%' } : undefined}
      >
        {/* Клип углов full-bleed медиа — ВНУТРЕННЕЙ обёрткой: ховер-кнопка
          реакций (#124) выступает за нижний угол карточки (-right-3) и под
          overflow-hidden внешнего контейнера обрезалась (регресс #187 п.11:
          «ободок кружка есть, глифа нет») — пи́лер живёт СИБЛИНГом клипа.
          Радиус клипа = внешний МИНУС бордер (у медиа бордера нет). */}
        <div
          className={cn('overflow-hidden', media ? 'rounded-xl' : 'rounded-[calc(0.875rem-1px)]')}
        >
          {/* Автор — первая строка карточки, только у первого ЧУЖОГО поста серии;
            у остальных и у своих — sr-only (AT не теряет автора, как в пузырях
            чатов). Цвет персональный (#180). -mt-[3px] — оптическая компенсация
            воздуха строки имени: визуальный верх = полям 10px (#181).
            МЕДИА-пост: зазор под именем до картинки = шапке медиа-сообщения
            чата (pb-9px, раунд 6 п.2 — консистентность хостов); текстовый пост
            держит плотный ритм (2px несёт блок текста ниже). */}
          {showName ? (
            <span
              className={cn(
                '-mt-[3px] block px-2.5 pt-2.5 text-sm leading-[19px] font-semibold',
                media && !message.forwardedFrom && 'pb-[9px]',
                personTone(message.author.id),
              )}
            >
              {withoutPatronymic(message.author.displayName)}
            </span>
          ) : (
            <span className="sr-only">{message.author.displayName}: </span>
          )}
          {/* Атрибуция пересылки (#1072): у корневого поста канала — та же
              пометка «Переслано от», что в пузырях чата; клик — переход к
              оригиналу (мост карточек при чужой беседе-источнике). */}
          {message.forwardedFrom ? (
            <span
              className={cn(
                'block px-2.5',
                showName ? 'pt-[2px]' : 'pt-[7px]',
                media ? 'pb-[9px]' : 'pb-[2px]',
              )}
            >
              <ForwardedHeader
                from={message.forwardedFrom}
                onClick={() => jumpToForwardSource(message, host)}
              />
            </span>
          ) : null}
          {/* Плотность (#181): поля карточки одинаковые сверху/слева/справа для
            ВСЕГО контента; медиа — full-bleed без полей (#187); имя → контент
            2px (leading-[19px] короб строки #96). */}
          {sticker ? (
            <span className={cn('block w-fit px-2.5 pt-2.5', showName && 'pt-[2px]')}>
              <StickerWindowTrigger message={message} attachment={sticker}>
                <StickerGlyph
                  url={sticker.url ?? ''}
                  mime={sticker.mime}
                  alt={sticker.sticker?.packTitle}
                  className={stickerFeedClass}
                />
              </StickerWindowTrigger>
            </span>
          ) : media ? (
            // Медиа — full-bleed: ширина изображения = ширина карточки, боковых
            // полей нет; щит селекта — тон ПОВЕРХ картинки (п.3). Соло-картинка
            // без текста — чип времени НА изображении (раунд 3 п.2: низ не
            // рисуем ради одной метки).
            <MediaArea message={message} mine={mine}>
              {imageOnly ? <MediaTimeChip message={message} mine={mine} /> : null}
            </MediaArea>
          ) : message.attachments.length > 0 ? (
            <span
              className={cn('block max-w-full px-2.5 pt-2.5', showName && 'pt-[2px]')}
              style={{
                width: mediaBubbleWidth(message.attachments, { hasTextColumn: true }) ?? undefined,
              }}
            >
              <MessageAttachments message={message} mine={mine} />
            </span>
          ) : null}
          {/* Текст + мета: MetaGhost (ширина карточки всегда вмещает метку)
              + MetaPin (абсолют — ребёнок БЛОКА на всю ширину карточки:
              right-2.5 = 12.5px от края, bottom-8px от низа контент-зоны —
              как у пузырей чата, раунды 7–10). Ритм сверху: после картинки
              pt-5px (подпись медиа), после имени pt-2px (текст-пузырь),
              соло pt-7px; реакции — строкой ниже со временем справа.
              Соло-медиа без текста — блока нет (время чипом на картинке).
              ШТРИХ — leading-tight. */}
          {!imageOnly || !media ? (
            <span
              className={cn(
                'relative block px-2.5 pb-[8px] leading-tight text-sm',
                media
                  ? 'pt-[5px]'
                  : showName || sticker || message.attachments.length > 0 || message.forwardedFrom
                    ? 'pt-[2px]'
                    : 'pt-[7px]',
              )}
            >
              <MessageText text={message.text} />
              {message.reactions.length > 0 || entityRow || linkRow ? null : (
                <MetaGhost message={message} mine={mine} onFilled={surface.onFilled} />
              )}
              {/* Карточка первой ссылки ПОД текстом (#212, канон Telegram/
                  Slack — превью «just below the message»); мета — строкой
                  ПОД карточкой (#238). */}
              <MessageLinkPreview text={message.text} preview={message.linkPreview} />
              {(entityRow || linkRow) && message.reactions.length === 0 ? (
                <span className="flex justify-end">
                  <MessageMeta message={message} onFilled={surface.onFilled} ticks={mine} />
                </span>
              ) : null}
              {message.reactions.length > 0 || entityRow || linkRow ? null : (
                <MetaPin
                  message={message}
                  mine={mine}
                  onFilled={surface.onFilled}
                  urgent={message.urgent}
                />
              )}
            </span>
          ) : null}
          {/* Реакции — строкой ниже; время справа от них; у соло-медиа
            реакций здесь НЕТ — они чипами ПОД карточкой (раунд 5 п.6). */}
          {message.reactions.length > 0 && !soloMedia ? (
            <span className={cn('flex items-end gap-2 px-2.5 pt-[3px]', 'pb-[8px]')}>
              <MessageReactions message={message} onFilled={surface.onFilled} />
              <MessageMeta
                message={message}
                onFilled={surface.onFilled}
                ticks={mine}
                className="ml-auto"
              />
            </span>
          ) : null}
          {/* Чипы важного (#177): карточка поста с overflow-hidden — чипы
              ИНЛАЙН (в потоке, справа), не стрэддлом через кромку. */}
          <UrgentChips message={message} inline className="px-2.5 pb-[6px] justify-end" />
          {/* Полоса обсуждения — ПОСТОЯННАЯ высота h-8 (вердикт 28.09): аватарки
            size-5 центрируются, прыжков высоты нет; нижний full-bleed блок.
            ВПЛОТНУЮ к контенту (раунд 7 п.3): зазор метки до границы — как у
            пузырей чата (разделение несёт border-t полосы, не воздух).
            ТУМБЛЕР треда (#1021): клик открывает окно обсуждения, повторный —
            закрывает; aria-expanded для AT. */}
          <button
            type="button"
            onClick={onToggleThread}
            aria-expanded={threadOpen}
            className="flex h-8 w-full cursor-pointer items-center gap-2 border-t border-border/60 bg-current/10 px-2.5 text-left transition-colors hover:bg-current/20"
          >
            <ThreadStrip
              surface={surface}
              participants={participants}
              repliesCount={repliesCount}
              lastReplyAt={lastReplyAt}
              threadUnread={threadUnread}
            />
            <ThreadStripEnter surface={surface} open={threadOpen} />
          </button>
        </div>
        {/* Рамка выделения — overlay НАД контентом (раунд 4: у медиа-постов
          бордера нет вовсе, у текстовых он 1px — единая толстая рамка селекта
          для всех постов рисуется оверлеем, как у пузырей). */}
        <SelectRing />
        {/* Ховер-кнопка реакций поста (#124 → #132); в селекте недоступны. */}
        {reactionsHidden ? null : <ReactionPicker message={message} atEnd={atEnd} />}
      </div>
      {/* Реакции соло-медиа поста — ЧИПЫ ПОД карточкой на фоне ленты (раунд 5
          п.6, паритет с bare-медиа сообщений чата): без заливки/полей-бара;
          время остаётся чипом на картинке. */}
      {soloMedia && message.reactions.length > 0 ? (
        <span className="mt-[3px] flex w-fit max-w-full items-end gap-2">
          <MessageReactions message={message} onFilled={surface.onFilled} />
        </span>
      ) : null}
    </>
  );
}
