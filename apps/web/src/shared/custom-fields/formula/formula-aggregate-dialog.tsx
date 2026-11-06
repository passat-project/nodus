import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaAggregateFn,
  FormulaHostKind,
  NodeKind,
} from '@nodus/contracts';
import { FORMULA_AGGREGATES, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
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

/**
 * Диалог агрегата (#632, §4c): выборка (подзадачи / связанные / задачи
 * папки / цепочка папок), функция и атрибут; «все/хотя бы одна» требуют
 * условия, «сколько» — без атрибута. Фильтр V1 — одно сравнение атрибута
 * с литералом (движок и AST поддерживают произвольное условие).
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
    needsField,
    needsFilter,
    fieldDefinitions,
    canApply,
    apply,
  } = useAggregateDraft({ open, initial, hostKind, definitions, kinds, onApply });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ui.formulas.aggregateDialog.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{ui.formulas.aggregateDialog.fn}</Label>
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{ui.formulas.aggregateDialog.from}</Label>
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
          </div>

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
            <div className="flex flex-col gap-1.5">
              <Label>{ui.formulas.aggregateDialog.field}</Label>
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
            </div>
          ) : null}

          {!needsFilter ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={filterEnabled}
                onChange={(event) => setFilterEnabled(event.target.checked)}
              />
              {ui.formulas.aggregateDialog.filterToggle}
            </label>
          ) : null}

          {filterEnabled || needsFilter ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
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
                <SelectTrigger className="w-16">
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
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button disabled={!canApply} onClick={apply}>
            {ui.formulas.editor.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
