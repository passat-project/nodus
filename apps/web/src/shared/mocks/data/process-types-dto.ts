import type { ProcessType, WorkflowDocument } from '@nodus/contracts';
import { bindingsOf, typeAccessFor } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { mockEffectiveRoleIds, mockIsAdmin } from './roles.js';
import { demoUserListItems } from './users.js';
import { demoPositions } from './positions.js';
import { demoNodeKinds } from './project-nodes.js';
import { demoProcessTypes } from './workflows.js';
import { mockWorkflows } from './workflows-store.js';
import { getMockActor } from '../mock-actor.js';
import { creationFormOf, mockTypes, type DemoProcessType } from './process-types-store.js';

/** DTO типа процесса под текущего актёра (#432, Р6): видимость и создание по
 *  ролям, форма создания, конфигурация; факты проверки документа маршрута. */

/** DTO типа под текущего актёра (Р6): доступ по ролям, форма, конфигурация. */
export function typeDto(type: DemoProcessType): ProcessType {
  const actor = getMockActor();
  const viewer = typeAccessFor(
    { config: type.config, creatable: type.creatable },
    { roleIds: mockEffectiveRoleIds(actor.id), isAdmin: mockIsAdmin(actor.id) },
  );
  return { ...structuredClone(type), creationForm: creationFormOf(type), viewer };
}

/** Видимость типа для актёра: без `workflow.manage` — только видимые (Р6). */
export function canSeeAllTypes(): boolean {
  return getMockActor().permissions.includes('workflow.manage');
}

/** Факты проверки документа: весь реестр атрибутов и привязка к типу (Р8,
 *  #631 — реестр один на портал, «свой/чужой» решает привязка, скрытия нет)
 *  и живые факты общей выборки (#635): типы, виды папок, стадии маршрутов
 *  типов из предикатов type_is самого документа. */
export function documentFacts(
  type: DemoProcessType | undefined,
  category: string,
  document?: Pick<WorkflowDocument, 'transitions' | 'actions'>,
) {
  const inType = new Set(
    demoCustomFieldDefinitions
      .filter((entry) => type && bindingsOf(entry).processTypeIds.includes(type.id))
      .map((entry) => entry.id),
  );
  return {
    customFields: {
      active: new Set(demoCustomFieldDefinitions.map((entry) => entry.id)),
      inType,
    },
    category: category === 'letter' ? 'letter' : 'task',
    definitions: demoCustomFieldDefinitions.map((entry) => ({
      id: entry.id,
      type: entry.type,
      settings: entry.settings,
    })),
    projectsAvailable: true,
    positions: new Map(
      demoPositions.map((position) => [
        position.id,
        {
          kind: position.kind,
          holders: demoUserListItems.filter(
            (user) => user.status === 'active' && user.positionName === position.name,
          ).length,
        },
      ]),
    ),
    activeUserIds: new Set(
      demoUserListItems.filter((user) => user.status === 'active').map((user) => user.id),
    ),
    ...conditionFactsOfMock(document),
  } as const;
}

/** Живые факты выборки мока (#635): типы процессов без архивных, виды папок,
 *  стадии маршрутов типов из type_is документа (мёртвая ссылка — ошибка). */
function conditionFactsOfMock(document?: Pick<WorkflowDocument, 'transitions' | 'actions'>) {
  const liveTypes = mockTypes.filter((entry) => entry.archivedAt === null);
  const typeIsIds = new Set<string>();
  const collect = (rules: { validators: unknown[]; conditions: unknown[] }) => {
    for (const rule of [...rules.validators, ...rules.conditions]) {
      const query = (rule as { query?: { where?: { kind: string; typeId?: string }[] } }).query;
      if (!query) continue;
      for (const predicate of query.where ?? []) {
        if (predicate.kind === 'type_is' && predicate.typeId) typeIsIds.add(predicate.typeId);
      }
    }
  };
  for (const owner of [...(document?.transitions ?? []), ...(document?.actions ?? [])]) {
    collect(owner.rules);
  }
  const stageFacts = new Map<string, ReadonlySet<string>>();
  for (const typeId of typeIsIds) {
    const detail = demoProcessTypes.find((entry) => entry.id === typeId);
    const workflow = detail ? mockWorkflows.get(detail.workflowId) : undefined;
    if (workflow) {
      stageFacts.set(typeId, new Set(workflow.document.stages.map((stage) => stage.id)));
    }
  }
  return {
    conditionTypeFacts: new Set(liveTypes.map((entry) => entry.id)),
    conditionNodeKindFacts: new Set(
      demoNodeKinds.filter((kind) => kind.archivedAt === null).map((kind) => kind.id),
    ),
    conditionStageFacts: stageFacts,
  } as const;
}
