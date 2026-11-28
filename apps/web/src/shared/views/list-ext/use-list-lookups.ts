import { useMemo } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { listSystemFieldLabel, listsStrings } from '@nodus/contracts';

import { useActiveUsersList } from '../../api/users-list.js';
import { useProjectsList } from '../../api/projects-list.js';
import { useTaskStages } from '../../api/task-stages.js';
import { useNodeKinds } from '../../api/node-kinds.js';
import type { FilterOption } from '../list-filters.js';
import { definitionOfField } from './list-field-values.js';

/**
 * Подписи сырых ключей групп (#435): uuid-ключи (стадия, ответственный,
 * проект, вид папки, варианты атрибутов) показываются именами из реестров
 * портала; чего в реестре нет (контрагент письма, редкий вариант) — именами
 * загруженных строк; остальное — сырым ключом (моно, узкий кейс).
 */

export type GroupKeyLabeler = (field: string, key: string | number | null) => string;

export interface GroupLabelSources {
  /** id → имя из загруженных строк (контрагент, ссылка атрибута). */
  rowNames?: ReadonlyMap<string, string>;
  /** Варианты атрибутных полей панели (enum/department/project/users). */
  optionsByField?: ReadonlyMap<string, readonly FilterOption[]>;
}

export function useGroupKeyLabeler(
  entity: 'task' | 'letter' | 'folder',
  definitions: readonly CustomFieldDefinition[] | undefined,
  sources: GroupLabelSources = {},
): GroupKeyLabeler {
  const { data: users } = useActiveUsersList();
  const { data: projects } = useProjectsList();
  const { data: stages } = useTaskStages();
  const { data: kinds } = useNodeKinds();
  const { rowNames } = sources;

  return useMemo(() => {
    const names = new Map<string, string>();
    for (const user of users?.items ?? []) names.set(user.id, user.displayName);
    for (const project of projects?.items ?? []) names.set(project.id, project.name);
    for (const stage of stages ?? []) names.set(stage.id, stage.name);
    for (const kind of kinds ?? []) names.set(kind.id, kind.name);
    if (rowNames) for (const [id, name] of rowNames) if (!names.has(id)) names.set(id, name);
    return (field: string, key: string | number | null): string => {
      if (key === null) return '';
      const raw = String(key);
      if (names.has(raw)) return names.get(raw)!;
      const definition = definitions ? definitionOfField(definitions, field) : undefined;
      if (definition) {
        const options = sources.optionsByField?.get(field);
        const option = options?.find((o) => o.value === raw);
        if (option) return option.label;
        // Дата-атрибут: ключ — ISO-момент, показываем датой (грамматика
        // форматирования списков — короткая дата без времени).
        if (
          definition.type === 'date' ||
          definition.type === 'datetime' ||
          raw.match(/^\d{4}-\d{2}-\d{2}/)
        ) {
          return raw.slice(0, 10);
        }
        if (definition.type === 'bool')
          return raw === 'true' ? listsStrings.boolLabels.true : listsStrings.boolLabels.false;
        if (definition.type === 'money') return String(key);
        return raw;
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
      // Системное поле с датой (deadline/decidedAt/createdAt) — короткой датой.
      const label = listSystemFieldLabel(entity, field as never);
      if (
        field === 'deadline' ||
        field === 'decidedAt' ||
        field === 'createdAt' ||
        field === 'sentAt'
      ) {
        return raw.slice(0, 10) || label;
      }
      return raw;
    };
  }, [entity, users, projects, stages, kinds, definitions, rowNames, sources.optionsByField]);
}
