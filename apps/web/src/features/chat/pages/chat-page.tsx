import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';

import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { conversationTitle } from '../../../shared/chat/conversations.js';
import { useConversations } from '../api/chat-api.js';
import { MessengerBody, type ChatTab } from '../components/messenger-body.js';
import { setPortalTabTitle } from '../../../shared/lib/tab-bridge.js';

/**
 * Мессенджер — маршрутная обёртка над ЕДИНЫМ телом `MessengerBody` (то же
 * тело рендерит полноэкранная карточка `messenger:<id>` стека — план
 * `docs/mvp/archive/messenger-fullscreen-plan.md`, ноль дублей). Страница владеет
 * состоянием через маршрут: беседа — параметр `/chat/$conversationId`,
 * вкладки «Чаты» / «Чаты задач» / «Настройка» — в топбаре шелла по канону
 * каркаса (search `?tab=`), тред — search `?thread=` (deep-link).
 */
export function ChatPage() {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  const search = useSearch({ strict: false }) as { thread?: string; tab?: string };
  const tab: ChatTab =
    search.tab === 'tasks' ? 'tasks' : search.tab === 'settings' ? 'settings' : 'chats';
  const navigate = useNavigate();

  // Заголовок вкладки портала (#1038 фаза C): «Чат·Имя» — сессионный
  // кастом АКТИВНОЙ вкладки; deep-link беседа не в первой странице списка
  // находится лукапом MessengerBody и дописывается в тот же кэш — заголовок
  // догонит. Уход со страницы чата (cleanup) снимает заголовок: unmount
  // случается только при уходе с маршрута беседы, а активной тогда остаётся
  // вкладка этой беседы или вкладка БЕЗ заголовка (свой ставит лишь чат,
  // а его вкладка осталась бы смонтированной — unmount не случился бы).
  const { data: conversations } = useConversations();
  const meId = useAuthStore((s) => s.user?.id);
  const conversation = conversationId
    ? conversations?.items.find((c) => c.id === conversationId)
    : undefined;
  const tabTitle = conversation ? `Чат·${conversationTitle(conversation, meId)}` : undefined;
  useEffect(() => {
    if (!isDesktopShell()) return;
    setPortalTabTitle(tabTitle);
    return () => setPortalTabTitle(undefined);
  }, [tabTitle]);

  return (
    <MessengerBody
      tab={tab}
      conversationId={conversationId}
      onSelectConversation={(id) =>
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
          search: tab === 'chats' ? {} : { tab },
        })
      }
      // Внутренняя навигация мессенджера (вердикт 25.09): переход к беседе
      // источника пересылки с тредом — ОДИН navigate (последовательность
      // onSelect+openThread писала в params устаревший conversationId).
      onOpenConversation={(id, threadRootId) =>
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
          search: (prev) => ({ ...prev, thread: threadRootId ?? undefined }),
        })
      }
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
