import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useConversations } from '../../features/chat/api/chat-api.js';
import {
  conversationTitle,
  isNotesConversation,
  sortByActivity,
} from '../../features/chat/lib/conversations.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { conversationAvatarUrl } from '../../shared/chat/conversations.js';
import { NotesGlyph } from '../../shared/ui/notes-glyph.js';
import { PersonAvatar } from '../../shared/ui/person-avatar.js';
import { uiPx } from '../../shared/ui/ui-scale.js';
import { useRailHidden } from './rail-visibility.js';
import { useShellStore } from './shell-store.js';
import type { SourceRect } from './slider-panel.js';
import { useCardStack, useOpenCard, useReplaceTopCard } from './use-card-stack.js';

/** Ширина полосы: свёрнутая / раскрытая.
 *  Экспортируется для карточек-слайдеров: их правый край = правый край
 *  мягкой рамы = левый край полосы (единая геометрия шелла). */
export const EDGE_W_COLLAPSED = uiPx(40);
/** Ширина развёрнутой рейки — по замеру Битрикс24 (ambient-проба владельца
 *  21.09.2026: nav главного меню = 240px). */
export const EDGE_W_EXPANDED = uiPx(192);
/** На сколько СУЖАЕТСЯ карточка раскрытием полосы: ровно столько чат
 *  карточки отдаёт шириной (канон «чат — буфер сужений», левая зона стоит). */
export const EDGE_W_DELTA = EDGE_W_EXPANDED - EDGE_W_COLLAPSED;

/** Стоящее сужение карточки раскрытой полосой: столько px колонка
 *  обсуждения карточки отдаёт шириной при раскрытии рельсы (канон «чат —
 *  буфер сужений», issue #63: левая зона карточки стоит, ест только после
 *  упора чата в пол). 0 при скрытой полосе (/chat — карточка там шире на
 *  свёрнутую полосу, сужать нечего) — та же логика stripW в SliderPanel. */
export function useRailShrink(): number {
  const edgeOpen = useShellStore((s) => s.edgeOpen);
  const railHidden = useRailHidden();
  return edgeOpen && !railHidden ? EDGE_W_DELTA : 0;
}

/** Маркеры типа беседы на аватарках полосы УБРАНЫ (вердикт владельца
 *  15.09.2026: «закрывают почти 30 процентов аватарки»); тип читается
 *  названием и аватаркой, как в экспресс-панели Битрикс24. */
function ChatRailRow({
  conversation,
  meId,
  expanded,
  onOpen,
}: {
  conversation: ConversationListItem;
  meId: string | null | undefined;
  expanded: boolean;
  onOpen: (conversationId: string, sourceRect: SourceRect) => void;
}) {
  const notes = isNotesConversation(conversation, meId);
  const unread = conversation.unreadCount > 0 && !conversation.snoozed;

  // Tooltip — ТОЛЬКО если название не влезло в строку (вердикт владельца
  // 15.09.2026): title ставится на наведении по факту обрезки scrollWidth.
  function clippedTitle(event: React.MouseEvent<HTMLSpanElement>) {
    const el = event.currentTarget;
    el.title = el.scrollWidth > el.clientWidth ? (el.textContent ?? '') : '';
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(conversation.id, event.currentTarget.getBoundingClientRect())}
      // Подсказка на всей строке (#728): в свёрнутой полосе названия не видно,
      // и владелец просил, чтобы при наведении читались имя и фамилия.
      title={conversationTitle(conversation, meId)}
      className="flex w-full shrink-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
    >
      <span className="relative shrink-0">
        {notes ? (
          <NotesGlyph className="size-7" />
        ) : (
          <PersonAvatar
            name={conversationTitle(conversation, meId)}
            avatarUrl={conversationAvatarUrl(conversation, meId)}
            className="size-7"
            // Подсказку уже несёт строка — второй title на аватарке не нужен.
            title=""
          />
        )}
        {/* Непрочитанные — МАЛЕНЬКАЯ ЦИФРА в правом нижнем углу аватарки в
            ОБЕИХ состояниях полосы (вердикт владельца 15.09.2026: «жирные
            оранжевые точки не нравятся, в Битрикс — небольшие цифры»; при
            раскрытии счётчик НЕ уезжает в квадратик справа от названия —
            остаётся на аватарке, как в свёрнутой). */}
        {unread ? (
          <span
            aria-label={`${conversation.unreadCount} ${ui.chat.unreadHint}`}
            className="absolute -right-0.5 -bottom-0.5 min-w-[0.6875rem] rounded-full bg-destructive px-[0.125rem] text-center font-mono text-badge leading-[0.6875rem] font-medium text-destructive-foreground tabular-nums"
          >
            {conversation.unreadCount}
          </span>
        ) : null}
      </span>
      {/* Название — кросс-фейд max-width/opacity, как строки рейки: рефлоу
          ширины полосы идёт без рывков и обрезания текста на полуслове.
          text-label 13px — плотная метка (типографика #60). */}
      <span
        onMouseEnter={clippedTitle}
        className={cn(
          'overflow-hidden truncate whitespace-nowrap text-label text-foreground',
          'transition-[max-width,opacity] duration-200 ease-out',
          expanded ? 'max-w-44 opacity-100' : 'max-w-0 opacity-0',
        )}
      >
        {conversationTitle(conversation, meId)}
      </span>
    </button>
  );
}

