import { useMemo } from 'react';
import type { CustomFieldDefinition, FolderListItem } from '@nodus/contracts';
import { listSystemFieldLabel, ui } from '@nodus/contracts';

import { useNodeKinds } from '../api/node-kinds.js';
import { formatDateTime } from '../lib/format.js';
import { monoCell } from '../ui/person-cell.js';
import { attributeColumnFields } from './attribute-fields.js';
import type { DataTableField } from './data-table.js';
import { useCustomFieldDefinitions } from '../custom-fields/queries.js';

/**
 * Реестр колонок списка папок проекта (#435): системные поля папки (название,
 * вид, шифр, создано) и атрибуты вида папки (module 'node', привязки по
 * nodeKindIds). Одна грамматика плоских списков — «модули не отличаются».
 */
export function makeFolderTableFields({
  definitions,
  kinds,
}: {
  definitions?: readonly CustomFieldDefinition[];
  kinds?: readonly { id: string; name: string }[];
} = {}): DataTableField<FolderListItem>[] {
  return [
    {
      id: 'name',
      label: listSystemFieldLabel('folder', 'name'),
      defaultVisible: true,
      defaultWidth: 300,
      minWidth: 160,
      maxWidth: 640,
      locked: true,
      render: (folder) => <span className="truncate text-sm font-medium">{folder.name}</span>,
      sortValue: (folder) => folder.name,
    },
    {
      id: 'kind',
      label: listSystemFieldLabel('folder', 'kind'),
      defaultVisible: true,
      defaultWidth: 170,
      minWidth: 120,
      render: (folder) => {
        const kind = kinds?.find((k) => k.id === folder.kindId);
        return kind ? <span className="text-body-xs">{kind.name}</span> : null;
      },
      sortValue: (folder) => kinds?.find((k) => k.id === folder.kindId)?.name ?? null,
    },
    {
      id: 'code',
      label: ui.structure.columnCode,
      defaultVisible: false,
      defaultWidth: 120,
      minWidth: 90,
      render: (folder) => (folder.code ? <span className={monoCell}>{folder.code}</span> : null),
      sortValue: (folder) => folder.code,
    },
    {
      id: 'createdAt',
      label: listSystemFieldLabel('folder', 'createdAt'),
      defaultVisible: false,
      defaultWidth: 140,
      minWidth: 112,
      render: (folder) => <span className={monoCell}>{formatDateTime(folder.createdAt)}</span>,
      sortValue: (folder) => folder.createdAt,
    },
    ...attributeColumnFields<FolderListItem>({ definitions, module: 'node' }),
  ];
}

/** Реестр колонок папок с атрибутами и видами папок (хуки данных). */
export function useFolderTableFields(): DataTableField<FolderListItem>[] {
  const { data: definitions } = useCustomFieldDefinitions('node');
  const { data: kinds } = useNodeKinds();
  return useMemo(
    () => makeFolderTableFields({ definitions: definitions ?? [], kinds: kinds ?? [] }),
    [definitions, kinds],
  );
}
