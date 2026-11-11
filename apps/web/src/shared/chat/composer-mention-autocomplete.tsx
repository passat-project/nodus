import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Paginated, UserListItem, UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Users } from 'lucide-react';
import { cn } from '@nodus/ui/lib/utils';

import { api } from '../api-client.js';
import { usersKeys } from '../api/users-list.js';
import { useAuthStore } from '../auth-store.js';
import { PersonAvatar } from '../ui/person-avatar.js';

import {
  detectMentionQuery,
  mergeMentionCandidates,
  type MentionCandidate,
} from './composer-mentions.js';
import { useConversationMembers } from './manage-api.js';

/**
 * Автокомплит @упоминаний композера (#176): «@» на границе слова открывает
 * панель над строкой ввода; участники беседы — первыми, живой поиск по
 * справочнику (серверный, паттерн окна участников #186) — остальными с
 * пометкой «не в беседе». Клавиатура ↑↓ (с заворотом) / Enter / Tab — выбор,
 * Esc — закрыть без потери текста; каретка не покидает textarea (панель —
 * не оверлей-слой, «вечный курсор» живёт в поле).
 */

/** Состояние автокомплита: запрос у каретки + кандидаты + активный ряд. */
export function useMentionAutocomplete(
  conversationId: string | undefined,
  text: string,
  caret: number,
) {
  const meId = useAuthStore((s) => s.user?.id);
  const query = useMemo(() => detectMentionQuery(text, caret), [text, caret]);
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const queryText = query?.query ?? '';
  useEffect(() => {
    setActive(0);
    const timer = window.setTimeout(() => setDebounced(queryText), 250);
    return () => window.clearTimeout(timer);
  }, [queryText]);

  // Состав беседы — лениво: только когда панель реально открыта (не каждым
  // монтированием композера; «@» — первый триггер).
  const members = useConversationMembers(conversationId ?? '', '', {
    enabled: query !== null,
  });
  const memberRefs = useMemo<UserRef[]>(
    () => (members.data?.pages[0]?.items ?? []).map((m) => m.user),
    [members.data],
  );
  const directory = useQuery({
    queryKey: usersKeys.search('mention-autocomplete', debounced),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '20' });
      if (debounced) params.set('search', debounced);
      return api<Paginated<UserListItem>>(`/directory/users?${params}`);
    },
    // Пустой запрос — панель показывает участников, справочник не нужен.
    enabled: query !== null && debounced.length > 0,
  });

  const candidates = useMemo<MentionCandidate[]>(
    () => mergeMentionCandidates(memberRefs, directory.data?.items ?? [], queryText, meId),
    [memberRefs, directory.data, queryText, meId],
  );

  return { query, candidates, active, setActive };
}

/** Полное упоминание-состояние поля ввода (#176): каретка поля, dismissed-@,
 *  вставка токена, обработчик клавиш. Используется композером (реестр
 *  стора черновиков) и окном вложений (#239 — локальный реестр подписи);
 *  insertMention пишет текст+реестр ХОСТА и возвращает новую каретку. */
export function useComposerMentions(opts: {
  conversationId: string | undefined;
  text: string;
  /** Вставка чипа хостом: (start, end, id, label) → новая каретка | null. */
  insertMention: (atStart: number, atEnd: number, id: string, label: string) => number | null;
  inputRef: { current: HTMLTextAreaElement | null };
}) {
  const [caret, setCaret] = useState(0);
  // dismissed-старт «@»: Esc закрыл панель — она не откроется снова, пока
  // пользователь не начнёт ДРУГОЙ «@» (иной start). state, не ref: Esc
  // обязан закрыть панель немедленно (рендер), а не ждать чужого обновления.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const autocomplete = useMentionAutocomplete(opts.conversationId, opts.text, caret);
  const open = autocomplete.query !== null && autocomplete.query.start !== dismissedStart;

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? 0);

  function pick(index: number) {
    const query = autocomplete.query;
    const candidate = autocomplete.candidates[index];
    if (!query || !candidate) return;
    // Вставка ЧИПА через реестр хоста (#228): в поле ложится видимое
    // ИМЯ + пробел (без «@»); каретка — НАСТОЯЩАЯ позиция за пробелом.
    const caretAt = opts.insertMention(query.start, query.end, candidate.id, candidate.displayName);
    if (caretAt === null) return;
    requestAnimationFrame(() => {
      const el = opts.inputRef.current;
      if (el) {
        el.setSelectionRange(caretAt, caretAt);
        setCaret(caretAt);
      }
    });
  }

  function dismiss() {
    setDismissedStart(autocomplete.query?.start ?? null);
  }

  /** KeyUp поля: синк каретки (источник запроса автокомплита). Стрелки
   *  нативны — в поле видимый текст, скрытой разметки нет (#228). */
  function handleKeyUp(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? 0);
  }

  return { autocomplete, open, caret, syncCaret, pick, dismiss, handleKeyUp };
}

/** Обработка клавиш панели: возвращает true, если событие съедено (композер
 *  не должен реагировать — Enter НЕ отправляет, ↑ НЕ правит последнее). */
export function mentionAutocompleteKeydown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  state: { open: boolean; count: number; active: number; setActive: (i: number) => void },
  onPick: (index: number) => void,
  onClose: () => void,
): boolean {
  if (!state.open) return false;
  const last = state.count - 1;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      state.setActive(state.active >= last ? 0 : state.active + 1);
      return true;
    case 'ArrowUp':
      event.preventDefault();
      state.setActive(state.active <= 0 ? last : state.active - 1);
      return true;
    case 'Enter':
    case 'Tab':
      if (state.count > 0) {
        event.preventDefault();
        onPick(state.active);
      }
      return true;
    case 'Escape':
      event.preventDefault();
      onClose();
      return true;
    default:
      return false;
  }
}

/** Панель-список кандидатов: absolute над строкой ввода, НЕ перехватывает
 *  фокус (клики по строкам — mousedown с preventDefault, каретка в поле). */
export function MentionAutocompletePanel({
  candidates,
  active,
  onHover,
  onPick,
}: {
  candidates: MentionCandidate[];
  active: number;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}) {
  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 z-20 mb-1.5 w-full max-w-105 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-sm"
    >
      {candidates.length === 0 ? (
        <span className="block px-3 py-2 text-sm text-muted-foreground">
          {ui.chat.mentionAutocompleteEmpty}
        </span>
      ) : (
        candidates.map((candidate, i) => (
          <span
            key={candidate.id}
            role="option"
            aria-selected={i === active}
            className={cn(
              'flex h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2.5',
              i === active && 'bg-accent',
            )}
            onMouseDown={(e) => {
              e.preventDefault(); // каретка остаётся в textarea
              onPick(i);
            }}
            onMouseMove={() => onHover(i)}
          >
            {candidate.isAll ? (
              // «Все» (#224): иконка группы вместо аватара человека.
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Users className="size-4 text-foreground" strokeWidth={1.75} />
              </span>
            ) : (
              <PersonAvatar
                name={candidate.displayName}
                avatarUrl={candidate.avatarUrl}
                decorative
                className="size-7 shrink-0"
                fallbackClass="text-[10px]"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {candidate.displayName}
            </span>
            {candidate.inConversation ? null : (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {ui.chat.mentionNotInConversation}
              </span>
            )}
            {candidate.positionName ? (
              <span className="max-w-50 shrink-0 truncate text-xs text-muted-foreground">
                {candidate.positionName}
              </span>
            ) : null}
          </span>
        ))
      )}
    </div>
  );
}
