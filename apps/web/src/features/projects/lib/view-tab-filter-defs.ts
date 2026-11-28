import type { LetterListItem, ListEntity } from '@nodus/contracts';

import { customFieldValuesOf } from '../../../shared/custom-fields/queries.js';
import { useCustomFieldFilterDefs } from '../../../shared/custom-fields/filter-defs.js';
import { useLetterFilterDefs } from '../../../shared/views/letter-filter-fields.js';
import { useTaskFilterDefs } from '../../../shared/views/task-filter-fields.js';

/** Реестры полей фильтра вкладок-списков проекта (#435): рамка проекта —
 *  без «Проекта» в полях (рамку снять нельзя); папки — атрибуты вида папки. */
export function useFilterDefsOfEntity(entity: ListEntity) {
  const taskDefs = useTaskFilterDefs({ projectVisible: false });
  const letterDefs = useLetterFilterDefs([] as LetterListItem[], {});
  const folderDefs = useCustomFieldFilterDefs('node', customFieldValuesOf);
  return entity === 'task' ? taskDefs : entity === 'letter' ? letterDefs : folderDefs;
}
