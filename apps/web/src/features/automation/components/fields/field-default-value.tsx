import type {
  CustomFieldDefault,
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';
import { SEGMENTED_ACTIVE_TONAL, SegmentedControl } from '../../../../shared/ui/segmented-control.js';
import type { DefaultMode } from '../../lib/field-draft.js';

type Mode = DefaultMode;

/**
 * Значение по умолчанию в окне атрибута (#431, Р5): «Нет», «Значение»
 * (тот же редактор, что в карточке, — одна грамматика) и «Подразделение
 * автора» (только у подразделения). Режим — общий сегментированный
 * переключатель; правка идёт в черновик окна, не на сервер.
 */
export function FieldDefaultValue({
  definition,
  value,
  refs,
  mode,
  disabled,
  onModeChange,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldDefault | null;
  refs: readonly CustomFieldRef[];
  mode: Mode;
  disabled: boolean;
  onModeChange: (mode: Mode) => void;
  onChange: (value: CustomFieldDefault | null, refs: CustomFieldRef[]) => void;
}) {
  // Умолчание-ссылка на запись запрещено (Р5 #631): умолчания применяются
  // без актёра видимости, такая ссылка не прошла бы проверку и молча
  // отбрасывалась. Не предлагаем режим, который сервер отвергнет.
  const recordRef = ['task', 'letter', 'node', 'project'].includes(definition.type);
  const options: { value: Mode; label: string }[] = [
    { value: 'none', label: ui.customFields.dialog.defaultNone },
    ...(recordRef
      ? []
      : [{ value: 'static' as const, label: ui.customFields.dialog.defaultStatic }]),
    ...(definition.type === 'department'
      ? [
          {
            value: 'author_department' as const,
            label: ui.customFields.dialog.defaultAuthorDepartment,
          },
        ]
      : []),
  ];
  const staticValue = value?.kind === 'static' ? value.value : undefined;

  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        value={mode}
        options={options}
        disabled={disabled}
        ariaLabel={ui.customFields.dialog.defaultValue}
        className="w-fit [&>button]:flex-none"
        size="sm"
        activeClassName={SEGMENTED_ACTIVE_TONAL}
        onChange={(next) => {
          onModeChange(next);
          if (next === 'none') onChange(null, []);
          if (next === 'author_department') onChange({ kind: 'author_department' }, []);
        }}
      />
      {mode === 'static' && recordRef ? (
        <p className="text-xs text-muted-foreground">{ui.customFields.dialog.defaultRecordHint}</p>
      ) : null}
      {mode === 'static' && !recordRef ? (
        <CustomFieldEditor
          definition={definition}
          value={staticValue}
          refs={refs}
          disabled={disabled}
          variant="form"
          onCommit={(next: CustomFieldValue | null, picked?: CustomFieldRef[]) =>
            onChange(next === null ? null : { kind: 'static', value: next }, picked ?? [])
          }
        />
      ) : null}
      {mode === 'author_department' ? (
        <p className="text-xs text-muted-foreground">
          {ui.customFields.dialog.defaultAuthorDepartmentHint}
        </p>
      ) : null}
    </div>
  );
}
