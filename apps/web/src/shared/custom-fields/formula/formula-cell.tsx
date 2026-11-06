import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, MoreHorizontal } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldFormulaInfo,
  CustomFieldRef,
  CustomFieldValue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldEditor } from '../value-editor.js';
import type { FormulaHost } from './formula-api.js';
import { useRemoveFormula } from './formula-api.js';
import { FormulaEditor, type FormulaHostContext } from './formula-editor.js';

/**
 * Ячейка атрибута с формулой (#632, §4c): значение + мини-значок fx,
 * меню «Изменить формулу / Вписать значение / Убрать формулу / Как у типа»,
 * бейдж ошибки. Своя формула делает значение read-only (правка = снять
 * формулу, Р5); формула типа показывается значком, правка значения её
 * подавляет — сервер вернёт origin `value`, и появится «Как у типа».
 */
export function FormulaCell({
  definition,
  host,
  hostContext,
  info,
  value,
  refs,
  canEdit,
  onChange,
  children,
  ownDefinitions,
}: {
  definition: CustomFieldDefinition;
  host: FormulaHost;
  hostContext: FormulaHostContext;
  info: CustomFieldFormulaInfo | undefined;
  value: CustomFieldValue | undefined;
  refs: readonly CustomFieldRef[];
  canEdit: boolean;
  onChange: (fieldId: string, value: CustomFieldValue | null, refs?: CustomFieldRef[]) => void;
  /** Обычный редактор значения (для режима «значение» и «вписать руками»). */
  children: ReactNode;
  /** Атрибуты места хоста — палитра «Свои поля» редактора. */
  ownDefinitions: readonly CustomFieldDefinition[];
}) {
  const remove = useRemoveFormula(host);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const origin = info?.origin ?? null;
  const own = origin === 'own';
  const typeFormula = origin === 'type';
  const suppressed = origin === 'value';

  useEffect(() => {
    if (!own) setEditing(false);
  }, [own]);

  return (
    <div className="group/formula flex min-w-0 items-center gap-1">
      {/* Значок формулы — левый жёлоб строки: «fx» моно 11px (данные, не метка),
          тихий до наведения; своя формула кликабельна (открывает редактор),
          формула типа — только пометка. */}
      {own ? (
        <button
          type="button"
          title={ui.formulas.cell.own}
          aria-label={ui.formulas.cell.own}
          onClick={() => setEditorOpen(true)}
          className="-ml-0.5 flex h-5 shrink-0 items-center rounded-md px-1 font-mono text-label-xs font-medium text-info/70 transition-colors hover:bg-info/10 hover:text-info focus-visible:bg-info/10 focus-visible:text-info focus-visible:outline-none"
        >
          fx
        </button>
      ) : typeFormula ? (
        <span
          title={ui.formulas.cell.type}
          aria-label={ui.formulas.cell.type}
          className="-ml-0.5 flex h-5 shrink-0 cursor-default items-center rounded-md px-1 font-mono text-label-xs font-medium text-muted-foreground/70"
        >
          fx
        </span>
      ) : null}
      {info?.error ? (
        <button
          type="button"
          title={`${ui.formulas.cell.error}: ${ui.formulas.errors[info.error.code]}`}
          aria-label={ui.formulas.cell.error}
          onClick={() => (own ? setEditorOpen(true) : undefined)}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger transition-colors',
            own && 'cursor-pointer hover:bg-danger/15',
          )}
        >
          <CircleAlert className="size-3" strokeWidth={2.25} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        {own && !editing ? (
          <CustomFieldEditor
            definition={definition}
            value={value}
            refs={refs}
            disabled
            variant="inline"
            onCommit={() => undefined}
          />
        ) : (
          children
        )}
      </div>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ui.formulas.cell.own}
              className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/formula:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              {/* Меню — всегда «⋯»: второй значок «fx» рядом с левым сбивал
                  (две одинаковые пометки в строке). */}
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setEditorOpen(true)}>
              {own ? ui.formulas.cell.edit : ui.formulas.editor.title}
            </DropdownMenuItem>
            {own ? (
              <DropdownMenuItem onClick={() => setEditing(true)}>
                {ui.formulas.cell.writeValue}
              </DropdownMenuItem>
            ) : null}
            {suppressed ? (
              <DropdownMenuItem onClick={() => onChange(definition.id, null)}>
                {ui.formulas.cell.asType}
              </DropdownMenuItem>
            ) : null}
            {own ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => remove.mutate(definition.id)}
                >
                  {ui.formulas.cell.remove}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {editorOpen ? (
        <FormulaEditor
          open={editorOpen}
          host={host}
          fieldId={definition.id}
          definition={definition}
          ownDefinitions={ownDefinitions}
          hostContext={hostContext}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </div>
  );
}
