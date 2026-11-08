import type {
  NumberContainerHit,
  NumberCount,
  NumberHostAssignment,
  NumberHostKind,
  NumberIssueSource,
  NumberMoment,
  NumberPlace,
  NumberSeriesRule,
  NumberTemplateFieldReader,
  TaskListItem,
} from '@nodus/contracts';
import { numberCountKey, numberPeriodKey, renderNumberTemplate } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { fieldIds } from './field-ids.js';
import { findDemoNodeRow } from './project-nodes.js';
import { demoProjectRows } from './projects.js';
import { nodeIds } from './project-node-ids.js';
import { tid } from './task-item-factory.js';
import { demoTasks } from './tasks.js';
import { mockContainerRef } from './numbering-refs.js';

export { mockContainerRef, mockIssuers } from './numbering-refs.js';

/**
 * Мок-стор счетов счётчиков (#630, модель v3): зеркало `number_counters` +
 * `number_assignments` сервера в памяти. Ключ счёта — контрактный
 * `numberCountKey` (значения условий × период), рендер —
 * `renderNumberTemplate` (одна грамматика с сервером). Сид: КЖ-01 при
 * создании работ выдал «Изм. 1», «Изм. 2», КЖ-02 — «Изм. 1»; книга этого
 * года — 15…17 (до 14 — Excel). Живёт до перезагрузки.
 */
interface CountRow {
  hits: NumberContainerHit[];
  periodKey: string;
  lastValue: number;
}

/** Строка журнала: значения условий хранятся id-шками, имена и пути —
 *  при чтении (как сервер: переименование папки видно в истории). */
interface JournalRow extends Omit<NumberHostAssignment, 'containers'> {
  hostKind: NumberHostKind;
  hostId: string;
  hits: NumberContainerHit[];
}

const counts = new Map<string, Map<string, CountRow>>();
const journal: JournalRow[] = [];

/** Части момента по Минску — как `COMPANY_TIMEZONE` сервера. */
export function minskParts(now: Date = new Date()): NumberMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function rowsOf(fieldId: string): Map<string, CountRow> {
  let rows = counts.get(fieldId);
  if (!rows) {
    rows = new Map();
    counts.set(fieldId, rows);
  }
  return rows;
}

const keyOf = (hits: readonly NumberContainerHit[], periodKey: string) =>
  numberCountKey(
    hits.map((hit) => hit.id),
    periodKey,
  );

/** Сид: счёт и (если дана запись) строка журнала «выдан при создании». */
function seed(
  fieldId: string,
  row: CountRow,
  issuedTo: { hostKind: NumberHostKind; hostId: string; display: string; seq: number }[] = [],
) {
  rowsOf(fieldId).set(keyOf(row.hits, row.periodKey), row);
  for (const entry of issuedTo) {
    journal.push({
      fieldId,
      hostKind: entry.hostKind,
      hostId: entry.hostId,
      display: entry.display,
      hits: [...row.hits],
      periodKey: row.periodKey,
      assignedAt: new Date(Date.now() - 86_400_000 * (3 - entry.seq)).toISOString(),
      actorName: 'Климович А.',
      source: 'create',
      sourceLabel: null,
    });
  }
}

const inFolder = (id: string): NumberContainerHit[] => [{ entity: 'node', id }];
const yearKey = String(minskParts().year);
const yy = yearKey.slice(-2);

seed(fieldIds.changeNumber, { hits: inFolder(nodeIds.kzh01), periodKey: '', lastValue: 2 }, [
  { hostKind: 'task', hostId: tid(630), display: 'Изм. 1', seq: 1 },
  { hostKind: 'task', hostId: tid(631), display: 'Изм. 2', seq: 2 },
]);
seed(fieldIds.changeNumber, { hits: inFolder(nodeIds.kzh02), periodKey: '', lastValue: 1 }, [
  { hostKind: 'task', hostId: tid(632), display: 'Изм. 1', seq: 1 },
]);
// Книга изменений: до 14 номера брали в Excel, «следующий» задан 15.
seed(fieldIds.permitNumber, { hits: [], periodKey: yearKey, lastValue: 17 }, [
  { hostKind: 'task', hostId: tid(630), display: `15-${yy}`, seq: 1 },
  { hostKind: 'task', hostId: tid(631), display: `16-${yy}`, seq: 2 },
  { hostKind: 'task', hostId: tid(632), display: `17-${yy}`, seq: 2 },
]);
seed(fieldIds.komplektSeq, { hits: inFolder(nodeIds.b1kr), periodKey: '', lastValue: 2 }, [
  { hostKind: 'node', hostId: nodeIds.kzh01, display: 'К-01', seq: 1 },
  { hostKind: 'node', hostId: nodeIds.kzh02, display: 'К-02', seq: 2 },
]);

