import { Info } from 'lucide-react';
import type { CustomFieldDefinition, CustomFieldModule, CustomFieldValue } from '@nodus/contracts';
import { SystemDictionary, ui } from '@nodus/contracts';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useDictionaryItems } from '../../../../shared/dictionaries/queries.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { CompanyValueEditor } from './field-company-value-editor.js';
import { CustomFieldValueView, refsById } from '../../../../shared/custom-fields/value-view.js';
import { formatDateTimeShort, plural } from '../../../../shared/lib/format.js';
import { monoCell } from '../../../../shared/ui/person-cell.js';
import type { DataTableField } from '../../../../shared/views/data-table.js';

const muted = 'truncate text-sm text-muted-foreground';

/** Заглушка загрузки ячейки: «нет» и «—» до ответа — ложное утверждение
 *  («ни в одном виде папок», «настроек нет») на глазах пользователя. */
function CellLoading() {
  return <span className={muted}>…</span>;
}

/** Варианты списка в ячейке «Настройки»: короткий справочник — подписями,
 *  длинный (45 марок СТБ, #556) — счётчиком: перечисление в строку таблицы
 *  не читается, а колонка «Настройки» отвечает на вопрос «сколько».
 *  Полный список — в окне атрибута. */
function OptionsSummary({ code }: { code: string }) {
  const { data: items = [], isLoading } = useDictionaryItems(code);
  if (isLoading) return <CellLoading />;
  if (items.length === 0) return <span className={muted}>—</span>;
  const count = `${items.length} ${plural(items.length, ui.customFields.cells.options)}`;
  if (items.length > 4) {
    return (
      <span className="truncate text-sm text-secondary-foreground tabular-nums" title={count}>
        {count}
      </span>
    );
  }
  return (
    <span
      className="truncate text-sm text-secondary-foreground"
      title={items.map((i) => i.name).join(', ')}
    >
      {items.map((item) => item.name).join(', ')}
    </span>
  );
}

function CurrencyName({ id }: { id: string | null | undefined }) {
  const { data: items = [] } = useDictionaryItems(SystemDictionary.CURRENCY);
  const name = items.find((item) => item.id === id)?.name;
  return <span className={monoCell}>{name ?? '—'}</span>;
}

function SettingsCell({ definition }: { definition: CustomFieldDefinition }) {
  if (definition.dictionary && (definition.type === 'enum' || definition.type === 'multienum')) {
    return <OptionsSummary code={definition.dictionary.code} />;
  }
  if (definition.type === 'number') {
    return (
      <span className={muted}>
        {ui.customFields.cells.precision}{' '}
        <span className="font-mono tabular-nums">{definition.settings.precision ?? 0}</span>
      </span>
    );
  }
  if (definition.type === 'money') return <CurrencyName id={definition.settings.currencyId} />;
  return <span className={muted}>—</span>;
}

function DefaultCell({ definition }: { definition: CustomFieldDefinition }) {
  const value = definition.defaultValue;
  if (value === null) return <span className={muted}>—</span>;
  if (value.kind === 'author_department') {
    return <span className="truncate text-sm">{ui.customFields.cells.authorDepartment}</span>;
  }
  return (
    <span className="flex min-w-0 truncate text-sm">
      <CustomFieldValueView
        definition={definition}
        value={value.value}
        refs={refsById(definition.defaultRefs)}
        compact
        interactive={false}
      />
    </span>
  );
}

/** Сводка «Где используется» (Р11): модули с числом мест — «Задачи · 2,
 *  Письма · 1, Папки · 1», глобальная — «Глобальная переменная». Категории
 *  типов знает реестр (типы процессов загружены) — разбивка честная. */
