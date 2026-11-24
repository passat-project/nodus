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
import type { SourceRect } from './slider-panel.js';
import { useCardStack, useOpenCard, useReplaceTopCard } from './use-card-stack.js';

/** Ширина полосы аватарок. Экспортируется для карточек-слайдеров: их правый
 *  край = правый край мягкой рамы = левый край полосы (единая геометрия шелла).
 *  Раскрытие полосы имён (40⇄192) убрано (вердикт владельца 16.11.2026);
 *  кнопка агента внизу полосы убрана (#1021, решение владельца 24.11.2026):
 *  вход в ассистента — кнопкой-роботом в топбаре, полоса — только список
 *  бесед до самого низа (служебный градиент-затухание над кнопкой убран
 *  вместе с ней). */
export const EDGE_W_COLLAPSED = uiPx(40);

/** Маркеры типа беседы на аватарках полосы УБРАНЫ (вердикт владельца
 *  15.09.2026: «закрывают почти 30 процентов аватарки»); тип читается
 *  названием и аватаркой, как в экспресс-панели Битрикс24. */
function ChatRailRow({
  conversation,
  meId,
  onOpen,
}: {
  conversation: ConversationListItem;
  meId: string | null | undefined;
  onOpen: (conversationId: string, sourceRect: SourceRect) => void;
}) {
  const notes = isNotesConversation(conversation, meId);
  const unread = conversation.unreadCount > 0 && !conversation.snoozed;

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
        {/* Непрочитанные — МАЛЕНЬКАЯ ЦИФРА в правом нижнем углу аватарки
            (вердикт владельца 15.09.2026: «жирные оранжевые точки не нравятся,
            в Битрикс — небольшие цифры»). */}
        {unread ? (
          <span
            aria-label={`${conversation.unreadCount} ${ui.chat.unreadHint}`}
            className="absolute -right-0.5 -bottom-0.5 min-w-[0.6875rem] rounded-full bg-destructive px-[0.125rem] text-center font-mono text-badge leading-[0.6875rem] font-medium text-destructive-foreground tabular-nums"
          >
            {conversation.unreadCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Служебная полоса = ЭКСПРЕСС-МЕССЕНДЖЕР (вердикт владельца 15.09.2026):
 * ВСЕ беседы мессенджера КРОМЕ чатов задач, порядок — как в списке мессенджера
 * (sortByActivity), непрочитанные — счётчиком на аватарке. Клик —
 * ПОЛНОЭКРАННАЯ карточка мессенджера поверх текущего стека (подменяет открытую).
 * На самом модуле мессенджер (/chat) полоса скрыта — правило `useRailHidden`.
 * Свой СКРЫТЫЙ скролл (data-no-scrollbar). Полоса живёт ЗА ПРЕДЕЛАМИ мягкой
 * рамы — в правом периметре, на его тоне и БЕЗ вертикальных границ.
 *
 * Кнопка агента внизу полосы УБРАНА (#1021, решение владельца 24.11.2026):
 * вход в окно ассистента — роботом в топбаре (или Ctrl+J).
 */
export function RightRail() {
  const { data } = useConversations();
  const me = useAuthStore((s) => s.user);
  const stack = useCardStack();
  const openCard = useOpenCard();
  const replaceTop = useReplaceTopCard();
  const hidden = useRailHidden();

  // Клик по беседе — ПОЛНОЭКРАННАЯ карточка мессенджера поверх текущего стека:
  // карточка мессенджера уже открыта — ПОДМЕНЯЕМ беседу без ремаунта панели.
  function showChat(conversationId: string, sourceRect: SourceRect) {
    const ref = { kind: 'messenger' as const, id: conversationId };
    const top = stack[stack.length - 1];
    if (top?.kind === 'messenger') replaceTop(ref);
    else openCard(ref, sourceRect);
  }

  // Экспресс-лента: все беседы КРОМЕ чатов задач; закреплённые сверху, затем
  // по активности (та же сортировка, что список мессенджера).
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
        // края периметра без скачка отступов (модуль мессенджер /chat).
        'relative mr-2 flex shrink-0 flex-col pt-2 transition-[width,opacity] duration-200 ease-out',
        hidden ? 'pointer-events-none w-0 overflow-hidden opacity-0' : 'w-10',
      )}
    >
      {/* Список бесед до самого низа: кнопки агента больше нет (#1021) —
          и служебного градиента-затухания над ней тоже (он существовал
          только ради мягкой посадки списка на кнопку). */}
      <div
        data-no-scrollbar
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-1 pb-1"
      >
        {chats.map((conversation) => (
          <ChatRailRow
            key={conversation.id}
            conversation={conversation}
            meId={me?.id}
            onOpen={showChat}
          />
        ))}
      </div>
    </aside>
  );
}
