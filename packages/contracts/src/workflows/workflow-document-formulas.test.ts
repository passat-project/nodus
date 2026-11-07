import { describe, expect, it } from 'vitest';

import type { FormulaNode } from '../custom-fields/formula.js';
import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
  WorkflowProblem,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument } from './workflow-document-check.js';
import type { WorkflowActorRole, WorkflowTransitionRules } from './workflow.schemas.js';

/**
 * Формулы слотов на публикации (#632, Р12; A8-1): `section.formulas` окна и
 * `slot.formula` формы создания проходят общую грамматику языка — до этой
 * проверки единственным фильтром была zod-схема AST (структура без глубины,
 * арности и матрицы источников), и обход клиента публиковал формулу, которая
 * в рантайме молча давала пустой слот.
 */

const mkStage = (
  id: string,
  name: string,
  systemState: WorkflowDraftStage['systemState'],
  extra: Partial<WorkflowDraftStage> = {},
): WorkflowDraftStage => ({
  id,
  code: null,
  name,
  color: 'neutral',
  systemState,
  outcome: systemState === 'closed' ? 'success' : null,
  isInitial: false,
  sortOrder: 0,
  ...extra,
});

const roles = (...list: WorkflowActorRole[]): WorkflowTransitionRules => ({
  conditions: [{ kind: 'role_in', roles: [...list] }],
  validators: [],
  postFunctions: [],
});

const mkTransition = (
  id: string,
  name: string,
  from: string | null,
  to: string,
  extra: Partial<WorkflowDraftTransition> = {},
): WorkflowDraftTransition => ({
  id,
  code: null,
  name,
  fromStageId: from,
  toStageId: to,
  display: 'button',
  intent: 'action',
  sortOrder: 0,
  rules: roles('assignee'),
  form: { enabled: false, sections: [] },
  ...extra,
});

function baseDocument(): WorkflowDraftDocument {
  return {
    stages: [
      mkStage('s1', 'Ожидает', 'backlog', { isInitial: true }),
      mkStage('s2', 'В работе', 'active'),
      mkStage('s5', 'Завершена', 'closed'),
    ],
    transitions: [
      mkTransition('t-start', 'Взять в работу', 's1', 's2', { display: 'primary' }),
      mkTransition('t-accept', 'Утвердить', 's2', 's5', { display: 'primary' }),
      mkTransition('t-reopen', 'Вернуть', 's5', 's2', { rules: roles('creator') }),
    ],
  };
}

const CF = '50000000-0000-4000-8000-000000000001';

/** Формула «своё поле + литерал» — валидная для любого носителя. */
const fieldFormula = (): FormulaNode => ({
  kind: 'op',
  op: 'concat',
  args: [
    { kind: 'field', source: { kind: 'self' }, number: 1 },
    { kind: 'literal', value: '-' },
  ],
});

/** Документ с окном на кнопке «Утвердить» и формулой-подстановкой поля. */
function withWindowFormula(ast: FormulaNode): WorkflowDraftDocument {
  const doc = baseDocument();
  doc.transitions[1]!.form = {
    enabled: true,
    sections: [{ kind: 'fields', fields: ['description'], formulas: { description: ast } }],
  };
  return doc;
}

const formulaProblems = (doc: WorkflowDraftDocument, category?: 'task' | 'letter') =>
  checkWorkflowDocument(doc, category ? { category } : {}).filter(
    (problem) => problem.code === 'formula_invalid',
  );

describe('checkWorkflowDocument: формулы слотов окна (#632, Р12)', () => {
  it('валидная формула окна не даёт проблем', () => {
    expect(formulaProblems(withWindowFormula(fieldFormula()), 'task')).toEqual([]);
  });

  it('без категории проверка формул пропускается (старые вызовы валидны)', () => {
    const broken: FormulaNode = { kind: 'op', op: 'add', args: [{ kind: 'literal', value: 1 }] };
    expect(formulaProblems(withWindowFormula(broken))).toEqual([]);
  });

  it('related в окне разрешён: запись существует (typeDefault=false)', () => {
    const related: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    };
    expect(formulaProblems(withWindowFormula(related), 'task')).toEqual([]);
  });

  it('оператор с одним аргументом — ошибка на кнопке окна', () => {
    const broken: FormulaNode = { kind: 'op', op: 'add', args: [{ kind: 'literal', value: 1 }] };
    const [problem] = formulaProblems(withWindowFormula(broken), 'task');
    expect(problem).toMatchObject({
      code: 'formula_invalid',
      severity: 'error',
      transitionId: 't-accept',
    });
    expect(problem?.detail).toBeTruthy();
  });

  it('глубина больше лимита — ошибка публикации', () => {
    let ast: FormulaNode = { kind: 'literal', value: 1 };
    for (let i = 0; i < 14; i += 1) {
      ast = { kind: 'op', op: 'add', args: [ast, { kind: 'literal', value: 1 }] };
    }
    expect(formulaProblems(withWindowFormula(ast), 'task')).toHaveLength(1);
  });

  it('источник чужого носителя — ошибка (parent_task у письма)', () => {
    const ast: FormulaNode = {
      kind: 'field',
      source: { kind: 'parent_task' },
      number: 1,
    };
    expect(formulaProblems(withWindowFormula(ast), 'letter')).toHaveLength(1);
  });

  it('системное поле чужой сущности — ошибка (письмо в маршруте задачи)', () => {
    const foreign: FormulaNode = {
      kind: 'system',
      source: { kind: 'self' },
      entity: 'letter',
      key: 'subject',
    };
    const [problem] = formulaProblems(withWindowFormula(foreign), 'task');
    expect(problem).toMatchObject({ code: 'formula_invalid', transitionId: 't-accept' });
  });

  it('выключенное окно формулы не проверяет', () => {
    const doc = withWindowFormula({ kind: 'op', op: 'add', args: [{ kind: 'literal', value: 1 }] });
    doc.transitions[1]!.form = { ...doc.transitions[1]!.form!, enabled: false };
    expect(formulaProblems(doc, 'task')).toEqual([]);
  });
});

describe('checkWorkflowDocument: формулы формы создания (#632, Р12)', () => {
  const withCreation = (ast: FormulaNode): WorkflowDraftDocument => {
    const doc = baseDocument();
    doc.creation = {
      fields: [{ key: `cf.${CF}`, label: null, required: false, preset: null, formula: ast }],
      chips: [],
    };
    return doc;
  };
  const facts = { active: new Set([CF]), inType: new Set([CF]) };

  it('валидная формула создания не даёт проблем', () => {
    const problems = checkWorkflowDocument(withCreation(fieldFormula()), {
      category: 'task',
      customFields: facts,
    }).filter((problem) => problem.code === 'formula_invalid');
    expect(problems).toEqual([]);
  });

  it('related в форме создания запрещён: записи ещё нет (typeDefault=true)', () => {
    const related: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    };
    const problems: WorkflowProblem[] = checkWorkflowDocument(withCreation(related), {
      category: 'task',
      customFields: facts,
    }).filter((problem) => problem.code === 'formula_invalid');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: 'formula_invalid',
      severity: 'error',
      creationField: `cf.${CF}`,
    });
  });

  it('цепочка папок в форме создания запрещена (typeDefault=true)', () => {
    const chain: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'folder_chain', kindId: CF },
      fn: 'sum',
      field: 1,
    };
    expect(
      checkWorkflowDocument(withCreation(chain), { category: 'task', customFields: facts }).filter(
        (problem) => problem.code === 'formula_invalid',
      ),
    ).toHaveLength(1);
  });
});
