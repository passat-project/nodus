import { useEffect } from 'react';

import { useAssistantStore } from '../model/assistant-store.js';

/** Ctrl+J — открыть/закрыть окно ассистента из любого раздела (дубль кнопки
 *  агента внизу полосы аватарок). */
export function useAssistantHotkey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        // Открытый оверлей-слой (поповер/меню/диалог) владеет фокусом:
        // маунт композера ассистента сбил бы его focusOutside (баг #71).
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
        event.preventDefault();
        const s = useAssistantStore.getState();
        s.setOpen(!s.open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
