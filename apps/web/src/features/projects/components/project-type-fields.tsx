import { useState } from 'react';
import { X } from 'lucide-react';
import type { FieldFormState, ProjectType, ProjectTypeForm } from '@nodus/contracts';
import { projectTypeFormOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { CustomFieldTypeIcon } from '../../../shared/custom-fields/field-type-icon.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { Segmented } from '../../../shared/ui/panel/panel-kit.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { stateOptions } from '../node-kinds/components/node-kind-summary.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectTypeFieldPicker } from './project-type-field-picker.js';

/**
 * Раздел «Атрибуты» типа проекта (#631, Р10): слоты формы типа — атрибут ×
 * состояние «Скрыто / По желанию / Обязательно», грамматика раздела «При
 * создании папки» вида папки. Форма сохраняется целиком на каждое
 * изменение; сервер вместе со слотом привязывает атрибут к типу (и снимает
 * привязку убранного) — диалоги проекта показывают атрибуты формы типа.
 */
export function ProjectTypeFieldsSection({
  type,
  canSetup,
  canCreateField,
  renderCreateField,
}: {
  type: ProjectType;
  /** Право `project.setup.manage` — правка; иначе только просмотр. */
  canSetup: boolean;
  canCreateField: boolean;
  renderCreateField?: RenderCreateField;
}) {
  const update = useUpdateProjectType();
  const form = projectTypeFormOf(type);
  const query = useCustomFieldDefinitions('project');
  const byId = new Map((query.data ?? []).map((definition) => [definition.id, definition]));
  const [createField, setCreateField] = useState(false);

  function save(next: ProjectTypeForm) {
    if (!canSetup) return;
    update.mutate({ id: type.id, form: next });
  }

  function setState(fieldId: string, state: FieldFormState) {
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
        <p className="text-xs break-words text-muted-foreground">
          {ui.customFields.typeForm.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
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
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    title={definition?.name ?? undefined}
                  >
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
        <ProjectTypeFieldPicker
          inForm={new Set(form.fields.map((slot) => slot.fieldId))}
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
