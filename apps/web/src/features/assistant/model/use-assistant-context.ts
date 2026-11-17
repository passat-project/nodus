import { useRouterState } from '@tanstack/react-router';

import { navModuleForPath } from '../../../app/shell/nav-registry.js';
import { useCardStack } from '../../../app/shell/use-card-stack.js';

/** Контекст экрана, который уходит с вопросом на сервер (#895): раздел
 *  портала и открытая карточка. Сервер валидирует значения и подставляет в
 *  системный промпт — ассистент понимает «эта задача», «этот проект».
 *
 *  Никаких данных портала здесь нет: только идентификаторы (видимость и
 *  права проверяет API при вызове инструментов). */
export interface AssistantScreenContext {
  moduleId: string | null;
  cardKind: 'task' | 'project' | 'letter' | 'conversation' | null;
  cardId: string | null;
}

export function useAssistantContext(): AssistantScreenContext {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const stack = useCardStack();
  const top = stack.at(-1) ?? null;
  const module = navModuleForPath(pathname);
  const cardKind =
    top?.kind === 'messenger'
      ? 'conversation'
      : top?.kind === 'task' || top?.kind === 'project' || top?.kind === 'letter'
        ? top.kind
        : null;
  return {
    moduleId: module?.id ?? null,
    cardKind,
    cardId: cardKind && top ? top.id : null,
  };
}
