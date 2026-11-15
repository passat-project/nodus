import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { Textarea } from '@nodus/ui/components/textarea';

import { emitTyping } from '../socket/typing-emitter.js';
import { useChatDrafts } from './chat-drafts.js';
import { MentionAutocompletePanel, useComposerMentions } from './composer-mention-autocomplete.js';
import { MentionFieldOverlay, type MentionHit } from './composer-mention-overlay.js';
import { mentionIndexAtOffset, type DraftMention } from './composer-mention-registry.js';

/**
 * Поле ввода композера (chat-composer.tsx): панель автокомплита
 * @упоминаний, зеркальный оверлей чипов и сама textarea. Состояние —
 * черновик хоста (drafts-стор по focusId) и хук упоминаний хоста.
 */
export function ComposerTextField({
  focusId,
  conversationId,
  typingThreadRootId,
  text,
  draftMentions,
  mentions,
  inputRef,
  registerInput,
  editToken,
  onEditToken,
  onInputFocus,
  onKeyDown,
  onPaste,
  placeholder,
}: {
  focusId: string;
  conversationId?: string;
  typingThreadRootId: string | null;
  text: string;
  draftMentions: DraftMention[];
  mentions: ReturnType<typeof useComposerMentions>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  registerInput: (el: HTMLTextAreaElement | null) => void;
  editToken: MentionHit | null;
  onEditToken: (token: MentionHit | null) => void;
  onInputFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
}) {
  return (
    <span className="relative flex min-w-0 flex-1 flex-col">
      {mentions.open ? (
        <MentionAutocompletePanel
          candidates={mentions.autocomplete.candidates}
          active={mentions.autocomplete.active}
          onHover={mentions.autocomplete.setActive}
          onPick={mentions.pick}
          anchorRef={inputRef}
        />
      ) : null}
      <MentionFieldOverlay
        text={text}
        mentions={draftMentions}
        textareaRef={inputRef}
        editToken={editToken}
        onRename={(index, label) => useChatDrafts.getState().renameMention(focusId, index, label)}
        onRemove={(index) => useChatDrafts.getState().removeMention(focusId, index)}
        onEditClose={() => {
          onEditToken(null);
          // Каретку DOM поповер поставил — забрать в state (иначе
          // детектор автокомплита живёт по старой позиции).
          const el = inputRef.current;
          if (el) mentions.syncCaret(el);
        }}
      />
      <Textarea
        ref={registerInput}
        value={text}
        // Скроллбар СКРЫТ намеренно: при появлении он сужал контентную
        // ширину поля на 3px, а зеркало (overflow-hidden, без скроллбара)
        // сохраняло полную — переносы расходились, и на длинном тексте
        // каретка/выделение уезжали на строку (#409). Ширина пары обязана
        // совпадать всегда; прокрутка остаётся колесом/клавишами/выделением.
        className="max-h-[45vh] min-h-8 flex-1 resize-none rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-base text-transparent caret-foreground shadow-none ring-0 [scrollbar-width:none] focus-visible:border-0 focus-visible:ring-0 md:text-sm dark:bg-transparent [&::-webkit-scrollbar]:hidden"
        onFocus={onInputFocus}
        onChange={(e) => {
          useChatDrafts.getState().setText(focusId, e.target.value);
          mentions.syncCaret(e.target);
          if (conversationId && e.target.value.length > 0) {
            emitTyping(conversationId, typingThreadRootId);
          }
        }}
        onKeyUp={(e) => mentions.syncCaret(e.currentTarget)}
        onClick={(e) => {
          // Кликом по пилюле (каретка попала в диапазон чипа)
          // открываем поповер правки label (#228: каретка нативная,
          // позиции честные — клампы не нужны).
          const el = e.currentTarget;
          const offset = el.selectionStart ?? 0;
          const index = mentionIndexAtOffset(draftMentions, offset);
          onEditToken(index === null ? null : { ...draftMentions[index]!, index });
          mentions.syncCaret(el);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        rows={1}
      />
    </span>
  );
}
