import type { TaskSystemState } from './workflow-primitives.schemas.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Дополнительные предупреждения документа маршрута (#430): мягкий каталог
 * имён статусов, дубли целей кнопок и разрешимость правила `approver_is_actor`.
 * Вынесено из `workflow-document-check.ts` (I5): основная функция уже на
 * пределе, а эти проверки не меняют её порядок ошибок.
 */
export interface ExtraCheckOptions {
  stageNameFacts?: readonly { systemState: TaskSystemState; name: string }[];
}

const warning = (
  code: WorkflowProblem['code'],
  refs: Pick<WorkflowProblem, 'stageId' | 'transitionId'> = {},
): WorkflowProblem => ({ code, severity: 'warning', ...refs });

/** Нормализация имени статуса для «похожего» совпадения: регистр, ё/е,
 *  повторные пробелы. Точное совпадение — отдельный код. */
function normalizeStageName(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function checkExtraRules(
  doc: WorkflowDraftDocument,
  opts: ExtraCheckOptions,
  problems: WorkflowProblem[],
): void {
  const { stages, transitions } = doc;

  // Мягкий каталог имён (#430): точное совпадение в том же этапе другого
  // опубликованного маршрута — норма (одна колонка на доске); похожее после
  // нормализации — отдельная колонка, предупреждаем.
  for (const s of stages) {
    const name = s.name.trim();
    if (name.length === 0) continue;
    const others = (opts.stageNameFacts ?? []).filter((f) => f.systemState === s.systemState);
    const exact = others.some((f) => f.name.trim() === name);
    const similar =
      !exact &&
      others.some(
        (f) => f.name.trim() !== name && normalizeStageName(f.name) === normalizeStageName(name),
      );
    if (exact) problems.push(warning('stage_name_shared', { stageId: s.id }));
    else if (similar) problems.push(warning('stage_name_similar', { stageId: s.id }));
  }

  // Две кнопки из одного статуса в один статус — дубль на доске. Пару
  // «из любого + конкретная» уже ловит duplicate_with_any.
  const seenTargets = new Set<string>();
  for (const t of transitions) {
    if (t.fromStageId === null) continue;
    const key = `${t.fromStageId}>${t.toStageId}`;
    if (seenTargets.has(key)) {
      problems.push(warning('duplicate_transition_target', { transitionId: t.id }));
    }
    seenTargets.add(key);
  }

  // Пропуск по актору: у целевого статуса должна быть ровно одна основная
  // action-кнопка с условиями. Несколько primary / пустые условия уже
  // блокируются ошибками multiple_primary/no_roles — не дублируем.
  const byId = new Map(stages.map((s) => [s.id, s]));
  for (const t of transitions) {
    for (const pf of t.rules.postFunctions) {
      if (pf.kind !== 'route_if' || pf.when !== 'approver_is_actor') continue;
      const approvalStage = byId.get(t.toStageId);
      const primaries = approvalStage
        ? transitions.filter((x) => x.fromStageId === approvalStage.id && x.display === 'primary')
        : [];
      const unresolvable =
        primaries.length === 0 || (primaries.length === 1 && primaries[0]!.intent !== 'action');
      if (unresolvable) {
        problems.push(warning('approver_rule_unresolvable', { transitionId: t.id }));
      }
    }
  }
}
