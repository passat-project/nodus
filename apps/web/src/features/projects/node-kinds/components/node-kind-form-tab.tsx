import { useCallback, useMemo, useState } from 'react';
import type { NodeKind, NodeKindForm } from '@nodus/contracts';
import { bindingsOf, checkFormDecor, nodeKindFormOf, ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useAttributeHost } from '../../../../shared/forms/attribute-form-host.js';
import {
  attributeFromBuilder,
  attributeToBuilder,
  type AttributeExtra,
} from '../../../../shared/forms/attribute-form-model.js';
import type { BuilderValue } from '../../../../shared/forms/builder/builder-model.js';
import {
  FormBuilderBody,
  FormBuilderSkeleton,
  BuilderLead,
  builderLeadNote,
  FormTabLayout,
} from '../../../../shared/forms/builder/form-builder-body.js';
import { useFormAutosave } from '../../../../shared/forms/builder/form-autosave.js';
import { PreviewControl } from '../../../../shared/forms/builder/preview-control.js';
import { useUpdateNodeKind } from '../api/node-kinds-api.js';
import type { RenderCreateField } from '../types.js';

const b = ui.forms.builder;

/** Пустой заголовок/пояснение на сервер не уходят (`blockEmptyDecor` окна). */
const hasEmptyDecor = (next: BuilderValue<AttributeExtra>): boolean =>
  checkFormDecor(next.items).length > 0;

/** Автосохранение формы создания типа папки (единая модель «Процессов», #857):
 *  живёт в раме типа, пока тип открыт, — переживает переключение вкладок.
 *  Мутация «тихая»: состояние пишет строка в баре рамы. */
export function useNodeKindForm(kind: NodeKind) {
  const { mutateAsync } = useUpdateNodeKind({ quiet: true });
  const { id } = kind;
  const saved = useMemo(() => attributeToBuilder(nodeKindFormOf(kind).fields), [kind]);
  const save = useCallback(
    async (next: BuilderValue<AttributeExtra>) => {
      await mutateAsync({
        id,
        // У папки нет системных строк: редактор даёт только атрибуты и оформление.
        form: { fields: attributeFromBuilder(next) } as NodeKindForm,
      });
    },
    [mutateAsync, id],
  );
  return useFormAutosave<AttributeExtra>({ key: id, saved, save, isBlocked: hasEmptyDecor });
}

/**
 * Вкладка «Форма создания» типа папки (#496, единое ядро; #857, единая модель
 * «Процессов»): тот же редактор окна, что у задачи и проекта, — целиком во
 * вкладке, с автосохранением и без «Готово»; заменила раздел «Поля и форма»
 * (список полей и окно поверх). Название и вид папки — неподвижный верх окна;
 * атрибуты привязываются к типу в справочнике «Атрибуты», здесь — какие из
 * них окно спрашивает, в каком состоянии и в каком порядке. Без права
 * `project.setup.manage` — просмотр.
 */
export function NodeKindFormTab({
  kind,
  canSetup,
  canCreateField,
  renderCreateField,
  form,
}: {
  kind: NodeKind;
  canSetup: boolean;
  canCreateField: boolean;
  /** Окно «Создать атрибут» — слот уровня app (код фичи automation, I6). */
  renderCreateField?: RenderCreateField;
  form: ReturnType<typeof useNodeKindForm>;
}) {
  const query = useCustomFieldDefinitions('node');
  const [createField, setCreateField] = useState(false);
  const definitions = useMemo(
    () =>
      (query.data ?? []).filter((definition) =>
        bindingsOf(definition).nodeKindIds.includes(kind.id),
      ),
    [query.data, kind.id],
  );
  const openCreateField = useCallback(() => setCreateField(true), []);
  const fixedTop = useMemo(() => <NodeKindFixedRows kindName={kind.name} />, [kind.name]);
  const host = useAttributeHost(
    `${b.titles.folder} · ${kind.name}`,
    definitions,
    undefined,
    'node',
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
      >
        {query.isLoading ? (
          <FormBuilderSkeleton />
        ) : (
          <FormBuilderBody
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
