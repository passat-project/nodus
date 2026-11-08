import type { NumberHostKind } from '@nodus/contracts';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useProcessTypes } from '../../api/automation-api.js';
import type { BindingHostKindOf } from '../../lib/field-draft.js';

/** Вид записи цели привязки (#630): тип задачи → task, тип письма →
 *  letter, тип проекта → project, вид папки → node. Нужен совместимости
 *  «Кто получает номер × Свой счёт внутри» — те же запросы, что у пикера
 *  «Где используется» (кэш TanStack общий). */
export function useBindingHostKinds(): BindingHostKindOf {
  const { data: processTypes } = useProcessTypes('include');
  const { data: projectTypes } = useProjectTypes(true);
  const { data: nodeKinds } = useNodeKinds();
  return (targetId: string): NumberHostKind | null => {
    const processType = processTypes?.find((type) => type.id === targetId);
    if (processType) return processType.category === 'letter' ? 'letter' : 'task';
    if (projectTypes?.some((type) => type.id === targetId)) return 'project';
    if (nodeKinds?.some((kind) => kind.id === targetId)) return 'node';
    return null;
  };
}
