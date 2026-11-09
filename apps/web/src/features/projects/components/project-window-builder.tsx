import { useMemo, useState } from 'react';
import type { ProjectType, ProjectTypeForm } from '@nodus/contracts';
import { bindingsOf, projectTypeFormOf, ui, withProjectSystemElements } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { AttributeWindowBuilder } from '../../../shared/forms/attribute-window-builder.js';
import type { AttributeElement } from '../../../shared/forms/attribute-form-model.js';
import type { AttributeSystemInfo } from '../../../shared/forms/attribute-window-builder.js';
import { PreviewControl } from '../../../shared/forms/builder/preview-control.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import type { RenderCreateField } from '../node-kinds/types.js';

const b = ui.forms.builder;

const SYSTEM_INFO: Readonly<Record<string, AttributeSystemInfo>> = {
  manager: { label: ui.projects.manager, preview: 'people' },
  assistants: { label: ui.projects.assistants, preview: 'people' },
  observers: { label: ui.projects.observers, preview: 'people' },
  portfolio: { label: ui.projects.filterPortfolio, preview: 'select' },
  visibility: { label: ui.projects.fieldVisibility, preview: 'select' },
  endDate: { label: ui.projects.deadline, preview: 'date' },
  description: { label: ui.projects.fieldDescription, preview: 'text', multiline: true },
};

/**
 * Окно создания проекта (#496, единое ядро): тот же редактор, что у задачи и
 * кнопки, — вход с узла «Создание проекта» на канвасе схемы (как «создание»
 * в «Процессах»), а не из панели настроек типа. Атрибуты привязываются к типу
 * в справочнике «Атрибуты»; здесь — какие из них и системные строки проекта
 * окно показывает и в каком порядке.
 */
export function ProjectWindowBuilder({
  open,
  type,
  canSetup,
  canCreateField,
  renderCreateField,
  onClose,
}: {
  open: boolean;
  type: ProjectType;
  /** Право `project.setup.manage` — правка; иначе только просмотр. */
  canSetup: boolean;
  canCreateField: boolean;
  renderCreateField?: RenderCreateField;
  onClose: () => void;
}) {
  const update = useUpdateProjectType();
  const form = withProjectSystemElements(projectTypeFormOf(type));
  const query = useCustomFieldDefinitions('project');
  const [createField, setCreateField] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const definitions = useMemo(
    () =>
      (query.data ?? []).filter((definition) =>
        bindingsOf(definition).projectTypeIds.includes(type.id),
      ),
    [query.data, type.id],
  );

  return (
    <>
      <AttributeWindowBuilder
        open={open}
        title={`${b.titles.project} · ${type.name}`}
        elements={form.fields}
        definitions={definitions}
        systemInfo={(key) => SYSTEM_INFO[key] ?? { label: key, preview: 'input' }}
        formulaHostKind="project"
        readOnly={!canSetup}
        error={error}
        fixedTop={<ProjectFixedRows typeName={type.name} />}
        onCreateField={canCreateField && renderCreateField ? () => setCreateField(true) : undefined}
        onDone={(elements: AttributeElement[]) => {
          setError(null);
          update.mutate(
            { id: type.id, form: { fields: elements } as ProjectTypeForm },
            {
              onSuccess: onClose,
              onError: () => setError(ui.common.saveError),
            },
          );
        }}
        onClose={onClose}
      />
      {createField && renderCreateField
        ? renderCreateField({
            onClose: () => setCreateField(false),
            onCreated: () => setCreateField(false),
          })
        : null}
    </>
  );
}

/** Неподвижный верх окна проекта: название и тип — всегда первыми. */
function ProjectFixedRows({ typeName }: { typeName: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-2" title={b.fixedRow}>
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-input/30">
        {ui.projects.fieldName}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <NodeLabel label={ui.projects.fieldType} />
        <span className="relative">
          <PreviewControl kind="select" />
          <span className="absolute inset-y-0 left-2.5 flex items-center truncate text-sm">
            {typeName}
          </span>
        </span>
      </div>
    </div>
  );
}
