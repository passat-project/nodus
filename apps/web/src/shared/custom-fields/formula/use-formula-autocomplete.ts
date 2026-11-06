import { useState } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { removeWordBeforeCaret, wordBeforeCaret } from './formula-dom.js';

/** Автодополнение своих атрибутов в строке формулы (#632): набранное слово
 *  заменяется плашкой. Вынесено из общего состояния редактора — механика
 *  не зависит от сохранения/превью. */
export interface FormulaAutocomplete {
  open: boolean;
  word: string;
  items: CustomFieldDefinition[];
}

const CLOSED: FormulaAutocomplete = { open: false, word: '', items: [] };

export function useFormulaAutocomplete({
  ownDefinitions,
}: {
  /** Свои атрибуты места, уже без текущего (self-reference — цикл). */
  ownDefinitions: readonly CustomFieldDefinition[];
}) {
  const [autocomplete, setAutocomplete] = useState<FormulaAutocomplete>(CLOSED);

  const closeAutocomplete = () => setAutocomplete(CLOSED);

  const updateAutocomplete = (root: HTMLElement | null) => {
    if (!root) return;
    const word = wordBeforeCaret(root);
    if (word.length < 1) {
      closeAutocomplete();
      return;
    }
    const items = ownDefinitions
      .filter((entry) => entry.name.toLowerCase().includes(word.toLowerCase()))
      .slice(0, 8);
    setAutocomplete({ open: items.length > 0, word, items });
  };

  /** Убрать набранное слово перед вставкой плашки. */
  const consumeWord = (root: HTMLElement | null) => {
    if (root) removeWordBeforeCaret(root, autocomplete.word.length);
  };

  return { autocomplete, updateAutocomplete, closeAutocomplete, consumeWord };
}
