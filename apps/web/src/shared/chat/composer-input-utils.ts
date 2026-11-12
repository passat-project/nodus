import { useLayoutEffect, useState, type ClipboardEvent, type RefObject } from 'react';
import { toast } from 'sonner';

import { ui } from '@nodus/contracts';

import { emitTyping } from '../socket/typing-emitter.js';
import { addFiles } from './composer-files.js';
import { useChatDrafts, type ReplyDraft } from './chat-drafts.js';
import type { StickerSubmitPayload } from './sticker-api.js';

/** Рост поля против базовой строки (ResizeObserver) — хореография иконок
 *  композера (в покое — self-center, вырос — self-end, канон Битрикс24).
 *  Вынесено из chat-composer.tsx (I5, #177). */
export function useGrown(inputRef: RefObject<HTMLTextAreaElement | null>): boolean {
  const [grown, setGrown] = useState(false);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // База — min-height ОДНОЙ строки, а не первый замер: при монтаже с
      // восстановленным длинным черновиком первый кадр уже вырос, и иконки
      // навсегда залипали внизу (#409, попутная находка).
      const base = Number.parseFloat(getComputedStyle(el).minHeight) || el.clientHeight;
      setGrown(el.clientHeight > base + 4);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [inputRef]);
  return grown;
}

export function ctrlOrAlt(event: { ctrlKey: boolean; altKey: boolean }): boolean {
  return event.ctrlKey || event.altKey;
}

/** Перенос строки в каретку (#777): контролируемое поле само `\n` по
 *  Ctrl+Enter не вставит (в Chromium/WebView2 клавиша — no-op), поэтому
 *  splice по выделению + позиция каретки за переносом. Чистая функция —
 *  детерминированный unit-тест без DOM. */
export function insertNewlineAtCaret(
  el: HTMLTextAreaElement | null,
  text: string,
): { text: string; caret: number } {
  const start = el?.selectionStart ?? text.length;
  const end = el?.selectionEnd ?? start;
  return { text: `${text.slice(0, start)}\n${text.slice(end)}`, caret: start + 1 };
}

/** Ввод-действия композера (вынесено из chat-composer.tsx — I5, #177):
 *  эмодзи в каретку (#130), стикер-отправка мимо гейтов (#143), paste
 *  файлов (#87) с вежливой подсказкой при запрете вложений хостом. */
export function useComposerInputActions(deps: {
  focusId: string;
  conversationId?: string;
  typingThreadRootId?: string | null;
  text: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  attachmentsEnabled: boolean;
  /** Стор-экшн черновика (useChatDrafts.setText) — пишем в ключ фокуса. */
  setText: (key: string, text: string) => void;
  /** Синк каретки поля хостом (#294): вставка эмодзи из панели ставит
   *  каретку в rAF — без синка детекторы (упоминания/стикеры) живут по
   *  устаревшей позиции до ближайшего keyUp. */
  syncCaret?: (el: HTMLTextAreaElement) => void;
  onSubmit: (submit: {
    text: string;
    attachments: [];
    reply: ReplyDraft | null;
    edit: null;
    sticker: StickerSubmitPayload;
  }) => void;
  requestScrollEnd: () => void;
}) {
  const {
    focusId,
    conversationId,
    typingThreadRootId,
    text,
    inputRef,
    attachmentsEnabled,
    setText,
    onSubmit,
    requestScrollEnd,
  } = deps;

  /** Вставка эмодзи из панели (#130): в позицию КАРЕТКИ поля, каретка — за
   *  вставленным глифом (канон мессенджеров); поле получает фокус обратно. */
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    if (!el) {
      setText(focusId, text + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(focusId, next);
    if (conversationId && next.length > 0) emitTyping(conversationId, typingThreadRootId);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      deps.syncCaret?.(el);
    });
  }

  /** Перенос строки (#777): Ctrl/Meta/Alt+Enter — `\n` в позицию каретки,
   *  каретка за переносом (rAF — поле контролируемое), сообщение НЕ уходит.
   *  Выделение заменяется переносом (нативное поведение textarea). */
  function insertNewline() {
    const el = inputRef.current;
    const next = insertNewlineAtCaret(el, text);
    setText(focusId, next.text);
    if (conversationId && next.text.length > 0) emitTyping(conversationId, typingThreadRootId);
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      deps.syncCaret?.(el);
    });
  }

  /** Выбор стикера (#143): мгновенная отправка отдельным сообщением — мимо
   *  textarea и гейтов canSubmit (стикер самодостаточен, модель Telegram);
   *  панель пикера не закрывается (можно поставить серию), набранный текст
   *  не уходит (keepDraft мутации). Ответ-стикером (#288, канон Telegram:
   *  в режиме ответа клик по стикеру отправляет его ответом) — активный
   *  ответ летит в payload; потребление ответа из черновика — takeDraft
   *  мутации (текст остаётся, плашка гаснет), ошибка вернёт. */
  function pickSticker(payload: StickerSubmitPayload) {
    const reply: ReplyDraft | null = useChatDrafts.getState().drafts[focusId]?.reply ?? null;
    onSubmit({ text: '', attachments: [], reply, edit: null, sticker: payload });
    requestScrollEnd();
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    // Хост запретил вложения (панельные исключения) — вежливая подсказка
    // вместо ошибки загрузки.
    if (!attachmentsEnabled) {
      toast(ui.chat.attachFile);
      return;
    }
    event.preventDefault();
    addFiles(focusId, files);
  }

  return { insertEmoji, insertNewline, pickSticker, onPaste };
}
