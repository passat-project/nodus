import { useCallback, useMemo, useState } from 'react';
import type { ProjectType, ProjectTypeForm } from '@nodus/contracts';
import {
  bindingsOf,
  checkFormDecor,
  projectTypeFormOf,
  ui,
  withProjectSystemElements,
} from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import type { AttributeSystemInfo } from '../../../shared/forms/attribute-form-host.js';
import { useAttributeHost } from '../../../shared/forms/attribute-form-host.js';
import {
  attributeFromBuilder,
  attributeToBuilder,
  type AttributeExtra,
} from '../../../shared/forms/attribute-form-model.js';
import type { BuilderValue } from '../../../shared/forms/builder/builder-model.js';
import {
  BuilderSheet,
  FormBuilderSkeleton,
  BuilderLead,
  builderLeadNote,
  FormTabLayout,
} from '../../../shared/forms/builder/form-builder-body.js';
import { BuilderRail } from '../../../shared/forms/builder/builder-side.js';
import { useFormAutosave } from '../../../shared/forms/builder/form-autosave.js';
import { PreviewControl } from '../../../shared/forms/builder/preview-control.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import type { RenderCreateField } from '../node-kinds/types.js';

const b = ui.forms.builder;

/** Системные строки окна проекта: подписи и виды контролов. */
const SYSTEM_INFO: Readonly<Record<string, AttributeSystemInfo>> = {
  manager: { label: ui.projects.manager, preview: 'people' },
  assistants: { label: ui.projects.assistants, preview: 'people' },
  observers: { label: ui.projects.observers, preview: 'people' },
  portfolio: { label: ui.projects.filterPortfolio, preview: 'select' },
  visibility: { label: ui.projects.fieldVisibility, preview: 'select' },
  endDate: { label: ui.projects.deadline, preview: 'date' },
  description: { label: ui.projects.fieldDescription, preview: 'text', multiline: true },
};

const systemInfoOf = (key: string): AttributeSystemInfo =>
  SYSTEM_INFO[key] ?? { label: key, preview: 'input' };

/** Пустой заголовок/пояснение на сервер не уходят (`blockEmptyDecor` окна). */
const hasEmptyDecor = (next: BuilderValue<AttributeExtra>): boolean =>
  checkFormDecor(next.items).length > 0;

/** Автосохранение формы создания типа проекта (единая модель «Процессов»,
 *  #857): живёт в раме типа, пока открыт тип, — переживает переключение
 *  вкладок. Мутация «тихая»: вместо всплывающих уведомлений состояние пишет
 *  строка в баре рамы. */
export function useProjectTypeForm(type: ProjectType) {
  // `mutateAsync` одного обсёрвера — устойчивая ссылка: `save` не меняется
  // от статуса мутации.
  const { mutateAsync } = useUpdateProjectType({ quiet: true });
  const { id } = type;
  const saved = useMemo(
    () => attributeToBuilder(withProjectSystemElements(projectTypeFormOf(type)).fields),
    [type],
  );
  const save = useCallback(
    async (next: BuilderValue<AttributeExtra>) => {
      await mutateAsync({
        id,
        form: { fields: attributeFromBuilder(next) } as ProjectTypeForm,
      });
    },
    [mutateAsync, id],
  );
  return useFormAutosave<AttributeExtra>({ key: id, saved, save, isBlocked: hasEmptyDecor });
}

/**
 * Вкладка «Форма создания» типа проекта (#496, единое ядро; #857, единая
 * модель «Процессов»; ревизия 27.11): тот же редактор окна, что у задачи и
 * кнопки, — две панели на всю высоту: слева палитра атрибутов
 * (`BuilderRail`), по центру лист окна на всю оставшуюся высоту с
 * внутренней прокруткой; автосохранение, без «Готово». Атрибуты
 * привязываются к типу в справочнике «Атрибуты»; здесь — какие из них и
 * системные строки проекта окно показывает и в каком порядке. Без права
 * `project.setup.manage` — просмотр.
 */
export function ProjectTypeFormTab({
  type,
  canSetup,
  canCreateField,
  renderCreateField,
  form,
}: {
  type: ProjectType;
  canSetup: boolean;
  canCreateField: boolean;
  /** Окно «Создать атрибут» — слот уровня app (код фичи automation, I6). */
  renderCreateField?: RenderCreateField;
  form: ReturnType<typeof useProjectTypeForm>;
}) {
  const query = useCustomFieldDefinitions('project');
  const [createField, setCreateField] = useState(false);
  const definitions = useMemo(
    () =>
      (query.data ?? []).filter((definition) =>
        bindingsOf(definition).projectTypeIds.includes(type.id),
      ),
    [query.data, type.id],
  );
  const openCreateField = useCallback(() => setCreateField(true), []);
  const fixedTop = useMemo(() => <ProjectFixedRows typeName={type.name} />, [type.name]);
  const host = useAttributeHost(
    `${b.titles.project} · ${type.name}`,
    definitions,
    systemInfoOf,
    'project',
    fixedTop,
    !canSetup,
    null,
    canCreateField && renderCreateField ? openCreateField : undefined,
  );
  const closeCreateField = () => setCreateField(false);

  return (
    <>
      <FormTabLayout
        lead={<BuilderLead title={host.title} note={builderLeadNote({ readOnly: !canSetup })} />}
        rail={
          canSetup ? (
            <BuilderRail value={form.value} host={host} readOnly={false} onChange={form.edit} />
          ) : null
        }
      >
        {query.isLoading ? (
          <FormBuilderSkeleton />
        ) : (
          <BuilderSheet
            fill
            host={host}
            value={form.value}
            readOnly={!canSetup}
            onChange={form.edit}
          />
        )}
      </FormTabLayout>
      {createField && renderCreateField
        ? renderCreateField({ onClose: closeCreateField, onCreated: closeCreateField })
        : null}
    </>
  );
}

/** Неподвижный верх окна проекта: название и тип — всегда первыми. */
function ProjectFixedRows({ typeName }: { typeName: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-2" title={b.fixedRow}>
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-transparent">
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
