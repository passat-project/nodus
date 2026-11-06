import type { CustomFieldDefinition, CustomFieldKey, CustomFieldModule } from '@nodus/contracts';
import { bindingsOf, customFieldIdOfKey, customFieldKey, ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';

/**
 * Подгруппа «Атрибуты» в панели кнопки (#431, Р7): флажки атрибутов
 * области в разделах «Окно перехода → Поля» и «Условия → Заполнены поля».
 * Пусто — ссылка во вкладку «Атрибуты».
 */
export function CustomFieldChecks({
  scope,
  typeId,
  selected,
  disabled,
  limit,
  limitHint = ui.automation.window.fieldsLimit,
  onToggle,
}: {
  scope: CustomFieldModule;
  /** Тип процесса: выбираются только привязанные к нему атрибуты (#432, Р8). */
  typeId?: string;
  selected: readonly string[];
  disabled: boolean;
  limit: number;
  limitHint?: string;
  onToggle: (key: CustomFieldKey) => void;
}) {
  const { data = [] } = useCustomFieldDefinitions(scope);
  const isSelected = (definition: CustomFieldDefinition) =>
    selected.some((key) => customFieldIdOfKey(key) === definition.id);
  const typed = scope === 'task' || scope === 'letter';
  const shown = data.filter(
    (definition) =>
      !typeId ||
      !typed ||
      bindingsOf(definition).processTypeIds.includes(typeId) ||
      isSelected(definition),
  );
  // Удалённый атрибут: в реестре его уже нет, но ключ остался в документе
  // маршрута — публикация блокируется `custom_field_unknown`, а снять его
  // было негде. Показываем строку «Атрибут удалён» с активным флажком (#646).
  const knownIds = new Set(data.map((definition) => definition.id));
  const unknown = selected.filter((key) => {
    const id = customFieldIdOfKey(key);
    return id !== null && !knownIds.has(id);
  });
  const atLimit = selected.length >= limit;

  if (shown.length === 0 && unknown.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {ui.automation.window.customFieldsGroup}
        </span>
        <a
          href={`/automation?tab=fields&module=${scope}`}
          className="text-xs text-info underline-offset-2 hover:underline"
        >
          {ui.automation.window.customFieldsEmpty}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {ui.automation.window.customFieldsGroup}
      </span>
      {shown.map((definition) => {
        const key = customFieldKey(definition.id);
        const checked = selected.includes(key);
        return (
          <label key={definition.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={checked}
              disabled={disabled || (!checked && atLimit)}
              onCheckedChange={() => onToggle(key)}
            />
            <span>{definition.name}</span>
          </label>
        );
      })}
      {unknown.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked
            disabled={disabled}
            onCheckedChange={() => onToggle(key as CustomFieldKey)}
          />
          <span className="text-muted-foreground">{ui.automation.creation.unknownAttribute}</span>
        </label>
      ))}
      {atLimit ? <p className="text-xs text-muted-foreground">{limitHint}</p> : null}
    </div>
  );
}