/** Правило counter-атрибута из мок-магазина (null — атрибут не счётчик). */
export function counterRuleOf(fieldId: string): NumberSeriesRule | null {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
  return definition?.type === 'counter' ? (definition.numbering?.rule ?? null) : null;
}

/** Типы, получающие номер атрибута при создании (`numbering.onCreate`). */
export function counterOnCreateOf(fieldId: string): readonly string[] {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
  return definition?.type === 'counter' ? (definition.numbering?.onCreate ?? []) : [];
}

/** Значение поля по внутреннему номеру из значений записи. */
export function fieldValueOf(values: Record<string, unknown>) {
  return (fieldNumber: number): string | null => {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.number === fieldNumber);
    const value = definition ? values[definition.id] : undefined;
    return typeof value === 'string' && value ? value : null;
  };
}

/** Читатель полей-вставок номера по месту записи (как порты сервера). */
export function segmentReaderOf(
  values: Record<string, unknown>,
  projectId: string | null,
  folders: readonly { id: string; kindId: string }[] = [],
  parentValues: Record<string, unknown> = {},
): NumberTemplateFieldReader {
  return (segment) => {
    const project = demoProjectRows.find((row) => row.id === projectId);
    const source: Record<string, unknown> =
      segment.source === 'self'
        ? values
        : segment.source === 'project'
          ? (project?.customFields ?? {})
          : segment.source === 'parent_task'
            ? parentValues
            : segment.source === 'folder'
              ? (findDemoNodeRow(
                  folders.find((folder) => folder.kindId === segment.nodeKindId)?.id ?? '',
                )?.customFields ?? {})
              : {};
    return fieldValueOf(source)(segment.fieldNumber) ?? '';
  };
}

/** Место задачи в дереве мок-мира (как порты сервера). */
export function placeOfTask(task: TaskListItem): NumberPlace {
  const folders: { id: string; kindId: string }[] = [];
  let current = task.nodeId ? findDemoNodeRow(task.nodeId) : undefined;
  while (current) {
    folders.push({ id: current.id, kindId: current.kindId });
    current = current.parentId ? findDemoNodeRow(current.parentId) : undefined;
  }
  const project = demoProjectRows.find((row) => row.id === task.project?.id);
  return {
    host: 'task',
    typeId: task.type.id,
    folders,
    projectId: project?.id ?? null,
    portfolioId: project?.portfolioId ?? null,
    projectTypeId: project?.typeId ?? null,
    parentTaskId: task.parentId,
    fieldValue: fieldValueOf(task.customFields),
  };
}

/** Читатель полей-вставок для задачи. */
export function segmentReaderOfTask(task: TaskListItem): NumberTemplateFieldReader {
  const place = placeOfTask(task);
  const parent = task.parentId ? demoTasks.find((entry) => entry.id === task.parentId) : undefined;
  return segmentReaderOf(task.customFields, place.projectId, place.folders, parent?.customFields);
}

function render(
  rule: NumberSeriesRule,
  seq: number,
  now: Date,
  field: NumberTemplateFieldReader = () => '…',
) {
  return renderNumberTemplate(rule.template, { seq, ...minskParts(now), field });
}

/** Пример номера правила: первый номер нового счёта сейчас. */
export function counterPreview(rule: NumberSeriesRule): string {
  return render(rule, rule.startValue, new Date());
}

