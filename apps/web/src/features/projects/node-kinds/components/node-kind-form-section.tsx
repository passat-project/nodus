import { X } from 'lucide-react';
import { useState } from 'react';
import type { NodeKind, NodeKindFieldState, NodeKindForm } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { Segmented } from '../../../../shared/ui/panel/panel-kit.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindFieldPicker } from './node-kind-field-picker.js';
import { stateOptions } from './node-kind-summary.js';

/**
 * Раздел «При создании папки» (#556, §4c): шифр и атрибуты области «Папка»
 * в состояниях «Скрыто / По желанию / Обязательно». Раздел сохраняется
 * целиком при каждом изменении (как форма типа процесса). Слот скрытого в
 * «Атрибутах» определения — приглушён с меткой и не редактируется
 * (сервер не пустит смену состояния), но сохраняется и убирается «×».
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

  function setCode(code: NodeKindFieldState) {
    save({ ...form, code });
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{ui.nodeKinds.form.codeLabel}</span>
        <Segmented
          value={form.code}
          options={stateOptions()}
          disabled={!canSetup}
          onChange={setCode}
        />
      </div>

      {form.fields.length === 0 ? (
        <p className="text-xs break-words text-muted-foreground">{ui.nodeKinds.form.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {form.fields.map((slot) => {
            const definition = byId.get(slot.fieldId);
            const hidden = definition?.hidden ?? false;
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
                  <span
                    className={
                      hidden
                        ? 'min-w-0 flex-1 truncate text-sm text-muted-foreground'
                        : 'min-w-0 flex-1 truncate text-sm'
                    }
                  >
                    {definition?.name ?? ui.customFields.issues.unknown}
                  </span>
                  {hidden ? (
                    <NodeChip tone="muted">{ui.nodeKinds.form.hiddenInRegistry}</NodeChip>
                  ) : null}
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
                  value={slot.state}
                  options={stateOptions()}
                  disabled={!canSetup || hidden}
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
