import { memo, type ReactNode } from 'react';
import type { ChatMessage } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Message, MessageAvatar, MessageContent } from '@nodus/ui/components/message';
import { Bubble, BubbleContent } from '@nodus/ui/components/bubble';

import { openCardViaBridge } from '../lib/card-bridge.js';
import { shortPersonName, withoutPatronymic } from '../lib/format.js';
import { personTone } from '../ui/person-tone.js';
import { attachmentsLayout, mediaBubbleWidth, MessageAttachments } from './attachments.js';
import { BubbleOutline } from './bubble-outline.js';
import { useChatPrefs } from './chat-prefs.js';
import { useChatHostNavigation } from './chat-host.js';
import { useJumpStore } from './jump-store.js';
import { ForwardedHeader, ReplyHeader } from './message-headers.js';
import { MessageReactions } from './message-reactions.js';
import { MessageMeta } from './message-meta.js';
import { MessageText } from './message-text.js';
import { linkCardVisible, MessageLinkPreview } from './link-preview-card.js';
import { ReactionPicker } from './reaction-picker.js';
import { stickerAttachmentOf, StickerMessageView } from './sticker-message.js';
import { TombstoneBubble } from './tombstone.js';
import { TransitionBlock } from './transition-block.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { MediaMessage, MetaGhost, MetaPin } from './message-media-bubble.js';
import { hasEntityPreviews } from './message-text.js';
import { UrgentChips } from './urgent-chips.js';

/** Реакции — в собственном файле (потребитель-стикер #143); реэкспорт для
 *  точек импорта (post-card, тесты). */
export { MessageReactions } from './message-reactions.js';

/**
 * Сообщение чата по канону Битрикс24/Телеграм (вердикт владельца 14.09.2026,
 * план docs/mvp/archive/chat-messages-plan.md; имя внутрь пузыря — вердикт
 * 24.09.2026, #96): лента grouped на серии одного автора (`message-groups.ts`),
 * и серия распределяет атрибуты —
 * - имя (`showName`): только чужое и только ВНУТРИ ПЕРВОГО пузыря серии —
 *   верхней строкой облака, полужирным акцентом (реф Битрикс24: имя цветное и
 *   отличается от текста, лента читается без лишней вертикали «имя — пузырь»);
 * - аватар: один на серию, у ПОСЛЕДНЕГО сообщения — колонку аватара держит
 *   grid серии (`message-run.tsx`, #164: аватар — sticky-элемент серии,
 *   прилипает к нижней кромке ленты при прокрутке); вне серий (посты каналов,
 *   корень треда) компонента рисует аватар сама (`avatarSlot="avatar"`);
 * - хвостик (`tail`): только у ПОСЛЕДНЕГО пузыря серии, из его нижнего угла
 *   к низу аватарки (BubbleOutline, SVG-слой на боксе пузыря);
 * - мета: нижняя строка ПОД содержимым (не в строке текста) — реакции слева,
 *   пин/«изменено»/время/галочки справа (`message-meta.tsx`, общий с постами
 *   каналов); для скринридера у сообщений без видимого имени — sr-only
 *   автор (визуальное имя только у первого в серии — AT не должен терять
 *   автора).
 * Выравнивание — НАСТРОЙКА пользователя (`chat-prefs.ts`): 'one' (дефолт) —
 * все с одной стороны; 'both' — классика: свои справа. Реакции и вложения —
 * ВНУТРИ пузыря; действия — контекстное меню по правому клику (MessageMenu,
 * без кнопок на сообщении — вердикт владельца).
 * Стикер-сообщение (#143) — отдельная ветка без пузыря (StickerMessageView).
 */
