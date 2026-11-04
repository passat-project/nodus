import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LetterDetail } from '@nodus/contracts';

import { lettersKeys } from '../../../shared/api/letters-keys.js';

/**
 * Письмо было «новым» и зарегистрировалось (окном или кнопкой без окна) —
 * списки рефечатся, чтобы строка ушла из «Новые» и пришла во «Входящие»
 * без перезагрузки, после чего карточка закрывается (вердикт владельца
 * 28.10: секретарь возвращается к очереди и выбирает следующее письмо).
 */
export function useCloseAfterRegistration(
  letter: LetterDetail | undefined,
  closeCard: () => void,
): void {
  const queryClient = useQueryClient();
  const wasNew = useRef<boolean | null>(null);

  useEffect(() => {
    if (!letter) return;
    if (wasNew.current === null || !wasNew.current || letter.registeredAt === null) {
      wasNew.current = letter.registeredAt === null;
      return;
    }
    wasNew.current = false;
    void queryClient.invalidateQueries({ queryKey: lettersKeys.lists() });
    closeCard();
  }, [letter, queryClient, closeCard]);
}
