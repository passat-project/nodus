import { useState, type ReactNode } from 'react';
import { Calculator, CircleAlert, Link } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldFormulaInfo,
  CustomFieldRef,
  CustomFieldValue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldEditor } from '../value-editor.js';
import type { FormulaHost } from './formula-api.js';
import { FormulaEditor, type FormulaHostContext } from './formula-editor.js';
import { cleanFormulaText } from './formula-preview.js';

/** Любая формула в ячейке (своя или типа) замораживает правку значения:
 *  формульная ячейка руками не пишется вовсе (решение владельца по #660) —
 *  снять свою формулу можно только в редакторе формулы. */
export function formulaCellFrozen(origin: CustomFieldFormulaInfo['origin'] | null): boolean {
  return origin === 'own' || origin === 'type';
}

/**
 * Ячейка атрибута с формулой (#632, §4c): значение + мини-значок fx, у
 * наследованной формулы типа — значок цепочки (местная/наследованная
 * различимы с одного взгляда), бейдж ошибки. Кнопка-калькулятор открывает
 * редактор формул: своя формула — правка и удаление в самом редакторе;
 * формула типа — только просмотр (правится в «Атрибутах»).
 */
export function FormulaCell({
  definition,
  host,
  hostContext,
  info,
  value,
  refs,
  canEdit,
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
  /** Обычный редактор значения (для ячейки без формулы). */
  children: ReactNode;
  /** Атрибуты места хоста — палитра «Свои поля» редактора. */
  ownDefinitions: readonly CustomFieldDefinition[];
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const origin = info?.origin ?? null;
  const own = origin === 'own';
  const typeFormula = origin === 'type';
  // Формула — любого происхождения: своя ИЛИ типа. Ячейка заморожена сразу,
  // как только формула есть в DTO.
  const frozen = formulaCellFrozen(origin);
  // Уже материализованное значение могло сохраниться с `--`/`—` до фикса
  // движка: показываем его очищенным, не дожидаясь пересчёта.
  const shownValue = frozen ? cleanFormulaText(value) : value;

  return (
    // data-testid — адрес ячейки для живых e2e (#632): формульная строка
    // атрибутов адресуется по полю, иначе спека не отличит шифр от марки.
    <div
      className="group/formula flex min-w-0 items-center gap-1"
      data-testid="formula-cell"
      data-field-id={definition.id}
    >
      {/* Значок формулы — левый жёлоб строки: «fx» моно 11px (данные, не
          метка), тихий до наведения; своя формула кликабельна (открывает
          редактор), формула типа — пометка fx + наклонное звено цепи
          (классический значок «связь с источником», выбор владельца). */}
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
          className="-ml-0.5 flex h-5 shrink-0 cursor-default items-center gap-0.5 rounded-md px-1 font-mono text-label-xs font-medium text-muted-foreground/70"
        >
          fx
          <Link className="size-2" strokeWidth={2} aria-label={ui.formulas.cell.inherited} />
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
        {/* Пустой результат формулы — пустая ячейка, без дефисов и
            «Не задано»: формула честно говорит «нечего показать». */}
        {frozen ? (
          shownValue === undefined || shownValue === null ? null : (
            <CustomFieldEditor
              definition={definition}
              value={shownValue}
              refs={refs}
              disabled
              variant="inline"
              onCommit={() => undefined}
            />
          )
        ) : (
          children
        )}
      </div>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={info ? ui.formulas.cell.edit : ui.formulas.cell.set}
          aria-label={info ? ui.formulas.cell.edit : ui.formulas.cell.set}
          onClick={() => setEditorOpen(true)}
          className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/formula:opacity-100 focus-visible:opacity-100"
        >
          <Calculator className="size-3.5" strokeWidth={1.75} />
        </Button>
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
    </div>
  );
}
