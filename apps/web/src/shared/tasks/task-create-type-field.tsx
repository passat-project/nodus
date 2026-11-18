import type { ProcessType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { ProcessTypeField } from './process-type-field.js';

/**
 * Строка типа окна создания задачи (#432, #665): тип и «⋯» настроек в одной
 * колонке с названием. Вынесена из окна ради лимита строк — поведение то же:
 * смена типа не стирает совместимый черновик, настройки открывают панель
 * типа поверх окна.
 */
export function TaskCreateTypeField({
  types,
  value,
  disabled,
  showSettings,
  dirty,
  onChange,
  onLeave,
}: {
  types: readonly ProcessType[];
  value: string;
  disabled: boolean;
  showSettings: boolean;
  dirty: boolean;
  onChange: (typeId: string) => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <NodeLabel label={ui.taskCreate.typeLabel} />
      <ProcessTypeField
        types={types}
        value={value}
        disabled={disabled}
        showSettings={showSettings}
        dirty={dirty}
        onChange={onChange}
        onLeave={onLeave}
      />
    </div>
  );
}
