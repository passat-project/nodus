import { useCallback, useState, type RefObject } from 'react';
import type { FormulaAggregate } from '@nodus/contracts';

import { insertChipAtCaret, replaceChipElement } from './formula-dom.js';
import { nextChipKey, type FormulaChip } from './formula-text.js';

/** Состояние диалога агрегата (#632): открытие на новую плашку из палитры и
 *  на правку существующей (dblclick). Правка заменяет плашку на месте —
 *  иначе формула тихо разрастается второй такой же. */
export interface AggregateDialogState {
  open: boolean;
  initial: FormulaAggregate | null;
  /** Ключ правимой плашки; null — новая плашка из палитры. */
  key: string | null;
}

const CLOSED: AggregateDialogState = { open: false, initial: null, key: null };

export function useFormulaAggregateDialog({
  rootRef,
  chipsRef,
  refresh,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  chipsRef: RefObject<Map<string, FormulaChip>>;
  refresh: () => void;
}) {
  const [aggregateDialog, setAggregateDialog] = useState<AggregateDialogState>(CLOSED);

  /** Стабильный колбэк: на нём держится memo `setDom` (перерисовка строки). */
  const openAggregateEditor = useCallback((chip: Extract<FormulaChip, { type: 'aggregate' }>) => {
    setAggregateDialog({ open: true, initial: chip.aggregate, key: chip.key });
  }, []);

  /** Новая плашка из палитры/панели функций (не правка существующей). */
  const openNewAggregate = (initial: FormulaAggregate | null) => {
    setAggregateDialog({ open: true, initial, key: null });
  };

  const closeAggregateDialog = () => setAggregateDialog(CLOSED);

  const applyAggregate = (aggregate: FormulaAggregate) => {
    const root = rootRef.current;
    const key = aggregateDialog.key;
    const chip: FormulaChip = { type: 'aggregate', key: key ?? nextChipKey(), aggregate };
    if (root) {
      const replaced =
        key !== null && replaceChipElement(root, key, chip, chipsRef.current, openAggregateEditor);
      if (!replaced) insertChipAtCaret(root, chip, chipsRef.current, openAggregateEditor);
      refresh();
    }
    setAggregateDialog(CLOSED);
  };

  return {
    aggregateDialog,
    openAggregateEditor,
    openNewAggregate,
    closeAggregateDialog,
    applyAggregate,
  };
}