/**
 * Служебная полоса = ЭКСПРЕСС-МЕССЕНДЖЕР (вердикт владельца 15.09.2026:
 * «правая панель — все чаты портала, компактный мессенджер, чтобы открывать
 * любые последние чаты поверх окон», модель правой панели Битрикс24): ВСЕ
 * беседы мессенджера КРОМЕ чатов задач (их будут тысячи), порядок — как в
 * списке мессенджера (sortByActivity: закреплённые сверху, затем по
 * активности), непрочитанные — счётчиком на аватарке. Клик — ПОЛНОЭКРАННАЯ
 * карточка мессенджера (`messenger:<id>`, план messenger-fullscreen, модель
 * Битрикс24) поверх текущего стека: открытую мессенджер-карточку ПОДМЕНЯЕТ
 * (стек не растёт); пока она вершина — полоса НАКРЫТА карточкой (inset-2:
 * дубль списка невидим и недоступен; скрывать полосу шеллом нельзя — карточки
 * под верхней поехали бы на 40px во время раскрытия, баг-вердикт владельца
 * 15.09.2026); на самом модуле мессенджер (/chat) полоса скрыта — правило
 * `useRailHidden`. Свой СКРЫТЫЙ скролл (data-no-scrollbar, как в Битрикс: скроллбар
 * мини-панели не показывается). Профиль — в топбаре мягкой рамы справа от
 * уведомлений (ProfileMenu, вердикт 15.09.2026). Полоса живёт ЗА ПРЕДЕЛАМИ
 * мягкой рамы — в правом периметре, на его тоне и БЕЗ вертикальных границ
 * (план R3/R4). Раскрытие — КНОПКОЙ-шевронами внизу (без авто-раскрытия по
 * наведению; персистится в nodus-shell-v1): РЕФЛОУ 40 ⇄ 192 дизайн-px (240
 * при масштабе 1.25), мягкая рама сужается влево синхронно; карточки держат
 * правый край по раме (slider-panel), сузившуюся ширину отдавая ЧАТОМ (канон
 * «чат — буфер сужений»); контур под карточкой спит (circuit-frame).
 */
export function RightRail() {
  const { data } = useConversations();
  const me = useAuthStore((s) => s.user);
  const edgeOpen = useShellStore((s) => s.edgeOpen);
  const setEdgeOpen = useShellStore((s) => s.setEdgeOpen);
  const stack = useCardStack();
  const openCard = useOpenCard();
  const replaceTop = useReplaceTopCard();
  const hidden = useRailHidden();

  // Клик по беседе — ПОЛНОЭКРАННАЯ карточка мессенджера поверх текущего стека
  // (план messenger-fullscreen, модель Битрикс24): карточка мессенджера уже
  // открыта — ПОДМЕНЯЕМ беседу без ремаунта панели (стек не растёт), иначе
  // кладём поверх (раскрытие из rect аватарки — shared-element).
  function showChat(conversationId: string, sourceRect: SourceRect) {
    const ref = { kind: 'messenger' as const, id: conversationId };
    const top = stack[stack.length - 1];
    if (top?.kind === 'messenger') replaceTop(ref);
    else openCard(ref, sourceRect);
  }

  // Экспресс-лента: все беседы КРОМЕ чатов задач; закреплённые сверху, затем
  // по активности (та же сортировка, что список мессенджера). Подъём с
  // черновиком — ТОЛЬКО от серверного draft (вердикт 25.09: во время набора
  // ничего не меняется — клиентский черновик уходит на сервер только на уходе
  // из беседы).
  const railChats = (data?.items ?? []).filter((c) => c.type !== 'task' && c.type !== 'letter');
  const chats = sortByActivity(railChats, (id) =>
    railChats.some((c) => c.id === id && c.draft?.text),
  );

  return (
    <aside
      aria-hidden={hidden || undefined}
      className={cn(
        // mr-2 — щель периметра справа от полосы (8px до края вьюпорта); при
        // скрытии колонка ужимается в w-0, щель остаётся — рама расширяется до
        // края периметра без скачка отступов (модуль мессенджер / фулскрин-
        // карточка мессенджера — useRailHidden, план messenger-fullscreen).
        'relative mr-2 flex shrink-0 flex-col pt-2 transition-[width,opacity] duration-200 ease-out',
        hidden ? 'pointer-events-none w-0 overflow-hidden opacity-0' : edgeOpen ? 'w-48' : 'w-10',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          data-no-scrollbar
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-1 pb-1"
        >
          {chats.map((conversation) => (
            <ChatRailRow
              key={conversation.id}
              conversation={conversation}
              meId={me?.id}
              expanded={edgeOpen}
              onOpen={showChat}
            />
          ))}
        </div>
      </div>
      {/* Кнопка раскрытия/сворачивания — ВНИЗУ полосы, шевронами, как у левой
          рейки (вердикт владельца 2026-09-14: пользователь сам выбирает режим;
          зеркально рейке: раскрытие растёт ВЛЕВО — ChevronsLeft). */}
      <div className="shrink-0 p-1">
        <button
          type="button"
          onClick={() => setEdgeOpen(!edgeOpen)}
          aria-label={edgeOpen ? ui.edge.collapse : ui.edge.expand}
          className="flex h-8 w-full items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground"
        >
          {edgeOpen ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
