import { BellOff, Clock, Pin } from 'lucide-react';
import { Fragment, useRef } from 'react';
import type { ConversationListItem } from '@nodus/contracts';
import { stripMentionTokens, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../../../shared/auth-store.js';
import { formatListTimestamp, withoutPatronymic } from '../../../shared/lib/format.js';
import { ConversationAvatar } from '../../../shared/chat/conversation-avatar.js';
import { ReadTicks } from '../../../shared/chat/read-ticks.js';
import { useTypingStore } from '../../../shared/socket/typing-store.js';
import { useInfiniteSentinel } from '../../../shared/views/use-infinite-sentinel.js';
import { conversationTitle, isNotesConversation, sortByActivity } from '../lib/conversations.js';
import { ConversationMenu } from './conversation-menu.js';

/**
 * Список бесед мессенджера (механика Телеграма, грамматика «Инструмента»):
 * ЕДИНЫЙ список по активности, БЕЗ секций-заголовков (вердикт владельца
 * 2026-09-10, раунд 2: чаты перемешиваются по свежести) — тип строки читается
 * маркером на аватаре; непрочитанные — чип danger, время и превью —
 * моно/усечённые. Активная беседа — плоская заливка (без теней).
 * Превью строки (#87): «печатает…» (эфемерно, Telegram-модель) → черновик
 * важнее последнего сообщения (модель Telegram/Slack «Черновик: …»),
 * надгробие — «Сообщение удалено».
 * Закреплённые беседы (#96, вердикт владельца 24.09.2026, реф Битрикс24) —
 * ведущая группа сверху, обрамлённая hairline-рамкой со скруглением
 * (без заголовка-секции и без заливки).
 */

/** Превью последней строки беседы. Черновик вместо превью последнего
 *  сообщения (реф Telegram/Bitrix24, #91): КРАСНЫМ — только слово «Черновик»,
 *  сам текст обычным цветом превью (вердикт 25.09, модель Telegram).
 *  Источник — ТОЛЬКО серверный draft беседы (вердикт 25.09: во время набора
 *  в списке ничего не меняется; метка появляется после ухода из чата).
 *  «Печатает…» (#104 раунд 2, модель Telegram: и в шапке, и в списке) —
 *  ВЫШЕ превью и черновика на время TTL; direct — «печатает…», группы/
 *  каналы — «Имя печатает…»; своя печать не показывается. */
function RowPreview({ conversation }: { conversation: ConversationListItem }) {
  const meId = useAuthStore((s) => s.user?.id);
  const typing = useTypingStore((s) => s.entries[conversation.id] ?? null);
  const typingAlive = typing !== null && typing.expiresAt > Date.now() && typing.userId !== meId;
  if (typingAlive) {
    const name = conversation.membersPreview.find((m) => m.id === typing.userId)?.displayName;
    const label =
      conversation.type === 'direct' || !name
        ? ui.chat.typing
        : `${withoutPatronymic(name)} ${ui.chat.typing}`;
    return <span className="truncate text-xs italic text-info">{label}</span>;
  }
  const preview = conversation.draft?.text || '';
  if (preview) {
    return (
      <span className="truncate text-xs">
        <span className="font-medium text-destructive">{ui.chat.draftLabel}:</span>{' '}
        {stripMentionTokens(preview)}
      </span>
    );
  }
  const last = conversation.lastMessage;
  const text = last
    ? last.deletedAt
      ? ui.chat.deletedPlaceholder
      : // Превью списка — однострочный truncate: упоминание отображаемым
        // текстом (канон Telegram), чипы только в ленте.
        stripMentionTokens(last.text) ||
        (last.attachments[0]?.kind === 'image'
          ? ui.chat.quotePhoto
          : last.attachments[0]?.kind === 'sticker'
            ? ui.chat.stickerPreview
            : last.attachments[0]
              ? ui.chat.quoteFile
              : '')
    : '';
  return <span className="truncate text-xs text-muted-foreground">{text}</span>;
}
export function ConversationList({
  conversations,
  isLoading,
  activeId,
  emptyLabel,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  conversations: ConversationListItem[];
  isLoading: boolean;
  activeId?: string;
  /** Текст пустой вкладки (напр. «Нет активных обсуждений задач»). */
  emptyLabel?: string;
  onSelect: (conversation: ConversationListItem) => void;
  /** Курсорная подгрузка вкладки (#252): sentinel у дна списка. */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useInfiniteSentinel(scrollRef, sentinelRef, { hasNextPage, isFetchingNextPage, onLoadMore });
  // Подъём беседы с черновиком (сортировка) — ТОЛЬКО от серверного draft
  // (вердикт 25.09: во время набора список живёт своей жизнью; беседа
  // поднимается после ухода из чата, когда черновик зафиксирован сервером).
  const hasDraft = (conversationId: string) =>
    conversations.some((c) => c.id === conversationId && c.draft?.text);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const sorted = sortByActivity(conversations, hasDraft);
  if (sorted.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-3">
        <Empty>
          <EmptyTitle>{emptyLabel}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  // Рамка закреплённых ЧАТОВ (#96, вердикт владельца 24.09.2026, реф
  // Битрикс24): закреплённые идут ВЕДУЩЕЙ группой (sortByActivity: pinned —
  // первыми), и именно эта группа обрамляется hairline-рамкой (без заливки).
  // Механика и сортировка закрепов не меняются — группировка ЧИСТО визуальная;
  // нет закреплённых — нет и рамки. Это НЕ пин-бар сообщений (pin-bar.tsx):
  // закреплённые сообщения живут отдельным механизмом и здесь не участвуют.
  let pinnedCount = 0;
  while (pinnedCount < sorted.length && sorted[pinnedCount]?.pinned) pinnedCount += 1;
  const pinnedRows = sorted.slice(0, pinnedCount);

  function renderRow(conversation: ConversationListItem, inPinnedArea = false) {
    const active = conversation.id === activeId;
    const last = conversation.lastMessage;
    // Галки «отправлено/прочитано» (#799, модель Telegram): только у СВОЕГО
    // последнего сообщения. Чужое последнее, удалённое, «Заметки» (собеседник
    // я сам) и черновик — без галок; «печатает…» галки не гасит (они про
    // последнее сообщение, а не про превью).
    const showTicks =
      last !== null &&
      meId !== undefined &&
      last.author.id === meId &&
      last.deletedAt === null &&
      !conversation.draft?.text &&
      !isNotesConversation(conversation, meId);
    return (
      <ConversationMenu key={conversation.id} conversation={conversation}>
        <button
          type="button"
          data-row
          onClick={() => onSelect(conversation)}
          aria-current={active}
          className={cn(
            // МЯГКИЙ ховер у ВСЕХ строк (вердикт владельца 24.09.2026: подсветка
            // не должна быть прямоугольной).
            // ГЕОМЕТРИЯ подсветки (вердикт владельца 24.09.2026): у закреплённых
            // ховер = РОВНО внутренняя область рамки (без внутренних зазоров),
            // у остальных — с тем же боковым зазором 5px (mx-1), что и у рамки:
            // все подсветки списка стоят на одной вертикали. Ритм текста единый
            // (mx + border + px = 1rem обычной строки px-4): аватары и время
            // вне рамки и внутри — на одной вертикали на любом шаге --ui-scale.
            'flex items-center gap-3 rounded-lg py-2.5 text-left transition-colors hover:bg-accent/40',
            inPinnedArea
              ? 'w-full rounded-[calc(var(--radius-xl)-1px)] px-[calc(0.75rem-1px)]'
              : // Ширина = 100% минус боковые поля 5px: кнопка — inline-level
                // элемент (w-auto сжимается по контенту — баг-вердикт владельца
                // 24.09), а w-full поверх полей давал «100% + поля» и
                // горизонтальное переполнение списка.
                'mx-1 w-[calc(100%-0.5rem)] px-3',
            active && 'bg-accent/60 hover:bg-accent/60',
          )}
        >
          <ConversationAvatar conversation={conversation} meId={meId} className="size-9" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm font-medium">
                  {conversationTitle(conversation, meId)}
                </span>
                {/* Состояния из ПКМ-меню (реф Битрикс24): закреп, без
                      звука, «посмотреть позже». */}
                {conversation.pinned ? (
                  <Pin
                    aria-label={ui.chat.convMenuPin}
                    className="size-3 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : null}
                {conversation.muted ? (
                  <BellOff
                    aria-label={ui.chat.convMenuMute}
                    className="size-3 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : null}
                {conversation.snoozed ? (
                  <Clock
                    aria-label={ui.chat.convMenuViewLater}
                    className="size-3 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : null}
              </span>
              {last ? (
                // Метка давности по модели Битрикс24 (#782): сегодня — время,
                // вчера — «Вчера», 2–6 дней — день недели, дальше — дата.
                // Время — первый flex-элемент: базовая линия группы совпадает
                // с временем (родительская строка — items-baseline), а галки
                // визуально стоят СЛЕВА от времени (flex-row-reverse) в его тон.
                // ИНВАРИАНТ ГЕОМЕТРИИ (#799, замерено на :4173): время прижато
                // к правому краю группы, галки наращивают её ЛЕВУЮ границу —
                // правый край времени стоит на одной вертикали у всех строк и
                // НЕ двигается при появлении второй галки (ширина svg постоянна),
                // поэтому WS-квитанция не дёргает строку. Не переставлять
                // галки ПОСЛЕ времени и не менять ширину ReadTicks.
                <span className="flex shrink-0 flex-row-reverse items-center gap-1 text-muted-foreground">
                  <span className="whitespace-nowrap font-mono text-label-sm tabular-nums">
                    {formatListTimestamp(last.createdAt)}
                  </span>
                  {showTicks ? <ReadTicks read={read} /> : null}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <RowPreview conversation={conversation} />
              {/* «Посмотреть позже» прячет счётчик до нового сообщения. */}
              {conversation.unreadCount > 0 && !conversation.snoozed ? (
                <NodeChip tone="danger" className="shrink-0">
                  {conversation.unreadCount}
                </NodeChip>
              ) : null}
            </span>
          </span>
        </button>
      </ConversationMenu>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      data-no-scrollbar
    >
      {/* overflow-x-hidden: горизонтального скролла в списке быть не должно
          (вертикальный скроллер по CSS Overflow вычисляет вторую ось в auto —
          gotchas); источник переполнения убран (строки без w-full поверх
          полей), скрытие — страховка. */}
      {/* Область закреплённых (вердикт владельца 24.09.2026, реф Битрикс24):
          ТОЛЬКО РАМКА — hairline-граница со скруглением (заливки нет) — вокруг
          ведущей группы закреплённых строк; рамка смещена от наружных границ
          списка ОДИНАКОВО (mx-1 и mt-1 = 5px со всех сторон, вердикт владельца:
          «зазоры сверху такие же, как слева и справа»). Паддинга у рамки НЕТ:
          ховер строки занимает ровно её внутреннюю область (вердикт: «без
          внутренних зазоров при выделении»), скругление строки = внутренний
          радиус рамки. Строки внутри — на общем ритме текста списка, с мягким
          ховером и СЕПАРАТОРАМИ между строками, как в остальном списке. */}
      {pinnedRows.length > 0 ? (
        <div
          data-slot="pinned-chats"
          className="mx-1 mt-1 mb-2 flex flex-col rounded-xl border border-border"
        >
          {pinnedRows.map((conversation, index) => (
            <Fragment key={conversation.id}>
              {index > 0 ? (
                <div
                  aria-hidden
                  data-sep
                  className="mx-[calc(0.75rem-1px)] border-t border-border/60"
                />
              ) : null}
              {renderRow(conversation, true)}
            </Fragment>
          ))}
        </div>
      ) : null}
      {/* Сепараторы между строками (реф Битрикс24, вердикт владельца
          24.09.2026): hairline НЕ на всю ширину колонки — по бокам отступ
          mx-4 (по началу текста строк), поэтому линии читаются разделителями
          строк, а не границами колонки. При ховере строки СОСЕДНИЕ сепараторы
          исчезают (data-row/data-sep + globals.css: подсветка «поглощает»
          разделитель, как в Битриксе). */}
      {sorted.slice(pinnedCount).map((conversation, index) => (
        <Fragment key={conversation.id}>
          {index > 0 ? (
            <div aria-hidden data-sep className="mx-4 border-t border-border/60" />
          ) : null}
          {renderRow(conversation)}
        </Fragment>
      ))}
      {hasNextPage ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
    </div>
  );
}
