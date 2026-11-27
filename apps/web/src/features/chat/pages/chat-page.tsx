import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';

import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { cachedConversation, useConversationById } from '../../../shared/chat/chat-queries.js';
import { conversationTitle } from '../../../shared/chat/conversations.js';
import {
  messengerTabForType,
  messengerTabSearch,
  resolveChatTab,
} from '../../../shared/chat/messenger-nav.js';
import { MessengerBody, type ChatTab } from '../components/messenger-body.js';
import { setPortalTabTitle } from '../../../shared/lib/tab-bridge.js';
import { ui } from '@nodus/contracts';

/** Search адреса беседы, выбранной из списка/поиска: тред прошлой беседы
 *  сбрасывается, вкладка — по типу НОВОЙ беседы (#1062); прочие параметры
 *  (стек карточек `?cards=`) сохраняются. Тип неизвестен — вкладку не трогаем. */
function selectSearch(
  prev: Record<string, unknown>,
  type: string | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (key === 'thread') continue;
    if (key === 'tab' && type) continue;
    next[key] = value;
  }
  if (type) Object.assign(next, messengerTabSearch(type));
  return next;
}

/** Search перехода к беседе внутренней навигацией (пересланное, цитата):
 *  вкладка по типу цели, тред цели; тип ещё не разрешён — `?tab=` снимается,
 *  и страница добавит его сама по разрешённой беседе (#1062). */
function targetSearch(
  prev: Record<string, unknown>,
  type: string | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (key === 'thread' || key === 'tab') continue;
    next[key] = value;
  }
  if (type) Object.assign(next, messengerTabSearch(type));
  return next;
}

/**
 * Мессенджер — маршрутная обёртка над ЕДИНЫМ телом `MessengerBody` (то же
 * тело рендерит полноэкранная карточка `messenger:<id>` стека — план
 * `docs/mvp/archive/messenger-fullscreen-plan.md`, ноль дублей). Страница владеет
 * состоянием через маршрут: беседа — параметр `/chat/$conversationId`,
 * вкладки «Чаты» / «Чаты задач» / «Настройка» — в топбаре шелла по канону
 * каркаса (search `?tab=`), тред — search `?thread=` (deep-link).
 *
 * Вкладка — по типу открытой беседы, когда `?tab=` не задан (#1062): прямо
 * ссылка/pопап оболочки на чат задачи открывают «Чаты задач и писем», а адрес
 * нормализуется (`replace`) — открытая беседа всегда в списке своей вкладки.
 */
export function ChatPage() {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  const search = useSearch({ strict: false }) as { thread?: string; tab?: string };
  const conversation = useConversationById(conversationId);
  const tab: ChatTab = resolveChatTab(search.tab, conversation?.type);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Нормализация адреса deep-link: `?tab=` не передан — вкладка следует типу
  // беседы, для чата задачи/письма адрес получает `?tab=tasks` (replace, без
  // новой записи истории). Явный/ручной `?tab=` не перебивается.
  useEffect(() => {
    if (!conversationId || search.tab !== undefined || !conversation) return;
    if (messengerTabForType(conversation.type) !== 'tasks') return;
    void navigate({
      to: '/chat/$conversationId',
      params: { conversationId },
      search: (prev) => ({ ...prev, tab: 'tasks' }),
      replace: true,
    });
  }, [conversation, conversationId, navigate, search.tab]);

  // Заголовок вкладки портала (#1038 фаза C): «Чат·Имя» — сессионный
  // кастом АКТИВНОЙ вкладки; deep-link беседа не в первой странице списка
  // находится лукапом `useConversationById` и дописывается в тот же кэш —
  // заголовок догонит. Уход со страницы чата (cleanup) снимает заголовок:
  // unmount случается только при уходе с маршрута беседы, а активной тогда
  // остаётся вкладка этой беседы или вкладка БЕЗ заголовка (свой ставит лишь
  // чат, а его вкладка осталась бы смонтированной — unmount не случился бы).
  const meId = useAuthStore((s) => s.user?.id);
  const tabTitle = conversation
    ? ui.desktop.chatTabTitle.replace('{name}', conversationTitle(conversation, meId))
    : undefined;
  useEffect(() => {
    if (!isDesktopShell()) return;
    setPortalTabTitle(tabTitle);
    return () => setPortalTabTitle(undefined);
  }, [tabTitle]);

  return (
    <MessengerBody
      tab={tab}
      conversationId={conversationId}
      onSelectConversation={(id, type) => {
        const resolved = type ?? cachedConversation(queryClient, id)?.type;
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
          search: (prev) => selectSearch(prev as Record<string, unknown>, resolved),
        });
      }}
      // Внутренняя навигация мессенджера (вердикт 25.09): переход к беседе
      // источника пересылки с тредом — ОДИН navigate (последовательность
      // onSelect+openThread писала в params устаревший conversationId).
      // Вкладка целевой беседы (#1062): тип из кэша, иначе её выведет эффект
      // нормализации страницы после разрешения.
      onOpenConversation={(id, threadRootId) => {
        const type = cachedConversation(queryClient, id)?.type;
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
          search: (prev) => ({
            ...targetSearch(prev as Record<string, unknown>, type),
            thread: threadRootId ?? undefined,
          }),
        });
      }}
      threadRootId={search.thread ?? null}
      onOpenThread={(rootId) =>
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: conversationId ?? '' },
          // Функциональная форма: посторонние search-параметры
          // (стек карточек ?cards=) СОХРАНЯЮТСЯ — закрытие треда
          // не размонтирует карточку поверх (вердикт валидатора
          // #42: navigate c объектом затирает search целиком).
          search: (prev) => ({ ...prev, thread: rootId }),
        })
      }
      onCloseThread={() =>
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: conversationId ?? '' },
          search: (prev) => ({ ...prev, thread: undefined }),
        })
      }
    />
  );
}
