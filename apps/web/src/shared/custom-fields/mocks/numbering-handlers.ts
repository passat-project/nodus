import { http, HttpResponse } from 'msw';
import type { NumberBackfillGroup, NumberContainerHit } from '@nodus/contracts';
import {
  ErrorCode,
  numberBackfillBodySchema,
  numberCountKey,
  numberCoverageBodySchema,
  numberEmptySegments,
  numberHostKindSchema,
  numberPreviewBodySchema,
  renderNumberTemplate,
  resolveNumberContainers,
  setNumberNextBodySchema,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import {
  counterRuleOf,
  issueMockNumber,
  minskParts,
  mockContainerRef,
  mockCounts,
  mockHostAssignments,
  mockIssuedCount,
  peekMockNumber,
  setMockNext,
} from '../../mocks/data/numbering-store.js';
import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { demoTasks } from '../../mocks/data/tasks.js';
import { error } from './custom-fields-mock-utils.js';
import {
  backfillPlan,
  hitsOfIds,
  hostsOf,
  sampleOf,
  type BackfillPlanItem,
} from './numbering-hosts.js';

/**
 * API счётчиков мок-мира (#630, модель v3): охват, «Проверка на записи»,
 * «Текущие счета», «Следующий номер» (только вперёд), выдача существующим
 * (предпросмотр + одобрение), номера записи. Правила — как у сервера: 409
 * NUMBER_NEXT_BACKWARDS / NUMBER_BACKFILL_STALE, причины отсутствия места,
 * «тип не получает номер», невидимые записи — только числом.
 */
export const numberingHandlers = [
  http.post('/api/v1/custom-fields/numbering/coverage', async ({ request }) => {
    const parsed = numberCoverageBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400);
    const { rule, participantTypeIds } = parsed.data;
    const hosts = hostsOf(participantTypeIds);
    const outside = hosts.flatMap((host) => {
      const resolved = resolveNumberContainers(rule.containers, host.target.place);
      return resolved.ok ? [] : [{ host, reason: resolved.reason }];
    });
    return HttpResponse.json({
      total: hosts.length,
      inside: hosts.length - outside.length,
      outside: outside
        .filter((entry) => entry.host.visible)
        .slice(0, 5)
        .map((entry) => sampleOf(entry.host, entry.reason)),
      hiddenOutside: outside.filter((entry) => !entry.host.visible).length,
    });
  }),

  http.post('/api/v1/custom-fields/numbering/preview', async ({ request }) => {
    const parsed = numberPreviewBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400);
    const { rule, host, participantTypeIds, definitionId } = parsed.data;
    const record = hostsOf(participantTypeIds).find(
      (entry) => entry.kind === host.kind && entry.id === host.id,
    );
    const task = demoTasks.find((entry) => entry.id === host.id);
    const hostName = record?.name ?? task?.title ?? findDemoNodeRow(host.id)?.name ?? host.id;
    if (!record) return HttpResponse.json({ ok: false, hostName, reason: 'not_participant' });
    const resolved = resolveNumberContainers(rule.containers, record.target.place);
    if (!resolved.ok) return HttpResponse.json({ ok: false, hostName, reason: resolved.reason });
    const next = peekMockNumber(definitionId ?? 'draft', rule, resolved.hits, record.target.field);
    const existing = definitionId ? record.values()[definitionId] : undefined;
    return HttpResponse.json({
      ok: true,
      hostName,
      containers: resolved.hits.map(mockContainerRef),
      nextDisplay: next.display,
      alreadyAssigned: typeof existing === 'string' ? existing : null,
      emptySegments: numberEmptySegments(rule.template, record.target.field).map(
        (segment) =>
          demoCustomFieldDefinitions.find((entry) => entry.number === segment.fieldNumber)?.name ??
          '—',
      ),
    });
  }),

  http.get('/api/v1/custom-fields/definitions/:id/numbering/counts', ({ params, request }) => {
    const id = String(params.id);
    const rule = counterRuleOf(id);
    if (!rule) return error(ErrorCode.NOT_FOUND, 'Counter not found', 404);
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return HttpResponse.json({
      items: mockCounts(id, rule, q),
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
    const hits = hitsOfIds(rule, parsed.data.containerIds);
    if (!hits) return error(ErrorCode.VALIDATION_FAILED, 'containerIds do not match the rule', 422);
    if (!setMockNext(id, rule, hits, parsed.data.nextValue)) {
      return error(ErrorCode.NUMBER_NEXT_BACKWARDS, 'Next number is below issued', 409);
    }
    return HttpResponse.json({
      items: mockCounts(id, rule, ''),
      nextCursor: null,
      totals: { counts: mockCounts(id, rule, '').length, issued: mockIssuedCount(id) },
    });
  }),

  // Выдача существующим: предпросмотр — сколько, где, первые/последние
  // номера, кто не получит и почему; ничего не тратит.
  http.post('/api/v1/custom-fields/definitions/:id/numbering/backfill/preview', ({ params }) => {
    const id = String(params.id);
    const definition = demoCustomFieldDefinitions.find((entry) => entry.id === id);
    const rule = definition?.numbering?.rule;
    if (!definition || !rule) return error(ErrorCode.NOT_FOUND, 'Counter not found', 404);
    const { items, blocked } = backfillPlan(id, rule, definition.bindings);
    const groups = new Map<
      string,
      {
        hits: NumberContainerHit[];
        seqs: number[];
        field: BackfillPlanItem['host']['target']['field'];
      }
    >();
    const at = minskParts();
    for (const item of items) {
      const key = numberCountKey(
        item.hits.map((hit) => hit.id),
        '',
      );
      const group = groups.get(key) ?? { hits: item.hits, seqs: [], field: item.host.target.field };
      const base =
        group.seqs.length === 0
          ? peekMockNumber(id, rule, item.hits).value
          : group.seqs.at(-1)! + rule.step;
      group.seqs.push(base);
      groups.set(key, group);
    }
    const display = (seq: number, field: BackfillPlanItem['host']['target']['field']) =>
      renderNumberTemplate(rule.template, { seq, ...at, field });
    const out: NumberBackfillGroup[] = [...groups.values()]
      .sort((a, b) => b.seqs.length - a.seqs.length)
      .slice(0, 20)
      .map((group) => ({
        containers: group.hits.map(mockContainerRef),
        count: group.seqs.length,
        firstDisplay: display(group.seqs[0]!, group.field),
        lastDisplay: display(group.seqs.at(-1)!, group.field),
      }));
    return HttpResponse.json({
      total: items.length,
      groups: out,
      blocked: blocked
        .filter((entry) => entry.host.visible)
        .slice(0, 5)
        .map((entry) => sampleOf(entry.host, entry.reason)),
      blockedTotal: blocked.length,
      emptyParts: items.filter((item) => item.empty).length,
    });
  }),

  http.post(
    '/api/v1/custom-fields/definitions/:id/numbering/backfill',
    async ({ params, request }) => {
      const id = String(params.id);
      const definition = demoCustomFieldDefinitions.find((entry) => entry.id === id);
      const rule = definition?.numbering?.rule;
      if (!definition || !rule) return error(ErrorCode.NOT_FOUND, 'Counter not found', 404);
      const parsed = numberBackfillBodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400);
      const { items } = backfillPlan(id, rule, definition.bindings);
      if (items.length !== parsed.data.expectedTotal) {
        return error(ErrorCode.NUMBER_BACKFILL_STALE, 'Records changed since preview', 409, {
          total: items.length,
        });
      }
      let issued = 0;
      for (const item of items) {
        if (item.empty && !parsed.data.confirmEmptyNumberParts) continue;
        const display = issueMockNumber(
          id,
          rule,
          item.hits,
          { hostKind: item.host.kind, hostId: item.host.id, source: 'backfill' },
          item.host.target.field,
        );
        item.host.write(id, display);
        issued += 1;
      }
      return HttpResponse.json({ issued });
    },
  ),

  // Номера записи: карточка («выдан в КЖ-01, кем, как») и окно переноса.
  http.get('/api/v1/custom-fields/numbering/host/:kind/:id', ({ params }) => {
    const kind = numberHostKindSchema.safeParse(params.kind);
    if (!kind.success) return error(ErrorCode.VALIDATION_FAILED, 'Unknown host kind', 400);
    return HttpResponse.json({ items: mockHostAssignments(kind.data, String(params.id)) });
  }),
];
