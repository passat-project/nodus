import { Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
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
import { FormulaLine } from './formula-line.js';
import { FormulaPalette } from './formula-palette.js';
import { previewText } from './formula-preview.js';
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
 *
 * Геометрия окна (#632, вкус): окно НЕ выше 88vh — заголовок и футер всегда
 * видны, прокручиваются только панели (канон диалогов: max-height + внутренний
 * скролл). Ширина — `sm:max-w-*`: базовый `sm:max-w-sm` примитива сильнее
 * `max-w-*` по порядку в таблице стилей, поэтому широкое окно задаётся тем же
 * вариантом. Панели — ступень тона без рамок (секции разделяет тон, не линии).
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
  // Формула типа/вида приходит как основа для правки: сохранение создаст
  // собственную формулу записи, тип не меняется (Р6).
  const origin = cell.data?.origin ?? null;

  // Ошибка строки — одна плашка: разбор сильнее оценки (нераспознанная
  // формула не считается вовсе). Проблемы структуры (issues) блокируют
  // сохранение — вторая строка ниже, тише плашки.
  const error = parse.error ?? preview.error;
  const resultText = previewText(preview.value, definition);
  const resultEmpty = preview.value === null || preview.value === undefined;

  // Курсор — в строку формулы, в КОНЕЦ (окно открывается на загрузке ячейки,
  // поэтому не через onOpenAutoFocus: узла ещё нет). Иначе фокус-ловушка
  // Radix встаёт на первую кнопку футера — «Убрать формулу» при своей формуле.
  useEffect(() => {
    if (!open || cell.isLoading) return;
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [open, cell.isLoading, rootRef]);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent
          className="flex max-h-[min(88vh,36rem)] flex-col gap-4 overflow-hidden sm:max-w-[46rem]"
          showCloseButton={false}
          // Формула — набранный руками текст: мимо-клик не должен его терять
          // (канон окон с пополняемыми данными). Выход — «Отмена» или Esc.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0">{ui.formulas.editor.title}</span>
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                {definition.name}
              </span>
            </DialogTitle>
          </DialogHeader>
          {cell.isLoading ? (
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="min-h-40 w-full flex-1 rounded-xl" />
            </div>
          ) : cell.isError ? (
            <div className="flex flex-1 flex-col items-start gap-2 text-xs text-muted-foreground">
              <span>{ui.formulas.editor.loadError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2"
                onClick={() => void cell.refetch()}
              >
                {ui.formulas.editor.retry}
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {origin === 'type' || origin === 'value' ? (
                <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
                  {origin === 'type' ? ui.formulas.editor.typeBase : ui.formulas.editor.valueBase}
                </p>
              ) : null}
              <FormulaLine
                rootRef={rootRef}
                empty={empty}
                error={error}
                resultText={resultText}
                resultEmpty={resultEmpty}
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
          )}

          <DialogFooter className="items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-danger hover:text-danger"
              disabled={remove.isPending || origin !== 'own'}
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
