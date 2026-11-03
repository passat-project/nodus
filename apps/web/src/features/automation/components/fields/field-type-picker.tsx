import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../../../shared/api/projects-available.js';
import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { FIELD_FAMILIES, baseTypeOf, type FieldFamily } from '../../lib/field-type-families.js';

/**
 * Колонка типов окна атрибута: вертикальный список 13 семейств (иконка +
 * название, подсказка — title), выбранный — ступень `bg-accent`, как строка
 * списка типов процессов. После создания тип зафиксирован: остальные
 * семейства недоступны (менять тип — новым атрибутом; модификаторы —
 * в «Настройках»). «Проект» до модуля проектов — недоступен с честной
 * подсказкой (Р11).
 */
export function FieldTypePicker({
  value,
  locked,
  disabled,
  canManageDictionaries,
  onChange,
}: {
  value: FieldFamily | null;
  locked: boolean;
  disabled: boolean;
  /** Право `dictionary.manage`: без него списки не создать (#491). */
  canManageDictionaries: boolean;
  onChange: (family: FieldFamily) => void;
}) {
  const projectsReady = projectsAvailable();
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <NodeLabel label={ui.customFields.dialog.type} />
      <div
        role="radiogroup"
        aria-label={ui.customFields.dialog.type}
        className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1"
      >
        {FIELD_FAMILIES.map((family) => {
          const unavailableReason: keyof typeof ui.customFields.typeUnavailable | null =
            family === 'project' && !projectsReady
              ? 'project'
              : family === 'list' && !canManageDictionaries
                ? 'dictionaries'
                : null;
          const unavailable = unavailableReason !== null;
          const active = value === family;
          const off = disabled || unavailable || (locked && !active);
          return (
            <button
              key={family}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={off}
              title={
                unavailableReason
                  ? ui.customFields.typeUnavailable[unavailableReason]
                  : locked && !active
                    ? ui.customFields.dialog.typeLocked
                    : ui.customFields.familyHints[family]
              }
              onClick={() => onChange(family)}
              className={cn(
                'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-secondary-foreground hover:bg-accent/40',
                off && !active && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <CustomFieldTypeIcon
                type={baseTypeOf(family)}
                className={cn(
                  'size-4 shrink-0',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0 truncate">{ui.customFields.families[family]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
