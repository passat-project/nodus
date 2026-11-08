import type {
  NumberContainerKind,
  NumberContainerRef,
  NumberCount,
  NumberIssuer,
  NumberPlace,
  NumberSeriesRule,
  TaskListItem,
} from '@nodus/contracts';
import { numberCountKey, numberPeriodKey, renderNumberTemplate } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { fieldIds } from './field-ids.js';
import { findDemoNodeRow } from './project-nodes.js';
import { demoProjectGroups, demoProjectRows } from './projects.js';
import { nodeIds } from './project-node-ids.js';
import { demoTasks } from './tasks.js';
import { demoWorkflowDetails } from './workflows.js';

/**
 * Мок-стор счетов счётчиков (#630): зеркало `number_counters` +
 * `number_assignments` сервера в памяти. Ключ счёта — контрактный
 * `numberCountKey` (контейнер × период), рендер — `renderNumberTemplate`
 * (одна грамматика с сервером). Сид: КЖ-01 уже выдал «Изм. 1», общий счёт
 * «Взял изм» — 1041, книга этого года — «15-ГГ». Живёт до перезагрузки.
 */
interface CountRow {
  containerKind: NumberContainerKind | 'company';
  containerId: string | null;
  periodKey: string;
  lastValue: number;
}

const counts = new Map<string, Map<string, CountRow>>();
const issued = new Map<string, number>();

/** Части момента по Минску — как `COMPANY_TIMEZONE` сервера. */
export function minskParts(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 0),
  };
}

function rowsOf(fieldId: string): Map<string, CountRow> {
  let rows = counts.get(fieldId);
  if (!rows) {
    rows = new Map();
    counts.set(fieldId, rows);
  }
  return rows;
}

function seed(fieldId: string, row: CountRow) {
  rowsOf(fieldId).set(numberCountKey(row.containerId, row.periodKey), row);
  issued.set(fieldId, (issued.get(fieldId) ?? 0) + 1);
}

seed(fieldIds.changeNumber, {
  containerKind: 'folder',
  containerId: nodeIds.kzh01,
  periodKey: '',
  lastValue: 1,
});
seed(fieldIds.tookChangeNumber, {
  containerKind: 'company',
  containerId: null,
  periodKey: '',
  lastValue: 1041,
});
seed(fieldIds.permitNumber, {
  containerKind: 'company',
  containerId: null,
  periodKey: String(minskParts().year),
  lastValue: 15,
});

/** Правило counter-атрибута из мок-магазина (null — атрибут не счётчик). */
export function counterRuleOf(fieldId: string): NumberSeriesRule | null {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
  return definition?.type === 'counter' ? (definition.numbering?.rule ?? null) : null;
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
    folders,
    projectId: project?.id ?? null,
    portfolioId: project?.portfolioId ?? null,
    parentTaskId: task.parentId,
    fieldValue: (number) => {
      const definition = demoCustomFieldDefinitions.find((entry) => entry.number === number);
      const value = definition ? task.customFields[definition.id] : undefined;
      return typeof value === 'string' && value ? value : null;
    },
  };
}

function render(rule: NumberSeriesRule, seq: number, now: Date) {
  return renderNumberTemplate(rule.template, { seq, ...minskParts(now), field: () => '…' });
}

/** Пример номера правила: первый номер нового счёта сейчас. */
export function counterPreview(rule: NumberSeriesRule): string {
  return render(rule, rule.startValue, new Date());
}

/** Следующий номер счёта без выдачи (проверка на записи, «Текущие счета»). */
export function peekMockNumber(
  fieldId: string,
  rule: NumberSeriesRule,
  containerId: string | null,
  now: Date = new Date(),
): { value: number; display: string } {
  const key = numberCountKey(containerId, numberPeriodKey(rule.period, minskParts(now)));
  const row = rowsOf(fieldId).get(key);
  const value = row ? row.lastValue + 1 : rule.startValue;
  return { value, display: render(rule, value, now) };
}

