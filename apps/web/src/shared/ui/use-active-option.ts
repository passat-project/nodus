import { useState, type KeyboardEvent } from 'react';

/**
 * Клавиатура списка вариантов комбобокса (#55, ввод «≤ 30 секунд»): ↑/↓ —
 * подсветка (по кругу), Enter — выбор подсвеченного (по умолчанию первого).
 * Сочетания с Ctrl/⌘/Alt НЕ перехватываются — они принадлежат хосту
 * (Ctrl+Enter — «Зарегистрировать», Alt+↑/↓ — соседнее письмо). Смена
 * `resetKey` (новый запрос, открытие) возвращает подсветку на первый вариант.
 */
export function useActiveOption(count: number, resetKey: unknown) {
  const [state, setState] = useState({ key: resetKey, index: 0 });
  // Сброс во время рендера по смене ключа (канон React, без эффекта).
  if (state.key !== resetKey) setState({ key: resetKey, index: 0 });
  const index = state.key === resetKey ? state.index : 0;
  const active = count === 0 ? -1 : Math.min(index, count - 1);

  function onKeyDown(
    event: KeyboardEvent,
    handlers: { onPick: (index: number) => void; onOpen?: () => void; enabled: boolean },
  ): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      handlers.onOpen?.();
      if (count === 0) return true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setState({ key: resetKey, index: (Math.max(active, 0) + step + count) % count });
      return true;
    }
    // Enter выбирает только из ОТКРЫТОГО списка: у закрытого комбобокса
    // активного варианта нет, иначе Enter «продолжить» молча подменял бы
    // выбранного человека первым из справочника (адресат/подписант письма).
    // Флаг обязателен — предохранитель не должен быть fail-open для новых
    // комбобоксов.
    if (event.key === 'Enter' && handlers.enabled && active >= 0) {
      event.preventDefault();
      handlers.onPick(active);
      return true;
    }
    return false;
  }

  return {
    active,
    setActive: (next: number) => setState({ key: resetKey, index: next }),
    onKeyDown,
  };
}
