import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { CustomFieldTypeIcon } from '../../../shared/custom-fields/field-type-icon.js';
import { PanelAction } from '../../../shared/ui/panel/panel-kit.js';

/** Заголовок поповера: атрибуты области «Проекты» (аналог «Атрибуты папок»
 *  у вида папки; своего ключа в ui.projects нет — литерал). */
const PICKER_TITLE = 'Атрибуты проектов';

/**
 * Поповер добавления атрибута в форму типа проекта (#631, Р10): атрибуты
 * области «Проекты», которых ещё нет в форме. Добавленный слот получает
 * состояние «По желанию»; сервер вместе со слотом привязывает атрибут
 * к типу (мок повторяет). Создания атрибута здесь нет — реестр «Атрибуты»
 * во вкладке «Автоматизация».
 */
export function ProjectTypeFieldPicker({
  inForm,
  disabled,
  onPick,
}: {
  /** fieldId слотов текущей формы типа. */
  inForm: ReadonlySet<string>;
  disabled: boolean;
  onPick: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const query = useCustomFieldDefinitions('project');
  const options = (query.data ?? []).filter((definition) => !inForm.has(definition.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PanelAction icon={Plus} disabled={disabled || query.isLoading}>
          {ui.nodeKinds.form.addField}
        </PanelAction>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-0.5 p-1.5">
        <span className="px-2 py-1 text-xs text-muted-foreground">{PICKER_TITLE}</span>
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" role="listbox">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {query.isLoading ? ui.common.empty : ui.nodeKinds.form.pickerEmpty}
            </p>
          ) : (
            options.map((definition) => (
              <button
                key={definition.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(definition.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
              >
                <CustomFieldTypeIcon
                  type={definition.type}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{definition.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
