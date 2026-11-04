import { useCallback, useState } from 'react';

import { useReplaceTopCard } from '../../../app/shell/use-card-stack.js';

/**
 * Сессия навигации «ёлочки» карточки письма (#461, В1/В6): панель
 * монтируется раз и живёт при переходах (состояние раскрытий и история не
 * теряются); корень — СТАРТОВОЕ письмо карточки (карта дерева стабильна),
 * переходы — заменой верхней карточки стека (ADR-0009: стек не растёт,
 * один Escape закрывает всё).
 */
export function useLetterBranch(letterId: string) {
  const replaceTopCard = useReplaceTopCard();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rootId] = useState(letterId);
  const [history, setHistory] = useState<string[]>([]);

  const navigate = useCallback(
    (id: string) => {
      if (id === letterId) return;
      setHistory((prev) => [...prev, letterId]);
      setMounted(true);
      setOpen(true);
      replaceTopCard({ kind: 'letter', id });
    },
    [letterId, replaceTopCard],
  );

  // Переход — вне updater'а состояния: updater обязан быть чистым (StrictMode
  // зовёт его дважды — двойная замена карточки).
  const back = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    replaceTopCard({ kind: 'letter', id: previous });
  }, [history, replaceTopCard]);

  const toggle = useCallback(() => {
    setMounted(true);
    setOpen((current) => !current);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return { open, mounted, rootId, canBack: history.length > 0, navigate, back, toggle, close };
}
