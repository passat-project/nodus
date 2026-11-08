import type {
  NumberContainerMissingReason,
  NumberFieldSource,
  NumberHostKind,
  NumberIssueSource,
  NumberPlace,
  NumberSeriesRule,
  NumberTemplateFieldReader,
} from '@nodus/contracts';
import {
  numberEmptySegments,
  renderNumberTemplate,
  resolveNumberContainers,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { fieldValueOf, issueMockNumber, minskParts, segmentReaderOf } from './numbering-store.js';
import { demoNodeKinds, findDemoNodeRow } from './project-nodes.js';
import { demoProjectRows } from './projects.js';

/** Выдача номеров «при создании» в мок-мире (#630, модель v3): место новой
 *  записи (папки снаружи, проект, портфель, свой тип) и выдача всех
 *  счётчиков, у которых ЭТОТ тип отмечен «при создании» (и при смене типа
 *  на него). Зеркало серверного пути создания. */

/** Цепочка папок СНАРУЖИ записи от ближайшей вверх (мок-мир). */
function foldersFrom(nodeId: string | null): { id: string; kindId: string }[] {
  const folders: { id: string; kindId: string }[] = [];
  let current = nodeId ? findDemoNodeRow(nodeId) : undefined;
  while (current) {
    folders.push({ id: current.id, kindId: current.kindId });
    current = current.parentId ? findDemoNodeRow(current.parentId) : undefined;
  }
  return folders;
}

function projectPlace(projectId: string | null) {
  const project = demoProjectRows.find((row) => row.id === projectId);
  return {
    projectId: project?.id ?? null,
    portfolioId: project?.portfolioId ?? null,
    projectTypeId: project?.typeId ?? null,
  };
}

/** Место записи и читатель полей-вставок номера. */
export interface NewRecordPlace {
  place: NumberPlace;
  field: NumberTemplateFieldReader;
}

/** Место создаваемой папки: родитель и выше, проект папки, вид. */
export function placeOfNewNode(
  projectId: string,
  parentId: string | null,
  kindId: string,
  values: Record<string, unknown>,
): NewRecordPlace {
  const folders = foldersFrom(parentId);
  return {
    place: {
      host: 'node',
      typeId: kindId,
      folders,
      ...projectPlace(projectId),
      parentTaskId: null,
      fieldValue: fieldValueOf(values),
    },
    field: segmentReaderOf(values, projectId, folders),
  };
}

/** Место создаваемого проекта: сам себе не контейнер — тип и портфель. */
export function placeOfNewProject(
  typeId: string,
  portfolioId: string | null,
  values: Record<string, unknown>,
): NewRecordPlace {
  return {
    place: {
      host: 'project',
      typeId,
      folders: [],
      projectId: null,
      portfolioId,
      projectTypeId: typeId,
      parentTaskId: null,
      fieldValue: fieldValueOf(values),
    },
    // Поле проекта у проекта-хоста — его собственное.
    field: (segment) =>
      segment.source === 'self' || segment.source === 'project'
        ? (fieldValueOf(values)(segment.fieldNumber) ?? '')
        : '',
  };
}

/** Место создаваемой задачи (до попадания в список). */
export function placeOfNewTask(input: {
  nodeId: string | null;
  projectId: string | null;
  parentId: string | null;
  typeId: string;
  values: Record<string, unknown>;
  parentValues?: Record<string, unknown>;
}): NewRecordPlace {
  const folders = foldersFrom(input.nodeId);
  return {
    place: {
      host: 'task',
      typeId: input.typeId,
      folders,
      ...projectPlace(input.projectId),
      parentTaskId: input.parentId,
      fieldValue: fieldValueOf(input.values),
    },
    field: segmentReaderOf(input.values, input.projectId, folders, input.parentValues),
  };
}

/** Значения counter-полей из тела создания отбрасываются молча (номер
 *  выдаёт процесс, ручной записи нет — как формульные ячейки #660). */
export function stripCounterValues<T extends Record<string, unknown>>(values: T): T {
  const out = { ...values };
  for (const definition of demoCustomFieldDefinitions) {
    if (definition.type === 'counter') delete out[definition.id];
  }
  return out;
}

export interface EmptySegmentInfo {
  fieldNumber: number;
  source: NumberFieldSource;
  name: string;
}

/** Почему номер не выдан: нет места (условия) или пустое поле-вставка без
 *  подтверждения человека. Ничего не потрачено. */
export type NumberingFailure =
  | {
      kind: 'missing';
      fieldId: string;
      fieldName: string;
      reason: NumberContainerMissingReason;
      index: number;
      /** Имя того, чего не нашлось: вид папки («Комплект») или поле. */
      name: string;
    }
  | {
      kind: 'empty';
      fieldId: string;
      fieldName: string;
      segments: EmptySegmentInfo[];
      example: string;
    };

export type NumberingPlan =
  | { ok: true; issue: (hostId: string) => Record<string, string> }
  | { ok: false; failure: NumberingFailure };

interface PendingNumber {
  fieldId: string;
  rule: NumberSeriesRule;
  hits: Parameters<typeof issueMockNumber>[2];
}

const nameOfNumber = (fieldNumber: number) =>
  demoCustomFieldDefinitions.find((entry) => entry.number === fieldNumber)?.name ?? '—';

/** Имя условия для текста отказа: вид папки или поле (остальным — пусто). */
function conditionName(rule: NumberSeriesRule, index: number): string {
  const container = rule.containers[index];
  if (container?.kind === 'folder') {
    return demoNodeKinds.find((kind) => kind.id === container.nodeKindId)?.name ?? '';
  }
  return container?.kind === 'field' ? nameOfNumber(container.fieldNumber) : '';
}

/**
 * Общий план выдачи нескольких номеров одним действием (#630): значения
 * условий и пустые вставки проверяются ДО любой выдачи — отказ одного
 * номера отклоняет всё действие (как транзакция сервера); порядок выдачи —
 * по id атрибута (сервер — по id серии, без встречных блокировок).
 */
export function planNumbers(
  fieldIds: readonly string[],
  target: NewRecordPlace,
  opts: {
    hostKind: NumberHostKind;
    source: NumberIssueSource;
    sourceLabel?: string | null;
    confirmEmpty?: boolean;
  },
): NumberingPlan {
  const pending: PendingNumber[] = [];
  for (const fieldId of [...fieldIds].sort()) {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
    const rule = definition?.type === 'counter' ? definition.numbering?.rule : undefined;
    if (!definition || !rule) continue;
    const resolved = resolveNumberContainers(rule.containers, target.place);
    if (!resolved.ok) {
      return {
        ok: false,
        failure: {
          kind: 'missing',
          fieldId,
          fieldName: definition.name,
          reason: resolved.reason,
          index: resolved.index,
          name: conditionName(rule, resolved.index),
        },
      };
    }
    const empty = numberEmptySegments(rule.template, target.field);
    if (empty.length > 0 && !opts.confirmEmpty) {
      return {
        ok: false,
        failure: {
          kind: 'empty',
          fieldId,
          fieldName: definition.name,
          segments: empty.map((segment) => ({
            fieldNumber: segment.fieldNumber,
            source: segment.source,
            name: nameOfNumber(segment.fieldNumber),
          })),
          example: renderNumberTemplate(rule.template, {
            seq: rule.startValue,
            ...minskParts(),
            field: target.field,
          }),
        },
      };
    }
    pending.push({ fieldId, rule, hits: resolved.hits });
  }
  return {
    ok: true,
    issue: (hostId) =>
      Object.fromEntries(
        pending.map(({ fieldId, rule, hits }) => [
          fieldId,
          issueMockNumber(
            fieldId,
            rule,
            hits,
            { hostKind: opts.hostKind, hostId, source: opts.source, sourceLabel: opts.sourceLabel },
            target.field,
          ),
        ]),
      ),
  };
}

/** Счётчики, у которых тип отмечен «при создании» (и смена типа на него). */
export function onCreateCounters(host: NumberHostKind, typeId: string): string[] {
  return demoCustomFieldDefinitions
    .filter((definition) => {
      if (definition.type !== 'counter' || !definition.numbering) return false;
      if (!definition.numbering.onCreate.includes(typeId)) return false;
      const { bindings } = definition;
      if (host === 'node') return bindings.nodeKindIds.includes(typeId);
      if (host === 'project') return bindings.projectTypeIds.includes(typeId);
      return bindings.processTypeIds.includes(typeId);
    })
    .map((definition) => definition.id);
}

/**
 * Выдача «при создании» (#630): все счётчики, у которых тип создаваемой
 * записи отмечен «при создании». Смена типа (`source: 'type_change'`) — тот
 * же путь, но поле, где номер уже есть, не трогается: кто первым заполнил —
 * тот выдал.
 */
export function planOnCreate(
  target: NewRecordPlace,
  values: Record<string, unknown>,
  opts: { source: 'create' | 'type_change'; confirmEmpty?: boolean },
): NumberingPlan {
  const typeId = target.place.typeId ?? '';
  const fieldIds = onCreateCounters(target.place.host, typeId).filter(
    (fieldId) => values[fieldId] === undefined || values[fieldId] === null,
  );
  return planNumbers(fieldIds, target, {
    hostKind: target.place.host,
    source: opts.source,
    confirmEmpty: opts.confirmEmpty,
  });
}