/** Следующий номер счёта без выдачи (проверка на записи, «Текущие счета»). */
export function peekMockNumber(
  fieldId: string,
  rule: NumberSeriesRule,
  hits: readonly NumberContainerHit[],
  field?: NumberTemplateFieldReader,
  now: Date = new Date(),
): { value: number; display: string } {
  const row = rowsOf(fieldId).get(keyOf(hits, numberPeriodKey(rule.period, minskParts(now))));
  const value = row ? row.lastValue + rule.step : rule.startValue;
  return { value, display: render(rule, value, now, field) };
}

export interface MockIssueHost {
  hostKind: NumberHostKind;
  hostId: string;
  source: NumberIssueSource;
  sourceLabel?: string | null;
}

/** Выдать номер: upsert счёта + журнал (как `NumberSeriesService.next`). */
export function issueMockNumber(
  fieldId: string,
  rule: NumberSeriesRule,
  hits: readonly NumberContainerHit[],
  host: MockIssueHost,
  field?: NumberTemplateFieldReader,
  now: Date = new Date(),
): string {
  const periodKey = numberPeriodKey(rule.period, minskParts(now));
  const key = keyOf(hits, periodKey);
  const rows = rowsOf(fieldId);
  const row = rows.get(key);
  const seq = row ? row.lastValue + rule.step : rule.startValue;
  rows.set(key, { hits: [...hits], periodKey, lastValue: seq });
  const display = render(rule, seq, now, field);
  journal.push({
    fieldId,
    hostKind: host.hostKind,
    hostId: host.hostId,
    display,
    hits: [...hits],
    periodKey,
    assignedAt: now.toISOString(),
    actorName: 'Климович А.',
    source: host.source,
    sourceLabel: host.sourceLabel ?? null,
  });
  return display;
}

/** «Следующий номер» — только вперёд (false — назад, 409 у хендлера). */
export function setMockNext(
  fieldId: string,
  rule: NumberSeriesRule,
  hits: readonly NumberContainerHit[],
  nextValue: number,
  now: Date = new Date(),
): boolean {
  const periodKey = numberPeriodKey(rule.period, minskParts(now));
  const key = keyOf(hits, periodKey);
  const rows = rowsOf(fieldId);
  const row = rows.get(key);
  const target = nextValue - rule.step;
  if (row && row.lastValue > target) return false;
  rows.set(key, { hits: [...hits], periodKey, lastValue: target });
  return true;
}

/** Сколько номеров выдано атрибуту (журнал мок-мира). */
export function mockIssuedCount(fieldId: string): number {
  return journal.filter((entry) => entry.fieldId === fieldId).length;
}

/** Номера одной записи (карточка «выдан в КЖ-01», окно переноса). */
export function mockHostAssignments(
  hostKind: NumberHostKind,
  hostId: string,
): NumberHostAssignment[] {
  return journal
    .filter((entry) => entry.hostKind === hostKind && entry.hostId === hostId)
    .map((entry) => ({
      fieldId: entry.fieldId,
      display: entry.display,
      containers: entry.hits.map(mockContainerRef),
      periodKey: entry.periodKey,
      assignedAt: entry.assignedAt,
      actorName: entry.actorName,
      source: entry.source,
      sourceLabel: entry.sourceLabel,
    }));
}

/** Есть ли у записи номер этого атрибута (журнал) — «кто первым заполнил». */
export function mockHasNumber(fieldId: string, hostKind: NumberHostKind, hostId: string): boolean {
  return journal.some(
    (entry) => entry.fieldId === fieldId && entry.hostKind === hostKind && entry.hostId === hostId,
  );
}

/** «Текущие счета» атрибута: свежие сверху, поиск по имени значения условия. */
export function mockCounts(fieldId: string, rule: NumberSeriesRule, q: string): NumberCount[] {
  const now = new Date();
  const needle = q.trim().toLowerCase();
  return [...rowsOf(fieldId).values()]
    .map((row) => {
      const containers = row.hits.map(mockContainerRef);
      return {
        containers,
        periodKey: row.periodKey,
        lastValue: row.lastValue,
        lastDisplay: row.lastValue >= rule.startValue ? render(rule, row.lastValue, now) : null,
        nextValue: row.lastValue + rule.step,
        nextDisplay: render(rule, row.lastValue + rule.step, now),
      };
    })
    .filter((count) =>
      needle
        ? count.containers.some((container) => container.name.toLowerCase().includes(needle))
        : true,
    )
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}
