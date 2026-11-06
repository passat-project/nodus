import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaAggregateFn,
  FormulaHostKind,
  NodeKind,
} from '@nodus/contracts';
import { FORMULA_AGGREGATES, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Checkbox } from '@nodus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { Label } from '@nodus/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { FILTER_OPERATORS, useAggregateDraft, type FromKind } from './use-aggregate-draft.js';

/** Поле диалога: метка — 13px muted (канон форм: метка мельче и серее
 *  значения), контрол на своей строке. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Диалог агрегата (#632, §4c): выборка (подзадачи / связанные / задачи
 * папки / цепочка папок), функция и атрибут; «все/хотя бы одна» требуют
 * условия, «сколько» — без атрибута. Фильтр V1 — одно сравнение атрибута
 * с литералом (движок и AST поддерживают произвольное условие).
 *
 * Условие — отдельная ступень тона: это необязательная часть выборки, и
 * включается она галочкой, а не полем в общем столбце (группировка по смыслу).
 */
export function FormulaAggregateDialog({
  open,
  initial,
  hostKind,
  definitions,
  kinds,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: FormulaAggregate | null;
  hostKind: FormulaHostKind;
  definitions: readonly CustomFieldDefinition[];
  kinds: readonly NodeKind[];
  onApply: (aggregate: FormulaAggregate) => void;
  onClose: () => void;
}) {
  const {
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
  } = useAggregateDraft({ open, initial, hostKind, definitions, kinds, onApply });

  const conditionOpen = filterEnabled || needsFilter;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle>{ui.formulas.aggregateDialog.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={ui.formulas.aggregateDialog.fn}>
            <Select value={fn} onValueChange={(next) => setFn(next as FormulaAggregateFn)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {FORMULA_AGGREGATES.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {ui.formulas.aggregates[entry.id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={ui.formulas.aggregateDialog.from}>
            <Select value={from} onValueChange={(next) => setFrom(next as FromKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'subtasks'
                      ? ui.formulas.sources.subtasks
                      : option === 'node_tasks'
                        ? ui.formulas.sources.nodeTasks
                        : option === 'relations'
                          ? ui.formulas.sources.relations
                          : ui.formulas.sources.folderChain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {from === 'relations' ? (
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={relation}
                onValueChange={(next) => setRelation(next as typeof relation)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {(['relates', 'blocks', 'precedes', 'duplicates'] as const).map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {ui.formulas.relations[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={direction}
                onValueChange={(next) => setDirection(next as typeof direction)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="out">{ui.formulas.sources.directionOut}</SelectItem>
                  <SelectItem value="in">{ui.formulas.sources.directionIn}</SelectItem>
                  <SelectItem value="both">{ui.formulas.sources.directionBoth}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {from === 'folder_chain' ? (
            <Select value={folderKindId} onValueChange={setFolderKindId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={ui.formulas.sources.folderKind} />
              </SelectTrigger>
              <SelectContent position="popper">
                {kinds.map((kind) => (
                  <SelectItem key={kind.id} value={kind.id}>
                    {kind.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {needsField ? (
            <Field label={ui.formulas.aggregateDialog.field}>
              <Select value={fieldNumber} onValueChange={setFieldNumber}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={ui.formulas.aggregateDialog.pickField} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {fieldDefinitions.map((definition) => (
                    <SelectItem key={definition.id} value={String(definition.number)}>
                      {definition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5 dark:bg-background/60">
            {needsFilter ? null : (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="aggregate-filter-toggle"
                  checked={filterEnabled}
                  onCheckedChange={(checked) => setFilterEnabled(checked === true)}
                />
                <Label
                  htmlFor="aggregate-filter-toggle"
                  className="cursor-pointer text-xs font-normal text-muted-foreground"
                >
                  {ui.formulas.aggregateDialog.filterToggle}
                </Label>
              </div>
            )}

            {conditionOpen && complexFilter ? (
              <p className="text-xs text-muted-foreground">
                {ui.formulas.aggregateDialog.filterComplex}
              </p>
            ) : null}

            {conditionOpen ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <Select value={filterNumber} onValueChange={setFilterNumber}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={ui.formulas.aggregateDialog.filterField} />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {definitions
                      .filter((definition) => !definition.isCompany)
                      .map((definition) => (
                        <SelectItem key={definition.id} value={String(definition.number)}>
                          {definition.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filterOperator}
                  onValueChange={(next) =>
                    setFilterOperator(next as (typeof FILTER_OPERATORS)[number]['value'])
                  }
                >
                  <SelectTrigger className="w-14 justify-center px-2 font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {FILTER_OPERATORS.map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  placeholder={ui.formulas.aggregateDialog.value}
                />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button disabled={!canApply} onClick={apply}>
            {ui.formulas.aggregateDialog.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
