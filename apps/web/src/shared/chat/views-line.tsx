import { useMemo, useRef, useState } from 'react';
import type { ChatMessage, UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { PersonAvatar } from '../ui/person-avatar.js';
import { formatTime, shortPersonName } from '../lib/format.js';
import { useAuthStore } from '../auth-store.js';
import { useConversations } from './chat-queries.js';
import { formatDayLabel } from './message-groups.js';
import { ReadTicks } from './read-ticks.js';

/**
 * Pill просмотров СВОЕГО сообщения (#102 раунд 2 → раунд 4, вердикты владельца
 * по рефу Битрикс24): ПРИКРЕПЛЁН К НИЗУ ПУЗЫРЯ СВОЕГО ПОСЛЕДНЕГО СООБЩЕНИЯ —
 * flow-элемент СРАЗУ ПОСЛЕ его строки в ленте (НЕ после последнего сообщения
 * ленты: иначе квитанция висела под чужим пузырём и читалась как «автор в
 * просмотревших своё сообщение», вердикт раунда 4). Визуально — подвал пузыря:
 * зазор сверху ~5px (класс передаёт хост под свой ритм контейнера); прокрутка
 * вверх уводит метку с сообщением; сообщений мало — метка под пузырём, не у
 * низа экрана. Зазор ДО области ввода при прокрученном низе = верхний паддинг
 * формы композера (метка — нижняя граница прокрутки ленты: её низ на максимуме
 * скролла всегда равен низу ленты, gotchas «Фронтенд»); вердикт раунда 4 —
 * 1.5× зазора сверху (pt-1.5 формы).
 *
 * История: раунд 2 — flow-строка на всю ширину («толкает сообщения»);
 * раунд 3 — absolute-оверлей у низа экрана («ездит поверх всех чатов»);
 * раунд 4 — flow под своим пузырём (модель Битрикс24). Появление — fade
 * (views-pill, @starting-style; translate убран раундом 4: в flow выезд
 * читался как «лента оседает после открытия»). Имена — «Имя Фамилия» без
 * отчества (shortPersonName); подчёркнут только кликабельный «и ещё N».
 * Один компонент для трёх лент: беседа, тред, лента канала.
 */

/** Своё последнее живое сообщение в окне ленты (последнее по порядку). */
export function lastOwnMessage(
  messages: readonly ChatMessage[],
  meId: string | undefined,
): ChatMessage | null {
  return [...messages].reverse().find((m) => m.author.id === meId && !m.deletedAt) ?? null;
}

/** Зрители для метки, висящей ПОД последним сообщением ленты (модель
 *  Битрикс24, вердикт раунда 4): автор сообщения, под которым висит метка,
 *  NEVER показывается в её тексте — иначе квитанция своих просмотров
 *  читается как «автор прочитал своё же сообщение». Если после фильтра
 *  зрителей не осталось — метку не показываем вовсе. */
export function viewersForFeedTail(
  lastOwn: ChatMessage,
  lastInFeed: ChatMessage | undefined,
): UserRef[] {
  if (!lastInFeed || lastInFeed.id === lastOwn.id) return lastOwn.readBy;
  return lastOwn.readBy.filter((v) => v.id !== lastInFeed.author.id);
}

/** Попап посмотревших (вверх от якоря): аватарки + Имя Фамилия, скролл для
 *  длинных. #132 р.2: якорь — КНОПКА «ещё N» (левый край попапа = левый край
 *  слова), заголовка «Кто просмотрел» нет — список самодостаточен. */
export function ViewsPopup({
  anchor,
  viewers,
  onClose,
}: {
  anchor: HTMLElement | null;
  viewers: UserRef[];
  onClose: () => void;
}) {
  // virtualRef пересобирается под текущий якорь; anchor=null → закрыт.
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);
  return (
    <Popover
      open={anchor !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      {/* Автофокус контента НЕ отменяем (раунд 4): с preventDefault фокус
          оставался на кнопке pill — «вне оверлей-слоя» — и «вечный курсор»
          крал его в композер, а DismissableLayer закрывал попап по focus
          outside («мгновенно пропадает»). С автофокусом активный элемент —
          сам попап (role=dialog), гард кражи молчит. */}
      <PopoverContent side="top" align="start" alignOffset={0} sideOffset={8} className="w-64 p-0">
        <ViewsPopupBody viewers={viewers} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Резерв высоты метки (#132, фидбек пилотов): пока квитанции нет, невидимый
 * слот ТОЙ ЖЕ геометрии (структура/кегль метки, текст — неразрывный пробел,
 * чтобы держать строку) — появление/исчезновение «Просмотрено» не меняет
 * высоту ленты, стена чата неподвижна. Нет своих сообщений — резерва нет
 * (метка там невозможна).
 */
function ReservedViewsSlot({ className }: { className?: string }) {
  return (
    <div data-slot="views-reserved" aria-hidden className={cn('w-fit invisible', className)}>
      <div className="views-pill flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label">
        <ReadTicks read />
        <span>{'\u00A0'}</span>
      </div>
    </div>
  );
}

function ViewsPopupBody({ viewers }: { viewers: UserRef[] }) {
  return (
    <div data-slot="views-popup" className="flex flex-col">
      <div className="max-h-64 overflow-y-auto px-1.5 py-1.5">
        {viewers.map((viewer) => (
          <span key={viewer.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
            <PersonAvatar
              name={viewer.displayName}
              avatarUrl={viewer.avatarUrl}
              decorative
              className="size-6 shrink-0"
            />
            <span className="min-w-0 truncate text-sm">{shortPersonName(viewer.displayName)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Pill просмотров сообщения `message` (своего последнего): рендерить СРАЗУ
 * ПОСЛЕ строки этого сообщения в ленте. `className` — вертикальный ритм под
 * контейнер хоста (зазор сверху = 1.5× нижнего, #132 р.2: у gap-3 хостов
 * -mt-[3px] → 9px сверху против 6px pt-1.5 композера снизу). Последнее своё
 * ВНЕ окна ленты (глубокая история) — хост не рендерит pill вовсе.
 */
export function ConversationViewsLine({
  conversationId,
  messages,
  className,
}: {
  conversationId: string;
  /** Окно ленты хоста: метка рендерится ПОСЛЕДНИМ элементом ленты. */
  messages: readonly ChatMessage[];
  className?: string;
}) {
  const me = useAuthStore((s) => s.user);
  const { data } = useConversations();
  const conversation = data?.items.find((c) => c.id === conversationId) ?? null;
  const [popupAnchor, setPopupAnchor] = useState<HTMLElement | null>(null);
  /** Чем открыт попап (пачка C, вердикт 29.09): клик по ИМЕНИ — весь список
   *  просмотревших; клик по «ещё N» — ТОЛЬКО остальные (названный текстом
   *  сотрудник не дублируется ни счётчиком, ни списком). */
  const [popupMode, setPopupMode] = useState<'all' | 'rest'>('rest');
  const nameRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const lastOwn = lastOwnMessage(messages, me?.id);
  if (!conversation || !lastOwn) {
    return null;
  }
  // #132 р.2: якорь попапа — «ещё N» (левый край попапа = левый край слова);
  // одного зрителя — его имя.
  const openPopup = (mode: 'all' | 'rest') => {
    setPopupMode(mode);
    setPopupAnchor(mode === 'rest' ? (moreRef.current ?? nameRef.current) : nameRef.current);
  };

  // Direct (и «Заметки»): просмотры = факт собеседника; показываем ВРЕМЯ
  // первого просмотра, попапа нет (модель Telegram — просто галочки).
  if (conversation.type === 'direct') {
    if (lastOwn.readAt === null) return <ReservedViewsSlot className={className} />;
    const day = formatDayLabel(lastOwn.readAt);
    const humanDay = day.charAt(0).toLowerCase() + day.slice(1);
    return (
      <div className={cn('w-fit', className)}>
        <div className="views-pill flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-1 text-label text-muted-foreground shadow-none backdrop-blur-sm">
          <ReadTicks read />
          <span>
            {ui.chat.readByLabel}: {humanDay}, {formatTime(lastOwn.readAt)}
          </span>
        </div>
      </div>
    );
  }

  const viewers = viewersForFeedTail(lastOwn, messages[messages.length - 1]);
  if (viewers.length === 0) return <ReservedViewsSlot className={className} />;
  const first = viewers[0]!;
  const more = viewers.length - 1;

  return (
    <div className={cn('w-fit', className)}>
      <div className="views-pill flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-1 text-label text-muted-foreground shadow-none backdrop-blur-sm">
        <ReadTicks read />
        <span>{ui.chat.readByLabel}:</span>
        <button
          ref={nameRef}
          type="button"
          className="rounded-full hover:text-foreground"
          onClick={() => openPopup('all')}
        >
          {shortPersonName(first.displayName)}
        </button>
        {/* #132 р.2: союз «и» — обычный текст (I15: ключ andConjunction —
            замечание валидатора, не хардкод); подчёркнута и кликабельна
            только часть «ещё N» (как в Телеграме). Пачка C (вердикт 29.09):
            «ещё N» = ОСТАЛЬНЫЕ (N = all − названный) — названный сотрудник
            не дублируется ни счётчиком, ни попапом. */}
        {more > 0 ? (
          <>
            <span>{ui.chat.andConjunction}</span>
            <button
              ref={moreRef}
              type="button"
              className="rounded-full font-mono underline decoration-dotted underline-offset-2 tabular-nums hover:text-foreground"
              onClick={() => openPopup('rest')}
            >
              {ui.chat.andMore} {more}
            </button>
          </>
        ) : null}
      </div>
      <ViewsPopup
        anchor={popupAnchor}
        viewers={popupMode === 'rest' ? viewers.slice(1) : viewers}
        onClose={() => setPopupAnchor(null)}
      />
    </div>
  );
}
