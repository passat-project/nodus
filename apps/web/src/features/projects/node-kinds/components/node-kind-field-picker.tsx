import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { NodeKind } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { PanelAction } from '../../../../shared/ui/panel/panel-kit.js';

/**
 * Поповер «Атрибуты папок» (#556, §4c): атрибуты области «Папка», которых
 * ещё нет в форме вида (скрытые в «Атрибутах» не предлагаются — они не
 * показываются никому). Внизу — «Создать атрибут…» (слот app-композиции,
 * только при праве `custom_field.manage`). Новый слот — «По желанию».
 */
export function NodeKindFieldPicker({
  kind,
  disabled,
  canCreateField,
  onPick,
  onCreateField,
}: {
  kind: NodeKind;
  disabled: boolean;
  canCreateField: boolean;
  onPick: (fieldId: string) => void;
  onCreateField?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const query = useCustomFieldDefinitions('node');
  const inForm = new Set(nodeKindFormOf(kind).fields.map((slot) => slot.fieldId));
  const options = (query.data ?? []).filter(
    (definition) => !definition.hidden && !inForm.has(definition.id),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PanelAction icon={Plus} disabled={disabled || query.isLoading}>
          {ui.nodeKinds.form.addField}
        </PanelAction>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-0.5 p-1.5">
        <span className="px-2 py-1 text-xs text-muted-foreground">
          {ui.nodeKinds.form.pickerTitle}
        </span>
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
        {canCreateField && onCreateField ? (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreateField();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
              {ui.nodeKinds.form.createField}
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
