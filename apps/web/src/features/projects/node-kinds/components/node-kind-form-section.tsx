import { X } from 'lucide-react';
import { useState } from 'react';
import type { NodeKind, NodeKindFieldState, NodeKindForm } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { Segmented } from '../../../../shared/ui/panel/panel-kit.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindFieldPicker } from './node-kind-field-picker.js';
import { stateOptions } from './node-kind-summary.js';

/**
 * Раздел «При создании папки» (#556, §4c): атрибуты, привязанные к виду, в
 * состояниях «Скрыто / По желанию / Обязательно» — код папки идёт обычным
 * атрибутом «Код» (ревизия #631). Раздел сохраняется целиком при каждом
 * изменении (как форма типа процесса); привязка живёт в реестре атрибутов.
 */
export function NodeKindFormSection({
  kind,
  canSetup,
  canCreateField,
  renderCreateField,
  onSave,
}: {
  kind: NodeKind;
  canSetup: boolean;
  canCreateField: boolean;
  renderCreateField?: RenderCreateField;
  onSave: (form: NodeKindForm) => void;
}) {
  const form = nodeKindFormOf(kind);
  const query = useCustomFieldDefinitions('node');
  const byId = new Map((query.data ?? []).map((definition) => [definition.id, definition]));
  const [createField, setCreateField] = useState(false);

  function save(next: NodeKindForm) {
    if (!canSetup) return;
    onSave(next);
  }

  function setState(fieldId: string, state: NodeKindFieldState) {
    save({
      ...form,
      fields: form.fields.map((slot) => (slot.fieldId === fieldId ? { ...slot, state } : slot)),
    });
  }

  function remove(fieldId: string) {
    save({ ...form, fields: form.fields.filter((slot) => slot.fieldId !== fieldId) });
  }

  function add(fieldId: string) {
    if (form.fields.some((slot) => slot.fieldId === fieldId)) return;
    save({ ...form, fields: [...form.fields, { fieldId, state: 'optional' }] });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {form.fields.length === 0 ? (
        <p className="text-xs break-words text-muted-foreground">{ui.nodeKinds.form.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {form.fields.map((slot) => {
            const definition = byId.get(slot.fieldId);
            return (
              <li
                key={slot.fieldId}
                className="flex min-w-0 flex-col gap-1.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-accent/40"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {definition ? (
                    <CustomFieldTypeIcon
                      type={definition.type}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {definition?.name ?? ui.customFields.issues.unknown}
                  </span>
                  {canSetup ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={ui.nodeKinds.form.remove}
                      title={ui.nodeKinds.form.remove}
                      className="shrink-0 text-muted-foreground"
                      onClick={() => remove(slot.fieldId)}
                    >
                      <X className="size-3.5" strokeWidth={2} />
                    </Button>
                  ) : null}
                </div>
                <Segmented
                  layout="grid"
                  className="w-full"
                  value={slot.state}
                  options={stateOptions()}
                  disabled={!canSetup}
                  onChange={(state) => setState(slot.fieldId, state)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {canSetup ? (
        <NodeKindFieldPicker
          kind={kind}
          disabled={!canSetup}
          canCreateField={canCreateField}
          onPick={add}
          onCreateField={renderCreateField ? () => setCreateField(true) : undefined}
        />
      ) : null}

      {createField && renderCreateField
        ? renderCreateField({
            onClose: () => setCreateField(false),
            onCreated: (fieldId) => {
              setCreateField(false);
              add(fieldId);
            },
          })
        : null}
    </div>
  );
}
