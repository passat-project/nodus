import { useRouterState } from '@tanstack/react-router';

import { navModuleForPath } from '../../../app/shell/nav-registry.js';
import { useCardStack } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useConversations } from '../../../shared/chat/chat-queries.js';
import { useAssistantTasks } from './assistant-queries.js';
import type { AssistantContext } from './mock-engine.js';

/** Контекст ассистента из живых query-хуков портала (монтируется только в
 *  теле панели после первого открытия — закрытая панель не шлёт запросов). */
export function useAssistantContext(): AssistantContext {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const stack = useCardStack();
  const top = stack[stack.length - 1] ?? null;
  const { data: tasksData } = useAssistantTasks();
  const { data: convData } = useConversations();
  const me = useAuthStore((s) => s.user);

  const tasks = tasksData?.items ?? [];
  const cardTask = top?.kind === 'task' ? (tasks.find((t) => t.id === top.id) ?? null) : null;

  return {
    moduleLabel: navModuleForPath(pathname)?.label ?? null,
    cardKind: top?.kind ?? null,
    cardTask,
    tasks,
    conversations: convData?.items ?? [],
    meId: me?.id,
  };
}
