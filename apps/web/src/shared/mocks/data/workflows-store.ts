import type { WorkflowDetail } from '@nodus/contracts';
import { customFieldKey, windowFieldKeys } from '@nodus/contracts';

import { demoProcessTypes, demoWorkflowDetails } from './workflows.js';

/** Изменяемое хранилище маршрутов мок-сервера: публикация «Автоматизации»
 *  пишет сюда, реестр атрибутов читает ссылки `cf.<id>` (окно удаления,
 *  #431) — одно состояние на оба домена моков. */

function stageCountDemo(id: string): number {
  const demoCounts: Record<string, number> = {
    '20000000-0000-4000-8000-000000000001': 3,
    '20000000-0000-4000-8000-000000000003': 5,
    '20000000-0000-4000-8000-000000000004': 2,
    '20000000-0000-4000-8000-000000000005': 12,
    '20000000-0000-4000-8000-000000000006': 2,
    '20000000-0000-4000-8000-000000000007': 1,
  };
  return demoCounts[id] ?? 0;
}

export const mockWorkflows = new Map<string, WorkflowDetail>();

for (const [id, detail] of Object.entries(demoWorkflowDetails)) {
  mockWorkflows.set(
    id,
    structuredClone({
      ...detail,
      stageEntityCounts: Object.fromEntries(
        detail.document.stages.map((s) => [s.id, stageCountDemo(s.id)]),
      ),
    }),
  );
}

/** Маршруты, где атрибут стоит в окне перехода или условии «Заполнены
 *  поля» (как серверный поиск ссылок перед удалением, #432). Формы создания
 *  считаются отдельно (`forms`, включая черновики); только опубликованные.
 *  Имя — тип процесса. */
export function workflowsUsingField(fieldId: string): { id: string; name: string }[] {
  const key = customFieldKey(fieldId);
  const result: { id: string; name: string }[] = [];
  for (const detail of mockWorkflows.values()) {
    if (!detail.publishedAt) continue;
    const used = detail.document.transitions.some(
      (t) =>
        (t.form.enabled &&
          t.form.sections.some((s) => s.kind === 'fields' && windowFieldKeys(s).includes(key))) ||
        t.rules.validators.some((v) => v.kind === 'fields_required' && v.fields.includes(key)) ||
        t.rules.conditions.some(
          (c) => c.kind === 'decider_in' && c.source.kind === 'field' && c.source.field === key,
        ),
    );
    if (!used) continue;
    const type = demoProcessTypes.find((entry) => entry.workflowId === detail.id);
    result.push({ id: detail.id, name: type?.name ?? detail.id });
  }
  return result;
}
