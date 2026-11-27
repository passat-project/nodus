import type { ConditionQuery, CustomFieldKey } from '@nodus/contracts';

/** Зависимости таблицы проб субъектов (#635): id фикстур мира теста. */
export interface SubjectProbeDeps {
  taskTypeId: string;
  t3TypeId: string;
  kindFolder: string;
  kindVolume: string;
  workStageId: string;
  w3PrintedStageId: string;
  /** Ключ атрибута (`cf.<id>`) по слоту мира. */
  cf: (key: string) => CustomFieldKey;
}

const q = (
  subject: ConditionQuery['subject'],
  where: ConditionQuery['where'] = [],
  quantifier: ConditionQuery['quantifier'] = 'none',
): ConditionQuery => ({ subject, where, quantifier });

const fieldEq = (cf: SubjectProbeDeps['cf'], key: string, value: unknown) =>
  ({
    kind: 'field',
    field: cf(key),
    op: 'eq',
    value,
  }) as ConditionQuery['where'][number];

/** Таблица «ключ → выборка» кнопок-проб субъектов (#635): статический
 *  список + раскрываемые семейства (связи, ref-поля, состояния, итоги,
 *  кванторы). Вынесена из теста ради лимита строк файла (I5). */
export function subjectProbes(deps: SubjectProbeDeps): [string, ConditionQuery][] {
  const { cf } = deps;
  const probes: [string, ConditionQuery][] = [
    ['self', q({ kind: 'self' })],
    ['self:mark', q({ kind: 'self' }, [fieldEq(cf, 'taskMark', 'HOST')])],
    ['parent', q({ kind: 'parent_task' })],
    ['subtasks', q({ kind: 'subtasks' })],
    ['folder', q({ kind: 'folder_tasks' })],
    ['project:tasks', q({ kind: 'project_tasks' }, [{ kind: 'type_is', typeId: deps.t3TypeId }])],
    ['folders:all', q({ kind: 'project_folders' })],
    ['folders:kind', q({ kind: 'project_folders', folderTypeId: deps.kindFolder })],
    ['folders:volume', q({ kind: 'project_folders', folderTypeId: deps.kindVolume })],
    ['folders:mark', q({ kind: 'project_folders' }, [fieldEq(cf, 'folderMark', 'КЖ')])],
    ['folders:stage', q({ kind: 'project_folders' }, [{ kind: 'system_state', state: 'closed' }])],
    [
      'ftype:kind',
      q({ kind: 'folder_type_tasks', folderTypeId: deps.kindFolder }, [
        fieldEq(cf, 'taskMark', 'F3T'),
      ]),
    ],
    [
      'ftype:volume',
      q({ kind: 'folder_type_tasks', folderTypeId: deps.kindVolume }, [
        fieldEq(cf, 'taskMark', 'F2T'),
      ]),
    ],
    [
      'ftype:foreign',
      q({ kind: 'folder_type_tasks', folderTypeId: deps.kindVolume }, [
        fieldEq(cf, 'taskMark', 'F3T'),
      ]),
    ],
    ['project', q({ kind: 'project' })],
    ['project:mark', q({ kind: 'project' }, [fieldEq(cf, 'projectMark', 'СД')])],
    ['project:stage', q({ kind: 'project' }, [{ kind: 'system_state', state: 'active' }])],
    ['type:own', q({ kind: 'subtasks' }, [{ kind: 'type_is', typeId: deps.taskTypeId }])],
    ['type:t3', q({ kind: 'subtasks' }, [{ kind: 'type_is', typeId: deps.t3TypeId }])],
    [
      'stage:work',
      q({ kind: 'subtasks' }, [
        { kind: 'type_is', typeId: deps.taskTypeId },
        { kind: 'stage_is', stageId: deps.workStageId },
      ]),
    ],
    [
      'stage:miss',
      q({ kind: 'subtasks' }, [
        { kind: 'type_is', typeId: deps.taskTypeId },
        { kind: 'stage_is', stageId: deps.w3PrintedStageId },
      ]),
    ],
    [
      'issued:std',
      q({ kind: 'subtasks' }, [
        { kind: 'type_is', typeId: deps.taskTypeId },
        { kind: 'result_issued' },
      ]),
    ],
    [
      'issued:t3:none',
      q({ kind: 'subtasks' }, [
        { kind: 'type_is', typeId: deps.t3TypeId },
        { kind: 'result_issued' },
      ]),
    ],
    [
      'issued:t3:all',
      q(
        { kind: 'subtasks' },
        [{ kind: 'type_is', typeId: deps.t3TypeId }, { kind: 'result_issued' }],
        'all',
      ),
    ],
  ];
  for (const relation of ['relates', 'blocks', 'precedes', 'duplicates'] as const) {
    for (const direction of ['out', 'in', 'both'] as const) {
      probes.push([`rel:${relation}:${direction}`, q({ kind: 'relations', relation, direction })]);
    }
  }
  for (const key of [
    'refTask',
    'refLetter',
    'refProject',
    'refNode',
    'refUser',
    'refDept',
    'refCP',
  ]) {
    probes.push([`ref:${key}`, q({ kind: 'ref_field', field: cf(key) })]);
  }
  for (const state of ['backlog', 'active', 'paused', 'done', 'closed'] as const) {
    probes.push([`state:${state}`, q({ kind: 'subtasks' }, [{ kind: 'system_state', state }])]);
  }
  for (const outcome of ['success', 'cancelled', 'rejected'] as const) {
    probes.push([`outcome:${outcome}`, q({ kind: 'subtasks' }, [{ kind: 'outcome', outcome }])]);
  }
  const markX: ConditionQuery['where'] = [fieldEq(cf, 'taskMark', 'X')];
  for (const quantifier of ['all', 'any', 'none'] as const) {
    for (const hostKey of ['q0', 'q1', 'q2'] as const) {
      probes.push([`${hostKey}:${quantifier}`, q({ kind: 'subtasks' }, markX, quantifier)]);
    }
  }
  return probes;
}
