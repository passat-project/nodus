import type { WorkflowActorSubject } from '../../../../core/ports/workflow-entity.port.js';
import type { LoadedWorkflow } from '../workflow.repository.js';
import {
  evaluateValidators,
  passesConditions,
  type AsyncValidatorReason,
  type TargetContext,
} from '../transition-rules.js';
import { windowOf } from '../transition-form.js';

type Subject = WorkflowActorSubject & { permissions: readonly string[] };

/**
 * Контекст правила `approver_is_actor` (#430): актор — утверждающий статуса,
 * если проходит условия ЕДИНСТВЕННОЙ основной action-кнопки этого статуса
 * без обхода (`bypassConditions=false`), её гейты выполнены на текущих фактах,
 * условие «кто видит» непустое и у кнопки нет обязательных разделов окна
 * (иначе пропуск потерял бы обязательный комментарий/файл). Служебная/
 * несколько/без условий — не утверждающий (консервативно; публикация даст
 * warning `approver_rule_unresolvable`). `validatorReason` (#635) — живые
 * причины проверок records/formula: непройденная проверка целевой кнопки
 * не делает актора утверждающим; без причин матрица прежняя (чистые вызовы).
 */
export function approverContext(
  workflow: LoadedWorkflow,
  subject: Subject,
  validatorReason?: AsyncValidatorReason,
): TargetContext {
  return {
    isActorApprover: (stageId) => {
      const primaries = workflow.transitions.filter(
        (t) => t.fromStageId === stageId && t.display === 'primary',
      );
      if (primaries.length !== 1) return false;
      const primary = primaries[0]!;
      if (primary.intent !== 'action') return false;
      if (primary.rules.conditions.length === 0) return false;
      if (windowOf(primary.form, primary.rules).required.length > 0) return false;
      if (
        !passesConditions(primary.rules, {
          ...subject,
          bypassConditions: false,
        })
      ) {
        return false;
      }
      return evaluateValidators(primary.rules, subject.facts, validatorReason).length === 0;
    },
  };
}
