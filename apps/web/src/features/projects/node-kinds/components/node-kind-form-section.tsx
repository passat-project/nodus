import { useMemo, useState } from 'react';
import type { NodeKind, NodeKindForm } from '@nodus/contracts';
import { bindingsOf, formSlots, isFormDecor, nodeKindFormOf, ui } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { AttributeWindowBuilder } from '../../../../shared/forms/attribute-window-builder.js';
import type { AttributeElement } from '../../../../shared/forms/attribute-form-model.js';
import { isSlotElement } from '../../../../shared/forms/attribute-form-model.js';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { PreviewControl } from '../../../../shared/forms/builder/preview-control.js';
import { SectionLink } from '../../../../shared/ui/panel/panel-kit.js';
import type { RenderCreateField } from '../types.js';

const b = ui.forms.builder;

/**
 * Раздел «При создании папки» (#556; #496 — единый путь настройки): только
 * вход в редактор окна и сводка. Атрибуты, состояния, подписи, ширина,
 * оформление и порядок — в общем редакторе окна, как у задачи и кнопки.
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
  const [open, setOpen] = useState(false);
  const [createField, setCreateField] = useState(false);
  const definitions = useMemo(
    () =>
      (query.data ?? []).filter((definition) =>
        bindingsOf(definition).nodeKindIds.includes(kind.id),
      ),
    [query.data, kind.id],
  );
  // Сводка окна в панели: что спросит папка этого вида, по порядку.
  const summary = form.fields.flatMap((element) => {
    if (isFormDecor(element) || !isSlotElement(element)) return [];
    const name = definitions.find((definition) => definition.id === element.fieldId)?.name;
    return [name ?? b.unknownField];
  });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Вход в редактор — строка раздела с шевроном, как в остальных
          панелях (#496, замечание владельца 08.11.2026). */}
      <SectionLink
        title={canSetup ? b.edit : b.view}
        summary={formSlots(form).length === 0 ? ui.nodeKinds.form.empty : summary.join(', ')}
        onClick={() => setOpen(true)}
      />
      <AttributeWindowBuilder
        open={open}
        title={`${b.titles.folder} · ${kind.name}`}
        elements={form.fields}
        definitions={definitions}
        formulaHostKind="node"
        readOnly={!canSetup}
        fixedTop={<NodeKindFixedRows kindName={kind.name} />}
        onCreateField={canCreateField && renderCreateField ? () => setCreateField(true) : undefined}
        onDone={(elements: AttributeElement[]) => {
          onSave({ ...form, fields: elements } as NodeKindForm);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
      {createField && renderCreateField
        ? renderCreateField({
            onClose: () => setCreateField(false),
            onCreated: () => setCreateField(false),
          })
        : null}
    </div>
  );
}

/** Неподвижный верх окна папки: название и вид — всегда первыми. */
function NodeKindFixedRows({ kindName }: { kindName: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-2" title={b.fixedRow}>
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-input/30">
        {ui.structure.nodeName}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <NodeLabel label={ui.structure.nodeKind} />
        <span className="relative">
          <PreviewControl kind="select" />
          <span className="absolute inset-y-0 left-2.5 flex items-center truncate text-sm">
            {kindName}
          </span>
        </span>
      </div>
    </div>
  );
}
