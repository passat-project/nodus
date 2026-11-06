import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  CustomFieldDefinition,
  FormulaHostKind,
  FormulaNode,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { validateFormula, type FormulaFieldMeta } from '@nodus/formula-engine';
import { toast } from 'sonner';

import { useNodeKinds } from '../../api/node-kinds.js';
import { useCustomFieldDefinitions } from '../queries.js';
import {
  createChipElement,
  insertChipAtCaret,
  insertTextAtCaret,
  readTokens,
  removeWordBeforeCaret,
  wordBeforeCaret,
} from './formula-dom.js';
import { tokensToAst } from './formula-parser.js';
import { formulaSourceGroups, type SourceLeaf } from './formula-sources.js';
import {
  astToTokens,
  nextChipKey,
  type FormulaAggregateChip,
  type FormulaChip,
  type FormulaFieldChip,
  type FormulaSystemChip,
} from './formula-text.js';

/**
 * Состояние редактора формулы ТИПА/ВИДА (#632, Р6): формула живёт в слоте
 * формы места (тип процесса, тип проекта, вид папки), а не в записи. Здесь
 * нет чтения/записи ячейки — начальный AST и сохранение приходят от формы
 * места. Связанные записи и цепочка папок запрещены (стоимость на чтении).
 */
export function useTypeFormulaEditor({
  open,
  hostKind,
  definition,
  ownDefinitions,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  hostKind: FormulaHostKind;
  definition: CustomFieldDefinition;
  ownDefinitions: readonly CustomFieldDefinition[];
  initial: FormulaNode | null;
  onSave: (ast: FormulaNode | null) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef(new Map<string, FormulaChip>());
  const loadedRef = useRef(false);
  const definitions = useCustomFieldDefinitions();
  const kinds = useNodeKinds();

  const [parse, setParse] = useState<{ ast: FormulaNode | null; error: string | null }>({
    ast: initial,
    error: null,
  });
  const [empty, setEmpty] = useState(initial === null);
  const [issues, setIssues] = useState<FormulaValidationIssue[]>([]);
  const [aggregateDialog, setAggregateDialog] = useState<{
    open: boolean;
    initial: import('@nodus/contracts').FormulaAggregate | null;
  }>({ open: false, initial: null });
  const [autocomplete, setAutocomplete] = useState<{
    open: boolean;
    word: string;
    items: CustomFieldDefinition[];
  }>({ open: false, word: '', items: [] });

  const groups = useMemo(
    () =>
      formulaSourceGroups({
        host: { kind: hostKind, id: 'type' },
        ownDefinitions,
        allDefinitions: definitions.data ?? [],
        kinds: kinds.data ?? [],
        hasParent: true,
        hasProject: true,
        typeDefault: true,
      }),
    [hostKind, ownDefinitions, definitions.data, kinds.data],
  );

  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const tokens = readTokens(root, chipsRef.current);
    setParse(tokensToAst(tokens));
    setEmpty(tokens.every((token) => token.type === 'text' && token.text.trim().length === 0));
  }, []);

  const setDom = useCallback((ast: FormulaNode | null) => {
    const root = rootRef.current;
    if (!root) return;
    root.replaceChildren();
    chipsRef.current.clear();
    const tokens = ast ? astToTokens(ast) : [];
    for (const token of tokens) {
      if (token.type === 'text') root.appendChild(document.createTextNode(token.text));
      else root.appendChild(createChipElement(token, chipsRef.current, () => undefined));
    }
    setParse({ ast, error: null });
    setEmpty(tokens.length === 0);
    setIssues([]);
  }, []);

  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    setDom(initial);
  }, [open, initial, setDom]);

  useEffect(() => {
    if (!parse.ast) {
      setIssues([]);
      return;
    }
    const meta = {
      byNumber: new Map<number, FormulaFieldMeta>(
        (definitions.data ?? []).map((entry) => [
          entry.number,
          {
            number: entry.number,
            type: entry.type,
            dictionaryId: entry.settings.dictionaryId ?? null,
          },
        ]),
      ),
    };
    const result = validateFormula(parse.ast, {
      hostKind,
      meta,
      targetFieldType: definition.type,
      typeDefault: true,
    });
    setIssues(result.issues.filter((issue) => issue.blocking));
  }, [parse.ast, hostKind, definition.type, definitions.data]);

  const insertChip = (chip: FormulaChip) => {
    const root = rootRef.current;
    if (!root) return;
    insertChipAtCaret(root, chip, chipsRef.current, (aggregateChip) =>
      setAggregateDialog({ open: true, initial: aggregateChip.aggregate }),
    );
    refresh();
  };

  const insertField = (leaf: SourceLeaf) => {
    if (leaf.system) {
      const chip: FormulaSystemChip = {
        type: 'system',
        key: nextChipKey(),
        entity: leaf.system.entity,
        fieldKey: leaf.system.key,
        source: leaf.source,
      };
      insertChip(chip);
      return;
    }
    if (!leaf.definition) return;
    const chip: FormulaFieldChip = {
      type: 'field',
      key: nextChipKey(),
      number: leaf.definition.number,
      name: leaf.definition.name,
      source: leaf.source,
    };
    insertChip(chip);
  };

  const insertAggregate = (aggregate: import('@nodus/contracts').FormulaAggregate) => {
    const chip: FormulaAggregateChip = { type: 'aggregate', key: nextChipKey(), aggregate };
    insertChip(chip);
  };

  const insertText = (text: string) => {
    const root = rootRef.current;
    if (!root) return;
    insertTextAtCaret(root, text);
    refresh();
  };

  const updateAutocomplete = () => {
    const root = rootRef.current;
    if (!root) return;
    const word = wordBeforeCaret(root);
    if (word.length < 1) {
      setAutocomplete({ open: false, word: '', items: [] });
      return;
    }
    const items = ownDefinitions
      .filter((entry) => entry.name.toLowerCase().includes(word.toLowerCase()))
      .slice(0, 8);
    setAutocomplete({ open: items.length > 0, word, items });
  };

  const applyAutocomplete = (entry: CustomFieldDefinition) => {
    const root = rootRef.current;
    if (root) removeWordBeforeCaret(root, autocomplete.word.length);
    insertChip({
      type: 'field',
      key: nextChipKey(),
      number: entry.number,
      name: entry.name,
      source: { kind: 'self' },
    });
    setAutocomplete({ open: false, word: '', items: [] });
  };

  const handleInput = () => {
    refresh();
    updateAutocomplete();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!autocomplete.open) return;
    if (event.key === 'Enter' && autocomplete.items[0]) {
      event.preventDefault();
      applyAutocomplete(autocomplete.items[0]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setAutocomplete({ open: false, word: '', items: [] });
    }
  };

  const handleSave = () => {
    if (parse.error) {
      toast.error(parse.error);
      return;
    }
    if (issues.length > 0) {
      toast.error(ui.formulas.editor.saveError);
      return;
    }
    onSave(parse.ast);
    toast.success(ui.formulas.typeFormula.saved);
    onClose();
  };

  const handleRemove = () => {
    onSave(null);
    toast.success(ui.formulas.typeFormula.saved);
    onClose();
  };

  return {
    rootRef,
    definitions,
    kinds,
    groups,
    parse,
    empty,
    issues,
    aggregateDialog,
    setAggregateDialog,
    autocomplete,
    insertText,
    insertField,
    insertAggregate,
    applyAutocomplete,
    handleInput,
    handleKeyDown,
    handleSave,
    handleRemove,
  };
}
