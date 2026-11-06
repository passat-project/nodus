import type { CustomFieldDefinition, FormulaHostKind, FormulaNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import { FormulaAggregateDialog } from './formula-aggregate-dialog.js';
import { FormulaFunctionsPanel } from './formula-functions-panel.js';
import { FormulaLine } from './formula-line.js';
import { FormulaPalette } from './formula-palette.js';
import { useTypeFormulaEditor } from './use-type-formula-editor.js';

/**
 * Редактор формулы ТИПА/ВИДА (#632, Р6): та же строка плашек, палитра и
 * функции, что у ячейки, но результат не считается здесь — значение
 * посчитается у записей. Связанные записи и цепочка папок недоступны.
 */
export function TypeFormulaDialog({
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
  const {
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
  } = useTypeFormulaEditor({
    open,
    hostKind,
    definition,
    ownDefinitions,
    initial,
    onSave,
    onClose,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent
          className="flex max-h-[min(88vh,36rem)] flex-col gap-4 overflow-hidden sm:max-w-[46rem]"
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0">{ui.formulas.typeFormula.title}</span>
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                {definition.name}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              {ui.formulas.typeFormula.hint}
            </p>
            <FormulaLine
              rootRef={rootRef}
              empty={empty}
              error={parse.error}
              resultText={ui.formulas.typeFormula.previewHint}
              resultEmpty={false}
              issues={issues}
              autocomplete={autocomplete}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onInsertText={insertText}
              onApplyAutocomplete={applyAutocomplete}
            />
            <div className="grid min-h-[18rem] flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-3">
              <aside className="min-h-0 overflow-hidden rounded-xl bg-muted/60 dark:bg-background/60">
                <FormulaPalette
                  groups={groups}
                  onInsertField={insertField}
                  onInsertAggregate={(aggregate) =>
                    setAggregateDialog({ open: true, initial: aggregate })
                  }
                />
              </aside>
              <FormulaFunctionsPanel
                onInsertText={insertText}
                onOpenAggregate={() => setAggregateDialog({ open: true, initial: null })}
              />
            </div>
          </div>

          <DialogFooter className="items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-danger hover:text-danger"
              disabled={initial === null}
              onClick={handleRemove}
            >
              {ui.formulas.typeFormula.remove}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ui.formulas.editor.cancel}
            </Button>
            <Button type="button" disabled={!parse.ast} onClick={handleSave}>
              {ui.formulas.typeFormula.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FormulaAggregateDialog
        open={aggregateDialog.open}
        initial={aggregateDialog.initial}
        hostKind={hostKind}
        definitions={definitions.data ?? []}
        kinds={kinds.data ?? []}
        onClose={() => setAggregateDialog({ open: false, initial: null })}
        onApply={(aggregate) => {
          insertAggregate(aggregate);
          setAggregateDialog({ open: false, initial: null });
        }}
      />
    </>
  );
}
