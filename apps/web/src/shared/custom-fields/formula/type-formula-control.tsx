import { useState } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldType,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { formulaToText, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { TypeFormulaDialog } from './type-formula-dialog.js';

/**
 * Блок «Формула» в настройках места (#632, Р6): формула типа/вида у слота
 * формы. Показывает заданную формулу текстом и открывает конструктор.
 * Значение считается у всех записей места, пока у записи нет своего.
 */
export function TypeFormulaControl({
  hostKind,
  definition,
  targetType,
  label,
  ownDefinitions,
  value,
  readOnly,
  onChange,
}: {
  hostKind: FormulaHostKind;
  /** Атрибут-ячейка (если слот — атрибут); у системного поля null. */
  definition?: CustomFieldDefinition;
  /** Тип результата системного поля окна (когда определения нет). */
  targetType?: CustomFieldType;
  /** Подпись слота, если определения нет. */
  label?: string;
  /** Атрибуты места — палитра «Свои поля» конструктора. */
  ownDefinitions: readonly CustomFieldDefinition[];
  value: FormulaNode | null;
  readOnly: boolean;
  onChange: (formula: FormulaNode | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelOf = (number: number, fallback?: string) =>
    ownDefinitions.find((entry) => entry.number === number)?.name ?? fallback ?? `#${number}`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => setOpen(true)}
        >
          {value ? ui.formulas.typeFormula.edit : ui.formulas.typeFormula.set}
        </Button>
        {value && !readOnly ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {ui.formulas.typeFormula.remove}
          </Button>
        ) : null}
      </div>
      <p className="min-w-0 text-xs break-words text-muted-foreground">
        {value ? formulaToText(value, labelOf) : ui.formulas.typeFormula.none}
      </p>
      {open ? (
        <TypeFormulaDialog
          open={open}
          hostKind={hostKind}
          {...(definition ? { definition } : {})}
          {...(targetType ? { targetType } : {})}
          {...(label ? { label } : {})}
          ownDefinitions={ownDefinitions}
          initial={value}
          onSave={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
