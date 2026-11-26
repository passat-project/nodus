import { useMemo, useState } from 'react';
import type { NodeKind, NodeKindForm } from '@nodus/contracts';
import { bindingsOf, isFormDecor, nodeKindFormOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { SlidersHorizontal } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { AttributeWindowBuilder } from '../../../../shared/forms/attribute-window-builder.js';
import type { AttributeElement } from '../../../../shared/forms/attribute-form-model.js';
import { isSlotElement } from '../../../../shared/forms/attribute-form-model.js';
import { PreviewControl } from '../../../../shared/forms/builder/preview-control.js';
import { previewOfFieldType } from '../../../../shared/forms/builder/preview-kind.js';
import { CardTabToolbar } from '../../../../shared/ui/entity-card/card-tab-toolbar.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
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
  // Что спросит окно папки этого вида — журнальный список на всю вкладку
  // (ревизия 26.11.2026): поверхность заполнена, редактор окна — по кнопке.
  const rows = useMemo(
    () =>
      form.fields.flatMap((element) => {
        if (isFormDecor(element) || !isSlotElement(element)) return [];
        const definition = definitions.find((entry) => entry.id === element.fieldId);
        return [
          {
            id: element.fieldId,
            name: definition?.name ?? b.unknownField,
            state: element.state,
            preview: previewOfFieldType(definition?.type ?? 'text'),
            hint: element.hint ?? null,
          },
        ];
      }),
    [definitions, form.fields],
  );

  const defs = useMemo<DataTableField<(typeof rows)[number]>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 180,
        maxWidth: 340,
        locked: true,
        render: (row) => (
          <>
            <span className="truncate text-sm font-medium">{row.name}</span>
            {row.state === 'required' ? (
              <NodeChip tone="muted" className="shrink-0">
                {ui.nodeKinds.form.state.required}
              </NodeChip>
            ) : null}
            {row.state === 'hidden' ? (
              <NodeChip tone="muted" className="shrink-0">
                {ui.nodeKinds.form.state.hidden}
              </NodeChip>
            ) : null}
          </>
        ),
        sortValue: (row) => row.name,
      },
      {
        id: 'control',
        label: ui.customFields.columns.type,
        defaultVisible: true,
        defaultWidth: 220,
        minWidth: 140,
        flex: true,
        render: (row) => (
          <span className="w-full max-w-56">
            <PreviewControl kind={row.preview} />
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="size-4" strokeWidth={1.75} />
          {canSetup ? b.edit : b.view}
        </Button>
      </CardTabToolbar>
      <div className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyTitle>{ui.nodeKinds.form.empty}</EmptyTitle>
            </Empty>
          </div>
        ) : (
          <DataTable
            viewKey="processes.kind-form"
            defs={defs}
            rows={rows}
            rowKey={(row) => row.id}
            label={ui.nodeKinds.screen.fieldsForm}
            selectable={false}
            onOpenRow={() => undefined}
          />
        )}
      </div>
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
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-transparent">
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
