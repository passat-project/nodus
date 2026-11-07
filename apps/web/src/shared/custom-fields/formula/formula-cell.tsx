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
import { toast } from 'sonner';

import { CustomFieldEditor } from '../value-editor.js';
import type { FormulaHost } from './formula-api.js';
import { useRemoveFormula } from './formula-api.js';
import { FormulaEditor, type FormulaHostContext } from './formula-editor.js';
import { cleanEmptyMarker, cleanFormulaText, saveErrorText } from './formula-preview.js';
import { FormulaRemoveDialog } from './formula-remove-dialog.js';

/** Любая формула в ячейке (своя или типа) замораживает правку значения:
 *  снять её можно только явным действием в редакторе формулы. */
export function formulaCellFrozen(origin: CustomFieldFormulaInfo['origin'] | null): boolean {
  return origin === 'own' || origin === 'type';
}

/**
 * Ячейка атрибута с формулой (#632, §4c): значение + мини-значок fx,
 * меню «Изменить формулу / Убрать формулу / Как у типа», бейдж ошибки.
 * Своя формула делает значение read-only ВСЕГДА: вписать значение можно
 * только после «Убрать формулу» (Р5). Формула типа показывается значком,
 * правка значения её подавляет — сервер вернёт origin `value`, и появится
 * «Как у типа».
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
  const [removeOpen, setRemoveOpen] = useState(false);
  const origin = info?.origin ?? null;
  const own = origin === 'own';
  const typeFormula = origin === 'type';
  const suppressed = origin === 'value';
  // Формула — любого происхождения: своя ИЛИ типа. Ячейка заморожена сразу,
  // как только формула есть в DTO, а не после «сохранить» (иначе формула
  // типа оставалась редактируемой до превращения в свою).
  const frozen = formulaCellFrozen(origin);
  // Уже материализованное значение могло сохраниться с `--`/`—` до фикса
  // движка: показываем его очищенным, не дожидаясь пересчёта.
  // own/type — чистим висячие разделители; ручное значение поверх формулы
  // (`origin='value'`) — только легаси-маркер «пусто» из дефисов.
  const shownValue = !info ? value : frozen ? cleanFormulaText(value) : cleanEmptyMarker(value);

  useEffect(() => {
    if (!own) setRemoveOpen(false);
  }, [own]);

  return (
    // data-testid — адрес ячейки для живых e2e (#632): меню «⋯» есть у каждой
    // строки атрибутов, и без адреса по полю спека не отличит шифр от марки.
    <div
      className="group/formula flex min-w-0 items-center gap-1"
      data-testid="formula-cell"
      data-field-id={definition.id}
    >
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
        {frozen ? (
          <CustomFieldEditor
            definition={definition}
            value={shownValue ?? undefined}
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
          <DropdownMenuContent align="end" sideOffset={4} className="w-auto min-w-36">
            <DropdownMenuItem onClick={() => setEditorOpen(true)}>
              {info ? ui.formulas.cell.edit : ui.formulas.editor.title}
            </DropdownMenuItem>
            {suppressed ? (
              <DropdownMenuItem onClick={() => onChange(definition.id, null)}>
                {ui.formulas.cell.asType}
              </DropdownMenuItem>
            ) : null}
            {own ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
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
          readOnly={!canEdit}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
      <FormulaRemoveDialog
        open={removeOpen}
        pending={remove.isPending}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() =>
          remove.mutate(definition.id, {
            onSuccess: () => setRemoveOpen(false),
            // Сеть/права: окно не «зависает» молча — причина видна тостом.
            onError: (error) => toast.error(saveErrorText(error)),
          })
        }
      />
    </div>
  );
}