export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  mine,
  showName = false,
  avatarSlot = 'avatar',
  tail = false,
  reactionsHidden = false,
  receiptsHidden = false,
  nameSuffix,
  reactionsRow,
  reactionPicker,
}: {
  message: ChatMessage;
  mine: boolean;
  /** Имя автора ВНУТРИ пузыря верхней строкой — только чужое и только первое в серии. */
  showName?: boolean;
  /** Слот аватара: 'avatar' — рисуем свой (вне серий: посты каналов, корень
   *  треда); 'none' — колонку аватара держит grid серии (message-run.tsx,
   *  #164), распорка не нужна. */
  avatarSlot?: 'avatar' | 'none';
  /** Хвостик из низа аватарки — у последнего пузыря серии. */
  tail?: boolean;
  /** Режим выделения: реакции недоступны (модель Битрикс24, #132 р.4). */
  reactionsHidden?: boolean;
  /** Витрина «Избранного» (#215): мета «просмотрено/ознакомились» выключена
   *  для ВСЕХ строк (записей и карточек-оригиналов). */
  receiptsHidden?: boolean;
  /** Доп-подпись рядом с именем автора (карточки избранного: «из <чат>»). */
  nameSuffix?: ReactNode;
  /** Замена ряда реакций (карточки избранного: личные эмодзи-метки вместо
   *  публичных чипов — #171 ревизия 04.10). */
  reactionsRow?: ReactNode;
  /** Замена ховер-пикера реакций (карточки: пилюля личных меток); получает
   *  atEnd (сторона пилюли — как у ReactionPicker). */
  reactionPicker?: (atEnd: boolean) => ReactNode;
}) {
  const align = useChatPrefs((s) => s.align);
  const atEnd = mine && align === 'both';
  // Хозяин чата (вердикт 25.09): мессенджер навигирует внутренне, у чатов
  // карточек сущностей контекста нет — их переход к чужой беседе идёт
  // карточкой мессенджера (слайдер поверх сущности).
  const host = useChatHostNavigation();

  // Чужой пузырь — вариант card: БЕЗ рамки, контур ступенью тона поверх зоны
  // (вердикт владельца 14.09.2026, рефы Битрикс24; рамка + SVG-обводка хвоста
  // давали артефакты стыка — пузыри и хвост теперь только заливками).
  const variant = mine ? 'default' : 'card';

  // Надгробие (#163, вердикт владельца 30.09 «по ответам»): обычный пузырь
  // серии — аватар/имя/мета/хвостик несёт серия (message-groups не рвёт run),
  // внутри приглушённая строка «Сообщение удалено». Сервер оставляет его
  // только при живых ответах (якорь цепочки); контент обнулён в DTO,
  // действий нет — conversation-pane рендерит надгробие БЕЗ MessageMenu.
  if (message.deletedAt) {
    return (
      <TombstoneBubble
        message={message}
        mine={mine}
        showName={showName}
        avatarSlot={avatarSlot}
        tail={tail}
      />
    );
  }

  // Блок перехода задачи (#380), письма (#55) и действия без смены статуса
  // (#633): запись журнала, не пузырь — компактный блок во всех хостах.
  if (
    (message.kind === 'task_transition' ||
      message.kind === 'letter_transition' ||
      message.kind === 'task_action') &&
    message.block
  ) {
    return (
      <TransitionBlock message={message} mine={mine} showName={showName} avatarSlot={avatarSlot} />
    );
  }

  // Стикер (#143): без пузыря — крупный глиф + метка; клик — поповер пака
  // (дистрибуция «из чата»). Имя автора не выводится (канон Telegram).
  const stickerAttachment = stickerAttachmentOf(message);
  // Пилюля реакций/меток — ОДНА на все ветки формы (текст/медиа/стикер):
  // слот витрины (#171/#215) либо публичный ReactionPicker.
  const pickerNode = reactionsHidden ? null : reactionPicker !== undefined ? (
    reactionPicker(atEnd)
  ) : (
    <ReactionPicker message={message} atEnd={atEnd} />
  );
  if (stickerAttachment) {
    return (
      <StickerMessageView
        message={message}
        attachment={stickerAttachment}
        mine={mine}
        avatarSlot={avatarSlot}
        reactionsHidden={reactionsHidden}
        reactionsRow={reactionsRow}
        receiptsHidden={receiptsHidden}
      >
        {pickerNode}
      </StickerMessageView>
    );
  }

  /** Клик по цитате — прыжок к оригиналу в ТОМ ЖЕ контексте (лента/тред:
   *  ответ не пересекает тред — threadRootId текущего сообщения). */
  function jumpToReply(replyId: string) {
    useJumpStore.getState().request(message.conversationId, replyId, message.threadRootId);
  }

  /** Клик по «Переслано от» — к оригиналу. В мессенджере (страница/карточка)
   *  навигация ВНУТРИ него: переключиться на беседу-источник/тред — слайдер
   *  не открывается (вердикт 25.09); в карточке слайдера это замена её
   *  содержимого (без вложенных слайдеров). Чат карточки сущности открывает
   *  мессенджер-карточку поверх (легитимная роль слайдера). Далее jump-запрос
   *  подбирает лента целевой беседы (переживает навигацию, jump-store). */
  function jumpToForwardSource() {
    const from = message.forwardedFrom;
    if (!from) return;
    if (from.conversationId !== message.conversationId) {
      if (host) host.openConversation(from.conversationId, from.threadRootId);
      else openCardViaBridge({ kind: 'messenger', id: from.conversationId });
    }
    useJumpStore.getState().request(from.conversationId, from.messageId, from.threadRootId);
  }

  // Медиа (single/gallery) — АРХИТЕКТУРА «ЧАСТЕЙ» (раунд 3 п.3/п.4):
  // отдельные блоки шапки/низа, между ними картинка; за картинкой фона нет —
  // швам неоткуда взяться. Вся композиция — MediaMessage.
  const layout = attachmentsLayout(message.attachments);
  const media = layout.mode === 'single' || layout.mode === 'gallery';
  const finSide = tail ? (atEnd ? 'right' : 'left') : null;
  const hasReactionsRow = reactionsRow !== undefined || message.reactions.length > 0;
  if (media) {
    return (
      <Message align={atEnd ? 'end' : 'start'} className="group/msg">
        {avatarSlot === 'avatar' ? (
          <MessageAvatar>
            <PersonAvatar name={message.author.displayName} className="size-7" />
          </MessageAvatar>
        ) : null}
        <MessageContent>
          {showName ? null : (
            <span className="sr-only">{withoutPatronymic(message.author.displayName)}: </span>
          )}
          <MediaMessage
            message={message}
            mine={mine}
            showName={showName}
            finSide={finSide}
            onJumpToReply={jumpToReply}
            onJumpToForwardSource={jumpToForwardSource}
            reactionsRow={reactionsRow}
            receiptsHidden={receiptsHidden}
          >
            {pickerNode}
          </MediaMessage>
        </MessageContent>
      </Message>
    );
  }

  // Текст с карточками-превью (flex-col) — мета строкой ниже, не уголком.
  const entityRow = Boolean(message.text && hasEntityPreviews(message.text));
  // Карточка OG-превью — тот же канон (#238): флоат-мета (призрак+булавка)
  // перекрывала карточку; мета становится строкой ПОД карточкой, как у
  // entity-карточек. Условие видимости — общее с MessageLinkPreview.
  const linkRow = linkCardVisible(message.text, message.linkPreview);
  const contentWidth = mediaBubbleWidth(message.attachments, {
    hasTextColumn: true,
  });
  return (
    <Message align={atEnd ? 'end' : 'start'} className="group/msg">
      {avatarSlot === 'avatar' ? (
        <MessageAvatar>
          <PersonAvatar name={message.author.displayName} className="size-7" />
        </MessageAvatar>
      ) : null}
      <MessageContent>
        {/* Имя визуально — ВНУТРИ пузыря (ниже); здесь остаётся sr-only автор
            для сообщений серии без видимого имени (AT не теряет автора). */}
        {showName ? null : (
          <span className="sr-only">{withoutPatronymic(message.author.displayName)}: </span>
        )}
        {/* mb-2 у важного (#177, ревизия приёмки 05.10): чип на нижней кромке
            выступает под пузырь — без отступа наезжал на следующий пузырь
            серии (зазор внутри серии 2px). */}
        <Bubble
          variant={variant}
          data-urgent={message.urgent || undefined}
          className={message.urgent ? 'mb-2' : undefined}
        >
          {/* Контурный слой (#155 р.10-11) — ПОД контентом: единая заливка
              силуэта (CSS-фон пузыря прозрачен); рамка селекта (толстая,
              единая с хвостиком) — второй svg слоя НАД контентом (р.2 п.1).
              data-urgent (#177): статичный warning-бордер (globals.css). */}
          <BubbleOutline side={finSide} variant={variant} />
          {/* Угол со стороны хвостика — БЕЗ скругления: прямой угол накрыт
              заливкой хвоста, штрих хвоста продолжает бордюр пузыря одной
              линией (bubble-outline.tsx, вердикт 14.09.2026). */}
          {/* Реакции и вложения — ВНУТРЬ пузыря (вердикт 14.09.2026): они
              расширяют пузырь по высоте. Зазор строк — ЦЕЛЫЕ 2px (вердикт
              #181: дробные rem при --ui-scale 1.25 округляются врозь). */}
          <BubbleContent
            className={cn(
              // Поля 10px сверху/сбоков, 6px снизу: низ — последняя строка
              // текста с ИНЛАЙН-меткой (раунд 8) либо ряд реакций; визуальный
              // низ меты ≈ 5–6css от края одинаково. leading-tight — ШТРИХ
              // контейнера (р.2 п.7): фактический шаг строк задаёт strut.
              // pb-8px = булавке MetaPin bottom-8px: низ меты ОДИНАКОВ с
              // рядами реакций (стабильность, раунд 11 п.2). Важное (#177):
              // pb-14px — резерв под чипы на нижней кромке (сквозь бордер),
              // мета поднята той же величиной (MetaPin urgent).
              'relative flex flex-col gap-[2px] px-2.5 pt-2.5 leading-tight',
              // Важное (#177, ревизия 05.10): pb-14px — резерв под чип на
              // кромке; min-w-28 — чип задаёт ширину ОДНО-СИМВОЛЬНОГО
              // пузыря (не вылезает влево за бордер, вердикт владельца).
              message.urgent ? 'pb-[14px] min-w-28' : 'pb-[8px]',
              tail && (atEnd ? 'rounded-br-none' : 'rounded-bl-none'),
            )}
            style={contentWidth ? { width: contentWidth, maxWidth: '100%' } : undefined}
          >
            {/* Имя автора — ВЕРХНЯЯ строка пузыря (вердикт 24.09.2026, #96):
                только чужое и только у первого сообщения серии; цвет
                ПЕРСОНАЛЬНЫЙ (#180). -mt-[3px] — оптическая компенсация (#181). */}
            {showName ? (
              <span
                className={cn(
                  '-mt-[3px] flex min-w-0 items-baseline gap-1 text-sm leading-[19px] font-semibold',
                  personTone(message.author.id),
                )}
              >
                <span className="truncate">{shortPersonName(message.author.displayName)}</span>
                {nameSuffix}
              </span>
            ) : null}
            {/* Атрибуция пересылки — следующая строка пузыря (канон
                Telegram lng_forwarded). */}
            {message.forwardedFrom ? (
              <ForwardedHeader from={message.forwardedFrom} onClick={jumpToForwardSource} />
            ) : null}
            {/* Цитата ответа (A2): замороженный снапшот — клик ведёт к
                оригиналу (актуальная версия + «изменено» там же). */}
            {message.reply ? (
              <ReplyHeader
                reply={message.reply}
                onFilled={mine}
                onClick={() => {
                  const reply = message.reply;
                  if (reply) jumpToReply(reply.id);
                }}
              />
            ) : null}
            {/* Вложения-карточки — ВЫШЕ текста (грамматика Битрикс24):
                карточный список сверху, затем текст. */}
            {message.attachments.length > 0 ? (
              <MessageAttachments message={message} mine={mine} />
            ) : null}
            {/* Текст + мета: MetaGhost (призрак в потоке — ширина карточки
                всегда вмещает метку); при entity/OG-карточках призрак и
                булавка не рисуются — мета строкой ПОД карточками (#238). */}
            <span
              className={cn(
                'block',
                showName || message.reply || message.forwardedFrom || message.attachments.length > 0
                  ? ''
                  : '-mt-[3px]',
                hasReactionsRow && 'pb-[2px]',
              )}
            >
              <MessageText text={message.text} />
              {hasReactionsRow || entityRow || linkRow ? null : (
                <MetaGhost message={message} mine={mine} noReceipts={receiptsHidden} />
              )}
            </span>
            {/* Карточка-цитата первой ссылки (#212): ПОД текстом — сначала
                сообщение, затем доп-контекст (канон Telegram/Slack: превью
                «just below the message»); дозревает фоном (WS), скелетон
                без сдвига макета. */}
            <MessageLinkPreview text={message.text} preview={message.linkPreview} />
            {hasReactionsRow ? (
              <span className="flex items-end gap-2">
                {reactionsRow ?? <MessageReactions message={message} onFilled={mine} />}
                <MessageMeta
                  message={message}
                  onFilled={mine}
                  ticks={mine}
                  noReceipts={receiptsHidden}
                  className="ml-auto"
                />
              </span>
            ) : entityRow || linkRow ? (
              /* Мета строкой под карточками превью (entity/OG) — призрак и
                 булавка гаснут (#238): карточка всегда заканчивается выше
                 метки, как в Telegram. */
              <span className="flex justify-end">
                <MessageMeta
                  message={message}
                  onFilled={mine}
                  ticks={mine}
                  noReceipts={receiptsHidden}
                />
              </span>
            ) : (
              <MetaPin
                message={message}
                mine={mine}
                noReceipts={receiptsHidden}
                urgent={message.urgent}
              />
            )}
          </BubbleContent>
          {/* Чипы важного (#177): «Ознакомлен» (получателю requireAck) +
              «Важное» (всем) — на нижней кромке, сквозь бордер. */}
          <UrgentChips message={message} />
          {/* Ховер-попап реакций (#124): кнопка у нижнего угла пузыря
              (Bubble — relative), видна по hover/focus/открытом попапе. */}
          {/* В режиме выделения реакции недоступны (модель Битрикс24, #132 р.4). */}
          {pickerNode}
        </Bubble>
      </MessageContent>
    </Message>
  );
});
