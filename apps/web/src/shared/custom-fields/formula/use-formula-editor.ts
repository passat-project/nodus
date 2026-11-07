import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldValue,
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
} from './formula-dom.js';
import { useFormulaAggregateDialog } from './use-formula-aggregate.js';
import { useFormulaAutocomplete } from './use-formula-autocomplete.js';
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
  type FormulaChip,
  type FormulaFieldChip,
  type FormulaSystemChip,
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
  /** Появление contenteditable: Radix монтирует портал позже эффекта —
   *  без сигнала повторное открытие оставалось пустым (rootRef ещё null). */
  const [rootEpoch, setRootEpoch] = useState(0);
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (node) setRootEpoch((value) => value + 1);
  }, []);
  const chipsRef = useRef(new Map<string, FormulaChip>());
  /** Пользователь уже правил строку — GET не затирает ввод. */
  const dirtyRef = useRef(false);
  /** Номер последнего превью: старый ответ не перезаписывает. */
  const evalSeq = useRef(0);
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

  /** Свой атрибут нельзя вставить в собственную формулу — это цикл; палитра
   *  и автодополнение его не предлагают (сервер всё равно отклонит). */
  const ownSources = useMemo(
    () => ownDefinitions.filter((definition) => definition.id !== fieldId),
    [ownDefinitions, fieldId],
  );

  const groups = useMemo(
    () =>
      formulaSourceGroups({
        host,
        ownDefinitions: ownSources,
        allDefinitions: definitions.data ?? [],
        kinds: kinds.data ?? [],
        hasParent: Boolean(hostContext.parentId),
        hasProject: Boolean(hostContext.projectId),
      }),
    [host, ownSources, definitions.data, kinds.data, hostContext.parentId, hostContext.projectId],
  );

  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const tokens = readTokens(root, chipsRef.current);
    setParse(tokensToAst(tokens));
    setEmpty(tokens.every((token) => token.type === 'text' && token.text.trim().length === 0));
  }, []);

  const {
    aggregateDialog,
    openAggregateEditor,
    openNewAggregate,
    closeAggregateDialog,
    applyAggregate,
  } = useFormulaAggregateDialog({ rootRef, chipsRef, refresh });
  const { autocomplete, updateAutocomplete, closeAutocomplete, consumeWord } =
    useFormulaAutocomplete({ ownDefinitions: ownSources });

  const setDom = useCallback(
    (ast: FormulaNode | null) => {
      const root = rootRef.current;
      if (!root) return;
      root.replaceChildren();
      chipsRef.current.clear();
      const tokens = ast ? astToTokens(ast) : [];
      for (const token of tokens) {
        if (token.type === 'text') root.appendChild(document.createTextNode(token.text));
        else root.appendChild(createChipElement(token, chipsRef.current, openAggregateEditor));
      }
      dirtyRef.current = false;
      setParse({ ast, error: null });
      setEmpty(tokens.length === 0);
      setIssues([]);
      setPreview({ value: null, error: null });
    },
    [openAggregateEditor],
  );

  // Данные применяем и когда они пришли ПОСЛЕ открытия (кэша не было):
  // повторное открытие редактора не должно оставаться пустым из-за гонки
  // «сначала isLoading=false с undefined, потом настоящий AST придёт фоновым
  // GET — его нужно применить, если пользователь ещё не правил строку.
  useEffect(() => {
    if (!open) {
      dirtyRef.current = false;
      return;
    }
    // Ждём именно данные, а не флаг isLoading: при повторном открытии
    // кэш может быть пустым ({ast:null}), а настоящий AST придёт фоновым
    // GET — его нужно применить, если пользователь ещё не правил строку.
    if (cell.data === undefined || dirtyRef.current) return;
    setDom(cell.data.ast ?? null);
  }, [open, cell.data, setDom, rootEpoch]);

  /** Откат строки к формуле ячейки — выход из режима «своя формула поверх
   *  типовой»: черновик отбрасывается, показывается унаследованная формула
   *  (как при открытии: копия AST, пометки правки сняты). */
  const resetToCell = useCallback(() => {
    if (cell.data) setDom(cell.data.ast ?? null);
  }, [cell.data, setDom]);

  useEffect(() => {
    if (!parse.ast) {
      setPreview({ value: null, error: null });
      setIssues([]);
      return;
    }
    const ast = parse.ast;
    const seq = ++evalSeq.current;
    const timer = window.setTimeout(() => {
      evaluate.mutate(ast, {
        onSuccess: (response) => {
          if (seq !== evalSeq.current) return;
          setPreview({
            value: response.value,
            error: response.error ? ui.formulas.errors[response.error.code] : null,
          });
        },
        onError: () => {
          if (seq === evalSeq.current) {
            setPreview({ value: null, error: ui.formulas.editor.syntaxHint });
          }
        },
      });
      validate.mutate(
        { ast, targetFieldId: fieldId },
        {
          onSuccess: (response) => {
            if (seq !== evalSeq.current) return;
            setIssues(response.issues.filter((issue) => issue.blocking));
          },
        },
      );
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- мутации стабильны
  }, [parse.ast, fieldId]);

  const insertChip = (chip: FormulaChip) => {
    const root = rootRef.current;
    if (!root) return;
    dirtyRef.current = true;
    insertChipAtCaret(root, chip, chipsRef.current, openAggregateEditor);
    // Вставка из палитры закрывает автодополнение: иначе следующий Enter
    // применит устаревшее слово и добавит лишнюю плашку.
    closeAutocomplete();
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

  const insertText = (text: string) => {
    const root = rootRef.current;
    if (!root) return;
    dirtyRef.current = true;
    insertTextAtCaret(root, text);
    closeAutocomplete();
    refresh();
  };

  const applyAutocomplete = (entry: CustomFieldDefinition) => {
    consumeWord(rootRef.current);
    insertChip({
      type: 'field',
      key: nextChipKey(),
      number: entry.number,
      name: entry.name,
      source: { kind: 'self' },
    });
    closeAutocomplete();
  };

  const handleInput = () => {
    dirtyRef.current = true;
    refresh();
    updateAutocomplete(rootRef.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Строка однострочная: Enter без автодополнения не создаёт перенос
    // (contenteditable иначе плодит пустые строки в «однострочном» поле).
    if (event.key === 'Enter') {
      event.preventDefault();
      if (autocomplete.open && autocomplete.items[0]) {
        applyAutocomplete(autocomplete.items[0]);
      }
      return;
    }
    if (!autocomplete.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAutocomplete();
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
    setRootRef,
    rootEpoch,
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
    openNewAggregate,
    closeAggregateDialog,
    applyAggregate,
    closeAutocomplete,
    autocomplete,
    insertText,
    insertField,
    insertChip,
    applyAutocomplete,
    resetToCell,
    handleInput,
    handleKeyDown,
    handleSave,
    handleRemove,
  };
}
