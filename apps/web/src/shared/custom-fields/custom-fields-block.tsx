import { useMemo } from 'react';
import type {
  CustomFieldFormulas,
  CustomFieldModule,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { FieldRow } from '../ui/entity-fields.js';
import { CustomFieldTypeIcon } from './field-type-icon.js';
import { FormulaCell } from './formula/formula-cell.js';
import type { FormulaHost } from './formula/formula-api.js';
import type { FormulaHostContext } from './formula/formula-editor.js';
import { definitionsForTarget } from './module-target.js';
import { useCustomFieldDefinitions } from './queries.js';
import { CustomFieldEditor } from './value-editor.js';

/**
 * Блок «Атрибуты» карточки сущности (#431/#631): сетка строк той же
 * грамматики, что `EntityFields` (иконка + моно-метка w-44 + значение,
 * 1→2 колонки по @container), правка по месту. Многострочный текст — на
 *  всю ширину сетки, как описание. Показываются атрибуты, привязанные
 *  к типу/виду сущности («Где используется», Р3); настройка — только во
 *  вкладке «Атрибуты» «Автоматизации». Нет атрибутов — блока нет;
 *  загрузка — два скелета; ошибка — строка с повтором. Значения правит
 *  вызывающий (оптимистично, I4).
 *
 *  С `host` (#632) ячейка получает формульный режим: значок fx, меню
 *  «Изменить формулу / Вписать значение / Убрать формулу / Как у типа»,
 *  бейдж ошибки и редактор формул.
 */
export function CustomFieldsBlock({
  module,
  targetId,
  values,
  refs,
  canEdit,
  onChange,
  host,
  hostContext,
  formulas,
}: {
  module: Exclude<CustomFieldModule, 'company'>;
  /** Тип процесса / тип проекта / вид папки: показываются только его
   *  атрибуты (Р3, «Где используется»). */
  targetId?: string;
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  canEdit: boolean;
  onChange: (fieldId: string, value: CustomFieldValue | null, refs?: CustomFieldRef[]) => void;
  /** Запись-носитель формул (#632); без него блок работает как раньше. */
  host?: FormulaHost;
  hostContext?: FormulaHostContext;
  /** Состояние формульных ячеек из DTO (`customFieldFormulas`). */
  formulas?: CustomFieldFormulas;
}) {
  const query = useCustomFieldDefinitions(module);
  // Стабильный массив определений (A6-10): он уходит в `useFormulaEditor`
  // как `ownDefinitions` — зависимость `useMemo` дерева источников редактора.
  // Новая ссылка на каждый рендер блока пересобирала дерево целиком.
  const definitions = useMemo(
    () => definitionsForTarget(query.data, module, targetId),
    [query.data, module, targetId],
  );

  if (query.isLoading) {
    return (
      <section className="mt-7 flex flex-col gap-2">
        <NodeLabel label={ui.customFields.block.title} />
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-8 w-full max-w-sm" />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="mt-7 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{ui.customFields.block.loadError}</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="rounded px-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          {ui.customFields.block.retry}
        </button>
      </section>
    );
  }

  if (definitions.length === 0) return null;

  return (
    <section className="mt-7">
      <NodeLabel label={ui.customFields.block.title} count={definitions.length} />
      <div className="mt-1 grid grid-cols-1 gap-x-12 gap-y-0.5 @min-[55rem]:grid-cols-2">
        {definitions.map((definition) => {
          const hintId = `cf-hint-${definition.id}`;
          return (
            <FieldRow
              key={definition.id}
              icon={<CustomFieldTypeIcon type={definition.type} className="size-3.5" />}
              label={definition.name}
              hint={definition.hint}
              hintId={hintId}
              wide={definition.type === 'long_text'}
            >
              {host ? (
                <FormulaCell
                  definition={definition}
                  host={host}
                  hostContext={hostContext ?? {}}
                  info={formulas?.[definition.id]}
                  value={values[definition.id]}
                  refs={refs}
                  canEdit={canEdit}
                  onChange={onChange}
                  ownDefinitions={definitions}
                >
                  <CustomFieldEditor
                    definition={definition}
                    value={values[definition.id]}
                    refs={refs}
                    disabled={!canEdit}
                    variant="inline"
                    onCommit={(value, pickedRefs) => onChange(definition.id, value, pickedRefs)}
                  />
                </FormulaCell>
              ) : (
                <CustomFieldEditor
                  definition={definition}
                  value={values[definition.id]}
                  refs={refs}
                  disabled={!canEdit}
                  variant="inline"
                  onCommit={(value, pickedRefs) => onChange(definition.id, value, pickedRefs)}
                />
              )}
              {definition.hint ? (
                <span id={hintId} className="sr-only">
                  {definition.hint}
                </span>
              ) : null}
            </FieldRow>
          );
        })}
      </div>
    </section>
  );
}
