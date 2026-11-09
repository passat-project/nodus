import type { FormulaHostKind, FormulaNode } from '../custom-fields/formula.js';
import { checkFormulaShape } from '../custom-fields/formula-validation.js';
import { ui } from '../i18n/ru.js';
import { creationSlots } from './creation-form.js';
import type { ProcessCategory } from './process-type.schemas.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Формулы слотов в документе маршрута (#632, Р12; A8-1) — часть общей
 * проверки `checkWorkflowDocument` (одна грамматика редактора и сервера,
 * ADR-0021): `section.formulas` окна перехода и `slot.formula` формы
 * создания обязаны проходить ту же грамматику языка, что и редактор
 * (`checkFormulaShape`): лимиты глубины и размера, арность функций и
 * агрегатов, матрица источников носителя, запрет связанных записей там, где
 * записи ещё нет.
 *
 * Без этой проверки единственным фильтром была zod-схема AST (структура без
 * глубины, арности и матрицы), и обход клиента или устаревший черновик
 * публиковали формулу, которая в рантайме молча давала пустой слот или 422
 * на сохранении значения окна.
 *
 * `typeDefault` — как в редакторе: окно открывается у существующей записи,
 * поэтому related разрешён; форма создания считает ДО создания записи, где
 * related и цепочка папок недоступны. Типы значений и совместимость с типом
 * слота проверяет сервер движком (contracts не зависит от
 * `@nodus/formula-engine`) — код проблемы тот же, `formula_invalid`.
 */

/** Носитель формулы слота по категории маршрута: у письма — письмо. */
function formulaHostOf(category: ProcessCategory): FormulaHostKind {
  return category === 'letter' ? 'letter' : 'task';
}

export function checkFormulaSlots(
  doc: WorkflowDraftDocument,
  category: ProcessCategory,
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const hostKind = formulaHostOf(category);
  const report = (
    ast: unknown,
    typeDefault: boolean,
    refs: Pick<WorkflowProblem, 'transitionId' | 'creationField'>,
  ): void => {
    // Одна плашка на слот: первая (самая внешняя) проблема уже объясняет
    // отказ, остальные — её следствия.
    const issue = checkFormulaShape(ast, hostKind, { typeDefault })[0];
    if (!issue) return;
    problems.push({
      code: 'formula_invalid',
      severity: 'error',
      ...refs,
      detail: ui.formulas.shapeIssues[issue.code],
    });
  };
  for (const t of doc.transitions) {
    if (!t.form?.enabled) continue;
    for (const section of t.form.sections) {
      if (section.kind !== 'fields') continue;
      for (const ast of Object.values(section.formulas ?? {})) {
        report(ast, false, { transitionId: t.id });
      }
    }
  }
  for (const slot of doc.creation ? creationSlots(doc.creation) : []) {
    const ast: FormulaNode | null | undefined = slot.formula;
    if (ast === null || ast === undefined) continue;
    report(ast, true, { creationField: slot.key });
  }
  // Формула названия (#496, Р7) — та же грамматика слота формы создания.
  const titleFormula = doc.creation?.titleFormula;
  if (titleFormula !== null && titleFormula !== undefined) {
    report(titleFormula, true, { creationField: 'title' });
  }
  return problems;
}
