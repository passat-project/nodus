import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaAggregateFn,
  FormulaHostKind,
  FormulaNode,
  NodeKind,
} from '@nodus/contracts';
import { FORMULA_AGGREGATES } from '@nodus/contracts';

/** Черновик диалога агрегата (#632): выборка, функция, атрибут, условие.
 *  Отделено от разметки — диалог остаётся представлением. */

export type FromKind = 'subtasks' | 'node_tasks' | 'relations' | 'folder_chain';

const FILTER_OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'le', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'ge', label: '≥' },
] as const;

function literalOf(raw: string): FormulaNode {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'literal', value: '' };
  if (trimmed.toUpperCase() === 'ИСТИНА' || trimmed.toUpperCase() === 'TRUE') {
    return { kind: 'literal', value: true };
  }
  if (trimmed.toUpperCase() === 'ЛОЖЬ' || trimmed.toUpperCase() === 'FALSE') {
    return { kind: 'literal', value: false };
  }
  const normalized = trimmed.replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return { kind: 'literal', value: Number(normalized) };
  return { kind: 'literal', value: trimmed };
}

function fromOptions(hostKind: FormulaHostKind): FromKind[] {
  if (hostKind === 'task') return ['subtasks', 'node_tasks', 'relations', 'folder_chain'];
  if (hostKind === 'node') return ['node_tasks', 'folder_chain'];
  return [];
}

export function useAggregateDraft({
  open,
  initial,
  hostKind,
  definitions,
  kinds,
  onApply,
}: {
  open: boolean;
  initial: FormulaAggregate | null;
  hostKind: FormulaHostKind;
  definitions: readonly CustomFieldDefinition[];
  kinds: readonly NodeKind[];
  onApply: (aggregate: FormulaAggregate) => void;
}) {
  const options = useMemo(() => fromOptions(hostKind), [hostKind]);
  const [fn, setFn] = useState<FormulaAggregateFn>('sum');
  const [from, setFrom] = useState<FromKind>('subtasks');
  const [relation, setRelation] = useState<'relates' | 'blocks' | 'precedes' | 'duplicates'>(
    'relates',
  );
  const [direction, setDirection] = useState<'out' | 'in' | 'both'>('both');
  const [folderKindId, setFolderKindId] = useState('');
  const [fieldNumber, setFieldNumber] = useState('');
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterNumber, setFilterNumber] = useState('');
  const [filterOperator, setFilterOperator] =
    useState<(typeof FILTER_OPERATORS)[number]['value']>('eq');
  const [filterValue, setFilterValue] = useState('');
  /** Условие сложной формы (И/ИЛИ, системное поле…) — диалог его не умеет
   *  редактировать построчно и обязан сохранить как есть, а не потерять. */
  const [complexFilter, setComplexFilter] = useState<FormulaNode | null>(null);
  /** Инициализация ровно один раз на открытие: поздний ответ `kinds` не
   *  должен сбрасывать уже выбранные поля диалога. */
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    const aggregate = initial;
    setFn(aggregate?.fn ?? 'sum');
    if (aggregate?.from.kind === 'folder_chain') {
      setFrom('folder_chain');
    } else if (aggregate?.from.kind === 'related') {
      const selector = aggregate.from.selector;
      setFrom(selector.kind);
      if (selector.kind === 'relations') {
        setRelation(selector.relation);
        setDirection(selector.direction);
      }
    } else {
      setFrom(options[0] ?? 'subtasks');
    }
    setFieldNumber(aggregate?.field ? String(aggregate.field) : '');
    const filter = aggregate?.filter;
    const isComparison = filter?.kind === 'op' && filter.args[0]?.kind === 'field';
    setFilterEnabled(Boolean(filter));
    setComplexFilter(filter && !isComparison ? filter : null);
    if (isComparison && filter.kind === 'op') {
      const [left, right] = filter.args;
      if (left?.kind === 'field') setFilterNumber(String(left.number));
      if (right?.kind === 'literal' && typeof right.value !== 'boolean') {
        setFilterValue(String(right.value));
      } else if (right?.kind === 'literal') {
        setFilterValue(right.value ? 'ИСТИНА' : 'ЛОЖЬ');
      }
      setFilterOperator(filter.op as (typeof FILTER_OPERATORS)[number]['value']);
    } else {
      setFilterNumber('');
      setFilterValue('');
      setFilterOperator('eq');
    }
    setFolderKindId(
      aggregate?.from.kind === 'folder_chain' ? aggregate.from.kindId : (kinds[0]?.id ?? ''),
    );
  }, [open, initial, options, kinds]);

  const spec = FORMULA_AGGREGATES.find((entry) => entry.id === fn);
  const needsField = spec?.field === 'required';
  const needsFilter = spec?.filter === 'required';
  const folderDefinitions = definitions.filter(
    (definition) => !definition.isCompany && definition.bindings.nodeKindIds.length > 0,
  );
  const fieldDefinitions =
    from === 'folder_chain' ? folderDefinitions : definitions.filter((d) => !d.isCompany);
  /** Папка по умолчанию: первый вид, даже если список пришёл после открытия. */
  const effectiveKindId = folderKindId || (kinds[0]?.id ?? '');
  const canApply =
    (!needsField || fieldNumber !== '') &&
    (!needsFilter || filterNumber !== '' || complexFilter !== null) &&
    (from !== 'folder_chain' || effectiveKindId !== '') &&
    options.length > 0;

  const apply = () => {
    const fromValue: FormulaAggregate['from'] =
      from === 'folder_chain'
        ? { kind: 'folder_chain', kindId: effectiveKindId }
        : from === 'relations'
          ? { kind: 'related', selector: { kind: 'relations', relation, direction } }
          : { kind: 'related', selector: { kind: from } };
    const filter: FormulaNode | undefined =
      filterEnabled && filterNumber !== ''
        ? {
            kind: 'op',
            op: filterOperator,
            args: [
              { kind: 'field', source: { kind: 'self' }, number: Number(filterNumber) },
              literalOf(filterValue),
            ],
          }
        : filterEnabled
          ? (complexFilter ?? undefined)
          : undefined;
    onApply({
      kind: 'aggregate',
      from: fromValue,
      fn,
      ...(needsField && fieldNumber ? { field: Number(fieldNumber) } : {}),
      ...(filter ? { filter } : {}),
    });
  };

  return {
    options,
    fn,
    setFn,
    from,
    setFrom,
    relation,
    setRelation,
    direction,
    setDirection,
    folderKindId,
    setFolderKindId,
    fieldNumber,
    setFieldNumber,
    filterEnabled,
    setFilterEnabled,
    filterNumber,
    setFilterNumber,
    filterOperator,
    setFilterOperator,
    filterValue,
    setFilterValue,
    complexFilter,
    needsField,
    needsFilter,
    fieldDefinitions,
    canApply,
    apply,
  };
}

export { FILTER_OPERATORS };
