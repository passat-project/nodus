import { ui, type WorkflowDocument, type WorkflowProblem } from '@nodus/contracts';

/** Хозяин дефекта: статус, кнопка-переход или действие без смены статуса. */
function ownerOf(
  document: WorkflowDocument,
  problem: WorkflowProblem,
): { prefix: string; name: string } | null {
  const nameOf = (name: string | undefined): string | null => {
    const trimmed = name?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  };
  if (problem.actionId !== undefined) {
    const action = (document.actions ?? []).find((a) => a.id === problem.actionId);
    const name = nameOf(action?.name);
    return name ? { prefix: 'В действии', name } : null;
  }
  if (problem.transitionId !== undefined) {
    const transition = document.transitions.find((t) => t.id === problem.transitionId);
    const name = nameOf(transition?.name);
    return name ? { prefix: 'В кнопке', name } : null;
  }
  if (problem.stageId !== undefined) {
    const stage = document.stages.find((s) => s.id === problem.stageId);
    const name = nameOf(stage?.name);
    return name ? { prefix: 'В статусе', name } : null;
  }
  return null;
}

/** Строчная первая буква: текст проблемы становится продолжением фразы
 *  «В действии «X» …». Русские тексты начинаются с заглавной — остальное
 *  в строке не трогаем. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Человекочитаемое сообщение отказа публикации (ответ владельца 12.11):
 * первый блокирующий дефект с именем хозяина — «В действии «X» включено
 * окно, но не выбрано ни одного раздела…». Код ошибки остаётся каноническим
 * (`WORKFLOW_INVALID`), полный перечень — в `details.problems`; здесь одна
 * фраза для логов и не-UI клиентов. Тексты берутся из i18n контрактов (I15):
 * сервер и редактор говорят одними словами.
 */
export function publishRejectionMessage(
  document: WorkflowDocument,
  problems: readonly WorkflowProblem[],
): string {
  const first = problems.find((p) => p.severity === 'error') ?? problems[0];
  if (!first) return 'Workflow document is invalid';
  const text = ui.automation.problems[first.code];
  const owner = ownerOf(document, first);
  return owner ? `${owner.prefix} «${owner.name}» ${lowerFirst(text)}` : text;
}
