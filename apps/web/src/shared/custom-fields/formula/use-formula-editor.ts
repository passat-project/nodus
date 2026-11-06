import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  FormulaAggregate,
  FormulaNode,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

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
import {
  type FormulaHost,
  useEvaluateFormula,
  useFormulaCell,
  useRemoveFormula,
  useSaveFormula,
  useValidateFormula,
} from './formula-api.js';
import { useFormulaSave } from './use-formula-save.js';
import { formulaSourceGroups, type SourceLeaf } from './formula-sources.js';
import { tokensToAst } from './formula-parser.js';
import {
  astToTokens,
  nextChipKey,
  type FormulaAggregateChip,
  type FormulaChip,
  type FormulaFieldChip,
} from './formula-text.js';
import type { FormulaHostContext } from './formula-editor.js';

/** Состояние и механика редактора формул (#632, §4c): загрузка AST, строка
 *  плашек, автодополнение, превью/проверка, сохранение и снятие формулы.
 *  Отделено от разметки окна — редактор остаётся представлением. */
export function useFormulaEditor({
  open,
  host,
  fieldId,
  ownDefinitions,
  hostContext,
  onClose,
}: {
  open: boolean;
  host: FormulaHost;
  fieldId: string;
  ownDefinitions: readonly CustomFieldDefinition[];
  hostContext: FormulaHostContext;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef(new Map<string, FormulaChip>());
  const loadedRef = useRef(false);
  const cell = useFormulaCell(host, fieldId, open);
  const definitions = useCustomFieldDefinitions();
  const kinds = useNodeKinds();
  const save = useSaveFormula(host);
  const remove = useRemoveFormula(host);
  const evaluate = useEvaluateFormula(host);
  const validate = useValidateFormula(host);

  const [parse, setParse] = useState<{ ast: FormulaNode | null; error: string | null }>({
    ast: null,
    error: null,
  });
  const [empty, setEmpty] = useState(true);
  const [preview, setPreview] = useState<{ value: CustomFieldValue | null; error: string | null }>({
    value: null,
    error: null,
  });
  const [issues, setIssues] = useState<FormulaValidationIssue[]>([]);
  const [aggregateDialog, setAggregateDialog] = useState<{
    open: boolean;
    initial: FormulaAggregate | null;
  }>({ open: false, initial: null });
  const [autocomplete, setAutocomplete] = useState<{
    open: boolean;
    word: string;
    items: CustomFieldDefinition[];
  }>({ open: false, word: '', items: [] });

  const groups = useMemo(
    () =>
      formulaSourceGroups({
        host,
        ownDefinitions,
        allDefinitions: definitions.data ?? [],
        kinds: kinds.data ?? [],
        hasParent: Boolean(hostContext.parentId),
        hasProject: Boolean(hostContext.projectId),
      }),
    [
      host,
      ownDefinitions,
      definitions.data,
      kinds.data,
      hostContext.parentId,
      hostContext.projectId,
    ],
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
    setPreview({ value: null, error: null });
  }, []);

  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current || cell.isLoading) return;
    loadedRef.current = true;
    setDom(cell.data?.ast ?? null);
  }, [open, cell.isLoading, cell.data, setDom]);

  useEffect(() => {
    if (!parse.ast) {
      setPreview({ value: null, error: null });
      setIssues([]);
      return;
    }
    const ast = parse.ast;
    const timer = window.setTimeout(() => {
      evaluate.mutate(ast, {
        onSuccess: (response) =>
          setPreview({
            value: response.value,
            error: response.error ? ui.formulas.errors[response.error.code] : null,
          }),
        onError: () => setPreview({ value: null, error: ui.formulas.editor.syntaxHint }),
      });
      validate.mutate(
        { ast, targetFieldId: fieldId },
        { onSuccess: (response) => setIssues(response.issues.filter((issue) => issue.blocking)) },
      );
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- мутации стабильны
  }, [parse.ast, fieldId]);

  const insertChip = (chip: FormulaChip) => {
    const root = rootRef.current;
    if (!root) return;
    insertChipAtCaret(root, chip, chipsRef.current, (aggregateChip) =>
      setAggregateDialog({ open: true, initial: aggregateChip.aggregate }),
    );
    refresh();
  };

  const insertField = (leaf: SourceLeaf) => {
    const chip: FormulaFieldChip = {
      type: 'field',
      key: nextChipKey(),
      number: leaf.definition.number,
      name: leaf.definition.name,
      source: leaf.source,
    };
    insertChip(chip);
  };

  const insertAggregate = (aggregate: FormulaAggregate) => {
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

  const { handleSave, handleRemove } = useFormulaSave({
    fieldId,
    parse,
    onClose,
    validate,
    save,
    remove,
    setIssues,
  });

  return {
    rootRef,
    cell,
    definitions,
    kinds,
    save,
    validate,
    remove,
    groups,
    parse,
    empty,
    preview,
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
