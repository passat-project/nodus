import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import {
  useComposerMentions,
  mentionAutocompleteKeydown,
} from './composer-mention-autocomplete.js';
import type { MentionHit } from './composer-mention-overlay.js';
import {
  applyEditToMentions,
  fromWireText,
  insertMentionDraft,
  mentionIndexAtKey,
  mentionIndexAtOffset,
  removeMentionDraft,
  replaceMentionLabelDraft,
  toWireText,
  type DraftMention,
} from './composer-mention-registry.js';
import { useAttachSendDialog } from './dialog-stores.js';
import { insertNewlineAtCaret } from './composer-input-utils.js';
import { scopeConversationOf } from './scope-conversations.js';

/**
 * @упоминания подписи окна отправки (#239): видимый текст подписи — в сторе
 * окна, ЛОКАЛЬНЫЙ реестр чипов — здесь; открытие разбирает wire →
 * display+реестр, отправка/возврат черновику пересобирают wire.
 */
export function useCaptionMentions({
  scope,
  caption,
  setCaption,
  captionRef,
}: {
  scope: string | null;
  caption: string;
  setCaption: (caption: string) => void;
  captionRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // Локальный реестр чипов подписи (#239): видимый текст — в сторе окна,
  // привязки id — здесь; открытие сеет из wire, правки — диффом registry.
  const [mentionList, setMentionList] = useState<DraftMention[]>([]);
  // Свежий срез реестра для обработчиков вне рендера (эффект закрытия).
  const mentionListRef = useRef<DraftMention[]>([]);
  mentionListRef.current = mentionList;
  const [editToken, setEditToken] = useState<MentionHit | null>(null);
  // Состав участников для автокомплита (#239): scope треда не несёт id
  // беседы — карту ведёт смонтированный композер хоста.
  const conversationId = useMemo(() => (scope ? scopeConversationOf(scope) : undefined), [scope]);
  const mentions = useComposerMentions({
    conversationId,
    text: caption,
    inputRef: captionRef,
    insertMention: (atStart, atEnd, id, label) => {
      const res = insertMentionDraft(caption, mentionList, atStart, atEnd, id, label);
      if (!res) return null;
      setCaption(res.text);
      setMentionList(res.mentions);
      return res.caret;
    },
  });

  // Открытие окна (#239): подпись приходит WIRE-текстом (черновик композера
  // при отправке, правимое сообщение — при правке) — разбирается в видимый
  // текст + реестр чипов; закрытие гасит реестр.
  useEffect(() => {
    if (scope === null) {
      setMentionList([]);
      return;
    }
    const parsed = fromWireText(useAttachSendDialog.getState().caption);
    setCaption(parsed.text);
    setMentionList(parsed.mentions);
  }, [scope, setCaption]);

  /** Правка подписи: текст — в стор окна, реестр — диффом registry (#228). */
  function handleCaptionChange(next: string) {
    setMentionList((prev) => applyEditToMentions(prev, caption, next));
    setCaption(next);
  }

  /** Клавиатура подписи (#239): атомарное удаление чипа + автокомплит —
   *  канон композера (composer-keydown); Enter выбирает кандидата (НЕ
   *  отправляет), ↑↓ по списку, Esc гасит панель. true — клавиша съедена. */
  function handleMentionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const el = event.currentTarget;
      if (el.selectionStart === el.selectionEnd) {
        const index = mentionIndexAtKey(mentionList, el.selectionStart ?? 0, event.key);
        if (index !== null) {
          const start = mentionList[index]!.start;
          event.preventDefault();
          const res = removeMentionDraft(caption, mentionList, index);
          setCaption(res.text);
          setMentionList(res.mentions);
          requestAnimationFrame(() => el.setSelectionRange(start, start));
          return true;
        }
      }
    }
    return mentionAutocompleteKeydown(
      event,
      {
        open: mentions.open,
        count: mentions.autocomplete.candidates.length,
        active: mentions.autocomplete.active,
        setActive: mentions.autocomplete.setActive,
      },
      mentions.pick,
      mentions.dismiss,
    );
  }

  /** Перенос строки (#777): Ctrl/Meta/Alt+Enter — `\n` в позицию каретки
   *  подписи, каретка за переносом; реестр чипов пересчитывается диффом
   *  (как при обычной правке textarea). */
  function insertNewline() {
    const el = captionRef.current;
    const next = insertNewlineAtCaret(el, caption);
    setMentionList((prev) => applyEditToMentions(prev, caption, next.text));
    setCaption(next.text);
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      mentions.syncCaret(el);
    });
  }

  function renameMention(index: number, label: string) {
    const res = replaceMentionLabelDraft(caption, mentionList, index, label);
    if (!res) return;
    setCaption(res.text);
    setMentionList(res.mentions);
  }

  function removeMention(index: number) {
    const res = removeMentionDraft(caption, mentionList, index);
    setCaption(res.text);
    setMentionList(res.mentions);
  }

  /** Клик по чипу — поповер правки label (#228, как композер). */
  function handleCaptionClick(el: HTMLTextAreaElement) {
    const offset = el.selectionStart ?? 0;
    const index = mentionIndexAtOffset(mentionList, offset);
    setEditToken(index === null ? null : { ...mentionList[index]!, index });
    mentions.syncCaret(el);
  }

  return {
    mentions,
    mentionList,
    mentionListRef,
    editToken,
    setEditToken,
    handleCaptionChange,
    handleMentionKeyDown,
    insertNewline,
    handleCaptionClick,
    renameMention,
    removeMention,
  };
}

/** Wire-подпись окна (#239): отправка/возврат черновику идут в разметке.
 *  Читает СТОР и ref — эффект закрытия живёт вне рендеров подписи. */
export function captionWireOf(mentionListRef: RefObject<DraftMention[]>): string {
  return toWireText(useAttachSendDialog.getState().caption, mentionListRef.current);
}
