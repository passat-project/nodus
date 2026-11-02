import { EyeOff, Info } from 'lucide-react';
import type { CustomFieldDefinition, CustomFieldScope } from '@nodus/contracts';
import { nodeKindFormOf, SystemDictionary, typeIdsOf, ui } from '@nodus/contracts';

import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { CustomFieldValueView, refsById } from '../../../../shared/custom-fields/value-view.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useDictionaryItems } from '../../../../shared/dictionaries/queries.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { formatDateTimeShort, plural } from '../../../../shared/lib/format.js';
import { monoCell } from '../../../../shared/ui/person-cell.js';
import type { DataTableField } from '../../../../shared/views/data-table.js';

const muted = 'truncate text-sm text-muted-foreground';

/** Варианты списка в ячейке «Настройки»: первые подписи через запятую и
 *  счётчик в подсказке (кэш справочника общий с окном и карточками). */
function OptionsSummary({ code }: { code: string }) {
  const { data: items = [] } = useDictionaryItems(code);
  if (items.length === 0) return <span className={muted}>—</span>;
  return (
    <span
      className="truncate text-sm text-secondary-foreground"
      title={`${items.length} ${plural(items.length, ui.customFields.cells.options)}`}
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

/** Виды папок, в форме которых стоит атрибут (#556): колонка «Виды папок»
 *  области «Папки» — обратная сторона формы вида (привязки нет). */
function NodeKindsCell({ definition }: { definition: CustomFieldDefinition }) {
  const { data: kinds } = useNodeKinds();
  const names = (kinds ?? [])
    .filter((kind) => nodeKindFormOf(kind).fields.some((slot) => slot.fieldId === definition.id))
    .map((kind) => kind.name);
  if (names.length === 0) return <span className={muted}>{ui.customFields.bind.nodeNone}</span>;
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return (
    <span className="truncate text-sm text-secondary-foreground" title={names.join(', ')}>
      {shown}
      {rest > 0 ? ` ${ui.customFields.bind.moreTypes} ${rest}` : ''}
    </span>
  );
}

/** Типы, которым принадлежит атрибут (#432, В2): пусто — «Нигде не
 *  показывается» (приглушённо). У проектов и контрагентов типов нет. */
function TypesCell({ definition }: { definition: CustomFieldDefinition }) {
  const { data: types } = useProcessTypes();
  if (definition.scope === 'node') return <NodeKindsCell definition={definition} />;
  if (definition.scope !== 'task' && definition.scope !== 'letter') {
    return <span className={muted}>{ui.customFields.cells.allEntities}</span>;
  }
  const names = typeIdsOf(definition)
    .map((id) => types?.find((type) => type.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return <span className={muted}>{ui.customFields.bind.none}</span>;
  }
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return (
    <span className="truncate text-sm text-secondary-foreground" title={names.join(', ')}>
      {shown}
      {rest > 0 ? ` ${ui.customFields.bind.moreTypes} ${rest}` : ''}
    </span>
  );
}

/**
 * Колонки реестра атрибутов (ключ вида `custom-fields.list`): название с
 * иконкой типа закреплено; тип, настройки типа, умолчание, видимость —
 * по умолчанию; «Отчёты» и «Изменён» включает шестерёнка. Строки идут в
 * порядке атрибутов карточки (sortOrder), клик по заголовку — сортировка
 * только для просмотра (порядок карточки меняют «Поднять/Опустить»).
 */
export const fieldColumns: DataTableField<CustomFieldDefinition>[] = [
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
        <span
          className={
            definition.hidden
              ? 'truncate text-sm font-medium text-muted-foreground'
              : 'truncate text-sm font-medium'
          }
        >
          {definition.name}
        </span>
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
    defaultWidth: 200,
    render: (definition) => (
      <span className="truncate text-sm text-secondary-foreground">
        {ui.customFields.types[definition.type]}
      </span>
    ),
    sortValue: (definition) => ui.customFields.types[definition.type],
  },
  {
    id: 'types',
    label: ui.customFields.bind.column,
    defaultVisible: true,
    defaultWidth: 200,
    render: (definition) => <TypesCell definition={definition} />,
    sortValue: (definition) => typeIdsOf(definition).length,
  },
  {
    id: 'settings',
    label: ui.customFields.columns.settings,
    defaultVisible: true,
    defaultWidth: 260,
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
    id: 'visibility',
    label: ui.customFields.columns.visibility,
    defaultVisible: true,
    defaultWidth: 130,
    render: (definition) =>
      definition.hidden ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <EyeOff className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {ui.customFields.cells.hidden}
        </span>
      ) : (
        <span className="text-sm text-secondary-foreground">{ui.customFields.cells.visible}</span>
      ),
    sortValue: (definition) => (definition.hidden ? 1 : 0),
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

/** Колонки реестра для области: у «Папок» колонка «Типы» называется
 *  «Виды папок» (#556) — id колонки и пресет вида те же. */
export function fieldColumnsFor(scope: CustomFieldScope): DataTableField<CustomFieldDefinition>[] {
  return scope === 'node'
    ? fieldColumns.map((field) =>
        field.id === 'types' ? { ...field, label: ui.customFields.bind.nodeColumn } : field,
      )
    : fieldColumns;
}
