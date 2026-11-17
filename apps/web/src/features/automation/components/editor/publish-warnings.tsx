import type { WorkflowDraftDocument, WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { CircleAlert } from 'lucide-react';

/**
 * Живые предупреждения редактора в диалоге публикации (#430): одна строка
 * на правило, а не копия текста на каждый элемент. Имена статусов и кнопок,
 * к которым относится правило, — второй строкой: без них шесть одинаковых
 * абзацев «такое имя уже есть» не говорили, где именно.
 */
export function PublishWarnings({
  problems,
  document: doc,
}: {
  problems: readonly WorkflowProblem[];
  document: WorkflowDraftDocument;
}) {
  const groups: { code: WorkflowProblem['code']; names: string[] }[] = [];
  for (const problem of problems) {
    const name = problem.actionId
      ? (doc.actions ?? []).find((action) => action.id === problem.actionId)?.name
      : problem.stageId
        ? doc.stages.find((stage) => stage.id === problem.stageId)?.name
        : problem.transitionId
          ? doc.transitions.find((transition) => transition.id === problem.transitionId)?.name
          : undefined;
    let group = groups.find((item) => item.code === problem.code);
    if (!group) {
      group = { code: problem.code, names: [] };
      groups.push(group);
    }
    if (name && !group.names.includes(name)) group.names.push(name);
  }
  if (groups.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5 rounded-lg bg-warning-soft/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-label-sm font-medium tracking-[0.08em] text-warning uppercase">
        <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {ui.automation.publishWarnings}
      </p>
      <ul className="flex flex-col gap-1.5">
        {groups.map((group) => (
          <li key={group.code} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] leading-relaxed break-words text-warning">
              {ui.automation.problems[group.code]}
            </span>
            {group.names.length > 0 ? (
              <span className="text-xs leading-relaxed break-words text-muted-foreground">
                {group.names.join(', ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
