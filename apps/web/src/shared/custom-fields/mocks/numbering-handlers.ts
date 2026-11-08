import { http, HttpResponse } from 'msw';
import type {
  CustomFieldBindings,
  NumberHostKind,
  NumberPlace,
  NumberSeriesRule,
} from '@nodus/contracts';
import {
  ErrorCode,
  numberContainerReachable,
  numberPreviewBodySchema,
  resolveNumberContainer,
  setNumberNextBodySchema,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import {
  counterRuleOf,
  mockContainerRef,
  mockCounts,
  mockIssuedCount,
  peekMockNumber,
  placeOfTask,
  setMockNext,
} from '../../mocks/data/numbering-store.js';
import { mockTypes } from '../../mocks/data/process-types-store.js';
import { demoTasks } from '../../mocks/data/tasks.js';
import { error } from './custom-fields-mock-utils.js';

/** Вид записи цели привязки (мок-мир): тип процесса → task/letter,
 *  тип проекта → project, вид папки → node. */
function hostOfType(typeId: string): NumberHostKind | null {
  const type = mockTypes.find((entry) => entry.id === typeId);
  return type ? (type.category === 'letter' ? 'letter' : 'task') : null;
}

/** Привязки, чьи записи не лежат в контейнере правила (422 у сервера). */
export function unreachableTargets(
  rule: NumberSeriesRule,
  bindings: CustomFieldBindings,
): string[] {
  const out: string[] = [];
  for (const id of bindings.processTypeIds) {
    const host = hostOfType(id);
    if (host && !numberContainerReachable(rule.container, host)) out.push(id);
  }
  if (!numberContainerReachable(rule.container, 'project')) out.push(...bindings.projectTypeIds);
  if (!numberContainerReachable(rule.container, 'node')) out.push(...bindings.nodeKindIds);
  return out;
}

const emptyPlace = (host: NumberHostKind): NumberPlace => ({
  host,
  folders: [],
  projectId: null,
  portfolioId: null,
  parentTaskId: null,
  fieldValue: () => null,
});

/**
 * API счётчиков мок-мира (#630): «Текущие счета», «Следующий номер» (только
 * вперёд) и «Проверка на записи». Правила — как у сервера (техплан, Пакет
 * B4): 409 NUMBER_NEXT_BACKWARDS, причина отсутствия контейнера, «тип не
 * получает номер». Проверка мок-мира — по задачам (письма/папки/проекты —
 * без дерева, только «вся компания»).
 */
export const numberingHandlers = [
  http.post('/api/v1/custom-fields/numbering/preview', async ({ request }) => {
    const parsed = numberPreviewBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400);
    const { rule, host, participantTypeIds, definitionId } = parsed.data;
    const task = host.kind === 'task' ? demoTasks.find((entry) => entry.id === host.id) : undefined;
    const hostName = task?.title ?? host.id;
    if (task && !participantTypeIds.includes(task.type.id)) {
      return HttpResponse.json({ ok: false, hostName, reason: 'not_participant' });
    }
    const resolved = resolveNumberContainer(
      rule.container,
      task ? placeOfTask(task) : emptyPlace(host.kind),
    );
    if (!resolved.ok) return HttpResponse.json({ ok: false, hostName, reason: resolved.reason });
    const next = definitionId
      ? peekMockNumber(definitionId, rule, resolved.containerId)
      : peekMockNumber('draft', rule, resolved.containerId);
    const existing = definitionId ? task?.customFields[definitionId] : undefined;
    return HttpResponse.json({
      ok: true,
      hostName,
      container: resolved.containerId
        ? mockContainerRef(rule.container.kind, resolved.containerId)
        : null,
      nextDisplay: next.display,
      alreadyAssigned: typeof existing === 'string' ? existing : null,
    });
  }),

  http.get('/api/v1/custom-fields/definitions/:id/numbering/counts', ({ params, request }) => {
    const id = String(params.id);
    const rule = counterRuleOf(id);
    if (!rule) return error(ErrorCode.NOT_FOUND, 'Counter not found', 404);
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const items = mockCounts(id, rule, q);
    return HttpResponse.json({
      items,
      nextCursor: null,
      totals: { counts: mockCounts(id, rule, '').length, issued: mockIssuedCount(id) },
    });
  }),

  http.put('/api/v1/custom-fields/definitions/:id/numbering/next', async ({ params, request }) => {
    const id = String(params.id);
    const rule = counterRuleOf(id);
    if (!rule) return error(ErrorCode.NOT_FOUND, 'Counter not found', 404);
    const parsed = setNumberNextBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400);
    if (!setMockNext(id, rule, parsed.data.containerId, parsed.data.nextValue)) {
      return error(ErrorCode.NUMBER_NEXT_BACKWARDS, 'Next number is below issued', 409);
    }
    return HttpResponse.json({
      items: mockCounts(id, rule, ''),
      nextCursor: null,
      totals: { counts: mockCounts(id, rule, '').length, issued: mockIssuedCount(id) },
    });
  }),
];

/** Сид следующего номера общего счёта при создании (`numberingNext`). */
export function seedCreatedCounter(definitionId: string, next: number | undefined): void {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === definitionId);
  const rule = definition?.numbering?.rule;
  if (rule && next !== undefined && rule.container.kind === 'company') {
    setMockNext(definitionId, rule, null, next);
  }
}
