import type { WorkflowDocument, WorkflowDraftAction } from '@nodus/contracts';

import { maskCreationForm } from '../../types/process-type.mapper.js';
import { liveLayout } from './layout.js';
import type { LoadedWorkflow } from '../workflow.repository.js';

/** Документ живого маршрута → документ контракта (+ раскладка холста).
 *  `maskPresets` — читателю без `workflow.manage`: значения скрытых полей
 *  формы не отдаются (признак «поле скрыто» сохраняется, #432 security). */
export function documentOf(
  row: LoadedWorkflow,
  layout?: unknown,
  creation?: unknown,
  opts: { maskPresets?: boolean } = {},
): WorkflowDocument {
  const form = creation as WorkflowDocument['creation'];
  return {
    ...(creation === null || creation === undefined
      ? {}
      : { creation: opts.maskPresets && form ? maskCreationForm(form) : form }),
    stages: row.stages.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      color: s.color as WorkflowDocument['stages'][number]['color'],
      systemState: s.systemState as WorkflowDocument['stages'][number]['systemState'],
      outcome: (s.outcome as WorkflowDocument['stages'][number]['outcome']) ?? null,
      isInitial: s.isInitial,
      sortOrder: s.sortOrder,
    })),
    transitions: row.transitions.map((t) => ({
      id: t.id,
      code: null,
      name: t.name,
      fromStageId: t.fromStageId,
      toStageId: t.toStageId,
      display: t.display,
      intent: t.intent,
      sortOrder: t.sortOrder,
      rules: t.rules,
      form: t.form ?? { enabled: false, sections: [] },
    })),
    actions: (row.actions ?? []).map((a) => ({
      id: a.id,
      code: null,
      name: a.name,
      stageId: a.stageId,
      display: a.display,
      sortOrder: a.sortOrder,
      rules: a.rules,
      form: (a.form as WorkflowDraftAction['form']) ?? {
        enabled: false,
        sections: [],
      },
      steps: (a.steps as WorkflowDraftAction['steps']) ?? [],
    })),
    layout: liveLayout(layout, {
      stageIds: new Set(row.stages.map((s) => s.id)),
      transitionIds: new Set(row.transitions.map((t) => t.id)),
    }),
  };
}