function UsageCell({ definition }: { definition: CustomFieldDefinition }) {
  const { data: processTypes } = useProcessTypes();
  const { data: projectTypes } = useProjectTypes(true);
  const { data: nodeKinds } = useNodeKinds();

  if (definition.isCompany) {
    return (
      <span className="truncate text-sm text-secondary-foreground">
        {ui.customFields.cells.company}
      </span>
    );
  }
  const bindings = definition.bindings;
  const taskTypeIds = new Set(
    (processTypes ?? []).filter((type) => type.category === 'task').map((type) => type.id),
  );
  const letterTypeIds = new Set(
    (processTypes ?? []).filter((type) => type.category === 'letter').map((type) => type.id),
  );
  const parts: string[] = [];
  const places = ui.customFields.cells.places;
  const taskCount = bindings.processTypeIds.filter((id) => taskTypeIds.has(id)).length;
  const letterCount = bindings.processTypeIds.filter((id) => letterTypeIds.has(id)).length;
  // Счётчик с единицей измерения: «Задачи · 1 место», а не криптозапись «Задачи · 1».
  if (taskCount > 0)
    parts.push(`${ui.customFields.moduleNames.task} · ${taskCount} ${plural(taskCount, places)}`);
  if (letterCount > 0)
    parts.push(
      `${ui.customFields.moduleNames.letter} · ${letterCount} ${plural(letterCount, places)}`,
    );
  if (bindings.projectTypeIds.length > 0) {
    const names = bindings.projectTypeIds
      .map((id) => (projectTypes ?? []).find((type) => type.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    parts.push(
      `${ui.customFields.moduleNames.project} · ${names.length > 0 ? names.join(', ') : bindings.projectTypeIds.length}`,
    );
  }
  if (bindings.nodeKindIds.length > 0) {
    const names = bindings.nodeKindIds
      .map((id) => (nodeKinds ?? []).find((kind) => kind.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    parts.push(
      `${ui.customFields.moduleNames.node} · ${names.length > 0 ? names.join(', ') : bindings.nodeKindIds.length}`,
    );
  }
  if (parts.length === 0) {
    return <span className={muted}>{ui.customFields.cells.nowhere}</span>;
  }
  const text = parts.join(', ');
  return (
    <span className="truncate text-sm text-secondary-foreground" title={text}>
      {text}
    </span>
  );
}

/**
 * Колонки реестра атрибутов портала (#631, ключ вида `custom-fields.list`):
 * название с иконкой типа закреплено; тип, «Где используется» (сводка
 * привязок), «Значение» (только глобальные — инлайн-редактор), настройки,
 * умолчание — по умолчанию; «Отчёты» и «Изменён» включает шестерёнка.
 * Строки идут в порядке реестра (sortOrder), клик по заголовку — сортировка
 * только для просмотра (порядок меняют «Поднять/Опустить»).
 */
export function fieldColumns(
  canManage: boolean,
  onCompanyValueCommit: (definition: CustomFieldDefinition, value: CustomFieldValue | null) => void,
): DataTableField<CustomFieldDefinition>[] {
  return [
    {
      id: 'name',
      label: ui.customFields.columns.name,
      defaultVisible: true,
      defaultWidth: 300,
      minWidth: 180,
      locked: true,
      render: (definition) => (
        <span className="flex min-w-0 items-center gap-2.5" title={definition.hint ?? undefined}>
          <CustomFieldTypeIcon
            type={definition.type}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-sm font-medium">{definition.name}</span>
          {definition.hint ? (
            <Info
              className="size-3 shrink-0 text-muted-foreground opacity-60"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : null}
        </span>
      ),
      sortValue: (definition) => definition.name.toLowerCase(),
    },
    {
      id: 'type',
      label: ui.customFields.columns.type,
      defaultVisible: true,
      defaultWidth: 180,
      render: (definition) => (
        <span className="truncate text-sm text-secondary-foreground">
          {ui.customFields.types[definition.type]}
        </span>
      ),
      sortValue: (definition) => ui.customFields.types[definition.type],
    },
    {
      id: 'usage',
      label: ui.customFields.columns.usage,
      defaultVisible: true,
      defaultWidth: 260,
      render: (definition) => <UsageCell definition={definition} />,
      sortValue: (definition) =>
        definition.isCompany
          ? 0
          : definition.bindings.processTypeIds.length +
            definition.bindings.projectTypeIds.length +
            definition.bindings.nodeKindIds.length,
    },
    {
      id: 'value',
      label: ui.customFields.columns.value,
      defaultVisible: true,
      defaultWidth: 200,
      render: (definition) =>
        definition.isCompany ? (
          <CompanyValueEditor
            definition={definition}
            canManage={canManage}
            onCommit={onCompanyValueCommit}
          />
        ) : (
          <span className={muted}>—</span>
        ),
    },
    {
      id: 'settings',
      label: ui.customFields.columns.settings,
      defaultVisible: true,
      defaultWidth: 240,
      render: (definition) => <SettingsCell definition={definition} />,
    },
    {
      id: 'defaultValue',
      label: ui.customFields.columns.defaultValue,
      defaultVisible: true,
      defaultWidth: 200,
      render: (definition) => <DefaultCell definition={definition} />,
    },
    {
      id: 'reports',
      label: ui.customFields.columns.reports,
      defaultVisible: false,
      defaultWidth: 150,
      render: (definition) =>
        definition.reportIndexed ? (
          <span className="text-sm text-secondary-foreground">{ui.customFields.cells.indexed}</span>
        ) : (
          <span className={muted}>—</span>
        ),
      sortValue: (definition) => (definition.reportIndexed ? 0 : 1),
    },
    {
      id: 'updatedAt',
      label: ui.customFields.columns.updatedAt,
      defaultVisible: false,
      defaultWidth: 150,
      render: (definition) => (
        <span className={monoCell}>{formatDateTimeShort(definition.updatedAt)}</span>
      ),
      sortValue: (definition) => definition.updatedAt,
    },
  ];
}

/** Фильтр-модули реестра: Все + модули «Где используется» (В6: «Реестры»
 *  до #636 не показываются). */
export const FIELD_MODULES: Array<CustomFieldModule | 'all'> = [
  'all',
  'task',
  'letter',
  'project',
  'node',
  'company',
];