/** Выдать номер: upsert счёта + журнал (как `NumberSeriesService.next`). */
export function issueMockNumber(
  fieldId: string,
  rule: NumberSeriesRule,
  containerId: string | null,
  now: Date = new Date(),
): string {
  const periodKey = numberPeriodKey(rule.period, minskParts(now));
  const key = numberCountKey(containerId, periodKey);
  const rows = rowsOf(fieldId);
  const row = rows.get(key);
  const seq = row ? row.lastValue + 1 : rule.startValue;
  rows.set(key, { containerKind: rule.container.kind, containerId, periodKey, lastValue: seq });
  issued.set(fieldId, (issued.get(fieldId) ?? 0) + 1);
  return render(rule, seq, now);
}

/** «Следующий номер» — только вперёд (false — назад, 409 у хендлера). */
export function setMockNext(
  fieldId: string,
  rule: NumberSeriesRule,
  containerId: string | null,
  nextValue: number,
  now: Date = new Date(),
): boolean {
  const periodKey = numberPeriodKey(rule.period, minskParts(now));
  const key = numberCountKey(containerId, periodKey);
  const rows = rowsOf(fieldId);
  const row = rows.get(key);
  if (row && row.lastValue > nextValue - 1) return false;
  rows.set(key, {
    containerKind: rule.container.kind,
    containerId,
    periodKey,
    lastValue: nextValue - 1,
  });
  return true;
}

/** Сколько номеров выдано атрибуту (журнал мок-мира). */
export function mockIssuedCount(fieldId: string): number {
  return issued.get(fieldId) ?? 0;
}

/** Кнопки опубликованных маршрутов, выдающие номер атрибута. */
export function mockIssuers(fieldId: string): NumberIssuer[] {
  const out: NumberIssuer[] = [];
  for (const detail of Object.values(demoWorkflowDetails)) {
    for (const transition of detail.document.transitions) {
      const issues = transition.rules.postFunctions.some(
        (pf) => pf.kind === 'assign_number' && pf.fieldId === fieldId,
      );
      if (!issues) continue;
      for (const typeId of detail.typeIds) {
        out.push({
          processTypeId: typeId,
          transitionId: transition.id,
          transitionName: transition.name,
        });
      }
    }
  }
  return out;
}

/** Контейнер счёта, как его видит администратор: имя и путь по дереву. */
export function mockContainerRef(kind: NumberContainerKind, id: string): NumberContainerRef | null {
  const ref = (name: string, path: string[] = [], deleted = false): NumberContainerRef => ({
    kind: kind as NumberContainerRef['kind'],
    id,
    name,
    path,
    hidden: false,
    deleted,
  });
  switch (kind) {
    case 'company':
      return null;
    case 'folder': {
      const node = findDemoNodeRow(id);
      if (!node) return ref('Папка', [], true);
      const path: string[] = [];
      let parent = node.parentId ? findDemoNodeRow(node.parentId) : undefined;
      while (parent) {
        path.unshift(parent.name);
        parent = parent.parentId ? findDemoNodeRow(parent.parentId) : undefined;
      }
      const project = demoProjectRows.find((row) => row.id === node.projectId);
      return ref(node.name, project ? [project.name, ...path] : path);
    }
    case 'project':
      return ref(demoProjectRows.find((row) => row.id === id)?.name ?? 'Проект');
    case 'portfolio':
      return ref(demoProjectGroups.find((group) => group.id === id)?.name ?? 'Портфель');
    case 'parent_task':
      return ref(demoTasks.find((task) => task.id === id)?.title ?? 'Задача');
    case 'field':
      return ref(id);
  }
}

/** «Текущие счета» атрибута: свежие сверху, поиск по имени контейнера. */
export function mockCounts(fieldId: string, rule: NumberSeriesRule, q: string): NumberCount[] {
  const now = new Date();
  const needle = q.trim().toLowerCase();
  return [...rowsOf(fieldId).values()]
    .map((row) => {
      const container = row.containerId
        ? mockContainerRef(row.containerKind, row.containerId)
        : null;
      return {
        container,
        periodKey: row.periodKey,
        lastValue: row.lastValue,
        lastDisplay: row.lastValue >= rule.startValue ? render(rule, row.lastValue, now) : null,
        nextValue: row.lastValue + 1,
        nextDisplay: render(rule, row.lastValue + 1, now),
      };
    })
    .filter((count) =>
      needle ? (count.container?.name ?? '').toLowerCase().includes(needle) : true,
    )
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}
