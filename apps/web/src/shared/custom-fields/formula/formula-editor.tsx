import { Trash2 } from 'lucide-react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { FORMULA_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { FormulaAggregateDialog } from './formula-aggregate-dialog.js';
import { FormulaFunctionsPanel } from './formula-functions-panel.js';
import { FormulaPalette } from './formula-palette.js';
import { issueText, previewText } from './formula-preview.js';
import { useFormulaEditor } from './use-formula-editor.js';
import type { FormulaHost } from './formula-api.js';

/** Контекст места хоста для палитры (есть ли родитель/проект/папки). */
export interface FormulaHostContext {
  parentId?: string | null;
  projectId?: string | null;
  nodeId?: string | null;
}

/**
 * Редактор формул (#632, §4c): строка плашек, палитра источников и функций,
 * живое превью результата/ошибки. У ячейки одна своя формула; формулу
 * типа/вида ставят в настройках типа/вида (Р6), поэтому редактор здесь
 * работает только с собственной формулой ячейки. Состояние — в
 * `useFormulaEditor`, здесь разметка окна.
 */
export function FormulaEditor({
  open,
  host,
  fieldId,
  definition,
  ownDefinitions,
  hostContext,
  onClose,
}: {
  open: boolean;
  host: FormulaHost;
  fieldId: string;
  definition: CustomFieldDefinition;
  /** Атрибуты места хоста — группа «Свои поля». */
  ownDefinitions: readonly CustomFieldDefinition[];
  hostContext: FormulaHostContext;
  onClose: () => void;
}) {
  const {
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
  } = useFormulaEditor({ open, host, fieldId, ownDefinitions, hostContext, onClose });

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent className="max-w-4xl gap-4">
          <DialogHeader>
            <DialogTitle>
              {ui.formulas.editor.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {definition.name}
              </span>
            </DialogTitle>
          </DialogHeader>

          {cell.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : cell.isError ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{ui.formulas.editor.loadError}</span>
              <Button variant="ghost" size="sm" onClick={() => void cell.refetch()}>
                {ui.formulas.editor.retry}
              </Button>
            </div>
          ) : (
            <div className="flex min-h-[440px] flex-col gap-3">
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <span aria-hidden className="mt-0.5 font-mono text-sm text-muted-foreground">
                    =
                  </span>
                  <div className="relative min-w-0 flex-1">
                    <div
                      ref={rootRef}
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label={ui.formulas.editor.title}
                      aria-multiline="false"
                      spellCheck={false}
                      onInput={handleInput}
                      onKeyDown={handleKeyDown}
                      onPaste={(event) => {
                        event.preventDefault();
                        const text = event.clipboardData.getData('text/plain');
                        insertText(text.replace(/[\r\n]+/g, ' '));
                      }}
                      className="min-h-7 w-full font-mono text-[13px] leading-6 break-words whitespace-pre-wrap outline-none"
                    />
                    {empty ? (
                      <span className="pointer-events-none absolute inset-0 font-mono text-[13px] leading-6 text-muted-foreground/70">
                        {ui.formulas.editor.placeholder}
                      </span>
                    ) : null}
                    {autocomplete.open ? (
                      <div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-md">
                        <p className="px-2 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                          {ui.formulas.editor.autocomplete}
                        </p>
                        {autocomplete.items.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyAutocomplete(entry);
                            }}
                            className="flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-accent"
                          >
                            {entry.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{ui.formulas.editor.result}:</span>
                  {parse.error ? (
                    <span className="text-danger">{parse.error}</span>
                  ) : preview.error ? (
                    <span className="text-danger">{preview.error}</span>
                  ) : (
                    <span className="font-mono text-foreground">
                      {previewText(preview.value, definition)}
                    </span>
                  )}
                  {issues.length > 0 ? (
                    <span className="ml-auto text-danger" title={issues.map(issueText).join('\n')}>
                      {issueText(issues[0]!)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3">
                <aside className="min-h-0 rounded-lg border border-border bg-card">
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
              <p className="text-[11px] text-muted-foreground">
                {`${ui.formulas.editor.limitsLabel}: ${FORMULA_LIMITS.nodes} / ${FORMULA_LIMITS.sources}`}
              </p>
            </div>
          )}

          <DialogFooter className="items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-danger hover:text-danger"
              disabled={remove.isPending || cell.data?.ast == null}
              onClick={handleRemove}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              {ui.formulas.editor.remove}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ui.formulas.editor.cancel}
            </Button>
            <Button
              type="button"
              disabled={save.isPending || validate.isPending || !parse.ast}
              onClick={handleSave}
            >
              {ui.formulas.editor.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FormulaAggregateDialog
        open={aggregateDialog.open}
        initial={aggregateDialog.initial}
        hostKind={host.kind}
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
