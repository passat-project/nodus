import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';
import type {
  CustomFieldDefinition,
  CustomFieldType,
  FormulaNode,
  ProcessCategory,
  WorkflowDocument,
  WorkflowProblem,
} from '@nodus/contracts';

import type { OrgStructureReader } from '../../../../core/ports/org-structure.port.js';
import type { UserProfileReader } from '../../../../core/ports/user-profile.port.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { CustomFieldRegistry } from '../../../custom-fields/ports/custom-field-registry.port.js';
import { checkDocumentForPublish } from './publish-checks.js';
import { checkWorkflowFormulas, hasSlotFormulas } from './workflow-formula-checks.js';

/**
 * Семантическая проверка формул слотов на публикации (#632, Р12; A8-1):
 * общая грамматика ловит форму AST, здесь — типы движком (`inferType` +
 * матрица совместимости с типом поля). Битые формулы дают 422
 * `WORKFLOW_INVALID` с проблемой на слоте; валидные окна (включая related —
 * запись существует) проходят.
 */

const CF_TEXT = '50000000-0000-4000-8000-000000000001';
const CF_NUMBER = '50000000-0000-4000-8000-000000000002';
const KIND = '70000000-0000-4000-8000-000000000001';
const ISO = '2026-01-01T00:00:00.000Z';

function defOf(
  id: string,
  number: number,
  type: CustomFieldType,
  name: string,
): CustomFieldDefinition {
  return {
    id,
    number,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

const DEFINITIONS = [
  defOf(CF_TEXT, 1, 'text', 'Изм.'),
  defOf(CF_NUMBER, 2, 'number', 'Коэффициент'),
];

/** Минимальный валидный документ задачи: 3 статуса, 3 кнопки. */
function baseDocument(): WorkflowDocument {
  const assignee = { conditions: [{ kind: 'role_in' as const, roles: ['assignee' as const] }] };
  return {
    stages: [
      {
        id: 's1',
        code: null,
        name: 'Ожидает',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: 's2',
        code: null,
        name: 'В работе',
        color: 'neutral',
        systemState: 'active',
        outcome: null,
        isInitial: false,
        sortOrder: 1,
      },
      {
        id: 's5',
        code: null,
        name: 'Завершена',
        color: 'neutral',
        systemState: 'closed',
        outcome: 'success',
        isInitial: false,
        sortOrder: 2,
      },
    ],
    transitions: [
      ['t-start', 'Взять в работу', 's1', 's2', 'primary'],
      ['t-accept', 'Утвердить', 's2', 's5', 'primary'],
      ['t-reopen', 'Вернуть', 's5', 's2', 'button'],
    ].map(([id, name, fromStageId, toStageId, display]) => ({
      id: id!,
      code: null,
      name: name!,
      fromStageId: fromStageId!,
      toStageId: toStageId!,
      display: display as 'primary',
      intent: 'action' as const,
      sortOrder: 0,
      rules: { ...assignee, validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    })),
  };
}

const textFormula = (number = 1): FormulaNode => ({
  kind: 'op',
  op: 'concat',
  args: [
    { kind: 'field', source: { kind: 'self' }, number },
    { kind: 'literal', value: '-' },
  ],
});
const numberFormula = (): FormulaNode => ({ kind: 'literal', value: 42 });
const relatedFormula = (): FormulaNode => ({
  kind: 'aggregate',
  from: { kind: 'related', selector: { kind: 'subtasks' } },
  fn: 'count',
});
const foreignSystem = (): FormulaNode => ({
  kind: 'system',
  source: { kind: 'self' },
  entity: 'letter',
  key: 'subject',
});
const deepFormula = (): FormulaNode => {
  let ast: FormulaNode = { kind: 'literal', value: 1 };
  for (let i = 0; i < 14; i += 1) {
    ast = { kind: 'op', op: 'add', args: [ast, { kind: 'literal', value: 1 }] };
  }
  return ast;
};

function withWindowFormula(ast: FormulaNode, field = 'description'): WorkflowDocument {
  const doc = baseDocument();
  doc.transitions[1]!.form = {
    enabled: true,
    sections: [{ kind: 'fields', fields: [field as 'description'], formulas: { [field]: ast } }],
  };
  return doc;
}

function withCreationFormula(key: string, ast: FormulaNode): WorkflowDocument {
  const doc = baseDocument();
  doc.creation = {
    fields: [
      { key: key as 'description', label: null, required: false, preset: null, formula: ast },
    ],
    chips: [],
  };
  return doc;
}

const problemsOf = (doc: WorkflowDocument, category: ProcessCategory = 'task') =>
  checkWorkflowFormulas(doc, { category, definitions: DEFINITIONS });

describe('checkWorkflowFormulas: типы формул слотов (#632, Р12)', () => {
  it('валидные формулы окна и формы создания — без проблем', () => {
    expect(problemsOf(withWindowFormula(textFormula()))).toEqual([]);
    expect(problemsOf(withCreationFormula(`cf.${CF_TEXT}`, textFormula()))).toEqual([]);
    // Текст принимает любой тип: число в «Описание» — валидно.
    expect(
      problemsOf(withWindowFormula({ kind: 'field', source: { kind: 'self' }, number: 2 })),
    ).toEqual([]);
  });

  it('формула атрибута-числа в поле «Срок» (datetime) — ошибка с подписью слота', () => {
    const [problem] = problemsOf(withWindowFormula(numberFormula(), 'deadline'));
    expect(problem).toMatchObject({
      code: 'formula_invalid',
      severity: 'error',
      transitionId: 't-accept',
    });
    expect(problem?.detail).toContain('Срок');
    expect(problem?.detail).toContain('Дата и время');
  });

  it('related в окне разрешён: запись существует (typeDefault=false)', () => {
    expect(problemsOf(withWindowFormula(relatedFormula(), 'plannedMinutes'))).toEqual([]);
  });

  it('формула формы создания: результат не под тип атрибута — ошибка слота', () => {
    const [problem] = problemsOf(withCreationFormula(`cf.${CF_NUMBER}`, textFormula()));
    expect(problem).toMatchObject({
      code: 'formula_invalid',
      creationField: `cf.${CF_NUMBER}`,
    });
    expect(problem?.detail).toContain('Коэффициент');
  });

  it('удалённый атрибут: без выводимого типа — fail-open, в склейке — отказ', () => {
    const deleted: FormulaNode = { kind: 'field', source: { kind: 'self' }, number: 999 };
    expect(problemsOf(withCreationFormula(`cf.${CF_NUMBER}`, deleted))).toEqual([]);
    // Склейка всегда даёт строку, а слот — число: значение в окно не попадёт.
    expect(problemsOf(withCreationFormula(`cf.${CF_NUMBER}`, textFormula(999)))).toHaveLength(1);
  });

  it('структурный отказ не дублируется: его показывает общая грамматика', () => {
    // related в формуле создания — нарушение typeDefault, а не типа значения.
    expect(problemsOf(withCreationFormula(`cf.${CF_NUMBER}`, relatedFormula()))).toEqual([]);
  });

  it('маршрут письма: источники письма проходят, задачные — отказ матрицы', () => {
    const regNumber: FormulaNode = {
      kind: 'system',
      source: { kind: 'self' },
      entity: 'letter',
      key: 'regNumber',
    };
    expect(problemsOf(withCreationFormula(`cf.${CF_TEXT}`, regNumber), 'letter')).toEqual([]);
    const parentTask: FormulaNode = { kind: 'field', source: { kind: 'parent_task' }, number: 1 };
    expect(problemsOf(withCreationFormula(`cf.${CF_TEXT}`, parentTask), 'letter')).toEqual([]);
  });
});

describe('hasSlotFormulas', () => {
  it('без формул — false, с формулой окна или слота создания — true', () => {
    expect(hasSlotFormulas(baseDocument())).toBe(false);
    expect(hasSlotFormulas(withWindowFormula(textFormula()))).toBe(true);
    expect(hasSlotFormulas(withCreationFormula(`cf.${CF_TEXT}`, textFormula()))).toBe(true);
  });
});

/** Зависимости проверки публикации: реестр атрибутов и порты фактов. */
function depsOf(definitions: readonly CustomFieldDefinition[] = DEFINITIONS) {
  const definitionsMock = vi.fn(async () => [...definitions]);
  return {
    calls: { definitions: definitionsMock },
    deps: {
      registry: { definitions: definitionsMock } as unknown as CustomFieldRegistry,
      profiles: { filterActiveUserIds: vi.fn(async () => []) } as unknown as UserProfileReader,
      org: { positionFacts: vi.fn(async () => new Map()) } as unknown as OrgStructureReader,
    },
  };
}

const TX = {} as TransactionClient;

async function publishProblems(document: WorkflowDocument): Promise<WorkflowProblem[] | null> {
  try {
    await checkDocumentForPublish(depsOf().deps, { document, category: 'task', tx: TX });
    return null;
  } catch (error) {
    expect((error as { code: string }).code).toBe(ErrorCode.WORKFLOW_INVALID);
    return (error as { details: { problems: WorkflowProblem[] } }).details.problems;
  }
}

const hasFormulaProblem = (
  problems: WorkflowProblem[] | null,
  refs: Record<string, unknown> = {},
): boolean =>
  (problems ?? []).some(
    (problem) =>
      problem.code === 'formula_invalid' &&
      Object.entries(refs).every(
        ([key, value]) => (problem as Record<string, unknown>)[key] === value,
      ),
  );

describe('checkDocumentForPublish: формулы слотов (#632, A8-1)', () => {
  it('валидное окно с формулой публикуется', async () => {
    await expect(publishProblems(withWindowFormula(textFormula()))).resolves.toBeNull();
  });

  it('формула демо-маршрута (шифр: проект + папка + литералы) публикуется', async () => {
    const demo: FormulaNode = {
      kind: 'op',
      op: 'concat',
      args: [
        { kind: 'field', source: { kind: 'project' }, number: 1 },
        { kind: 'literal', value: '-' },
        { kind: 'field', source: { kind: 'folder_nearest', kindId: KIND }, number: 2 },
        { kind: 'literal', value: '-' },
        { kind: 'field', source: { kind: 'self' }, number: 1 },
      ],
    };
    await expect(publishProblems(withWindowFormula(demo, `cf.${CF_TEXT}`))).resolves.toBeNull();
  });

  it('битые формулы окна — 422 с проблемой на кнопке окна', async () => {
    const oneArg: FormulaNode = { kind: 'op', op: 'add', args: [{ kind: 'literal', value: 1 }] };
    for (const broken of [oneArg, deepFormula(), foreignSystem()]) {
      const problems = await publishProblems(withWindowFormula(broken));
      expect(hasFormulaProblem(problems, { transitionId: 't-accept' })).toBe(true);
    }
  });

  it('результат не под тип слота — 422 с подписью поля', async () => {
    const problems = await publishProblems(withWindowFormula(numberFormula(), 'deadline'));
    const problem = problems?.find((entry) => entry.code === 'formula_invalid');
    expect(problem).toMatchObject({ transitionId: 't-accept' });
    expect(problem?.detail).toContain('Срок');
  });

  it('битая формула формы создания — 422 на слоте', async () => {
    const problems = await publishProblems(withCreationFormula(`cf.${CF_NUMBER}`, textFormula()));
    expect(hasFormulaProblem(problems, { creationField: `cf.${CF_NUMBER}` })).toBe(true);
  });

  it('без формул реестр не читается лишний раз', async () => {
    const plain = depsOf();
    await checkDocumentForPublish(plain.deps, {
      document: baseDocument(),
      category: 'task',
      tx: TX,
    });
    const withFormulas = depsOf();
    await checkDocumentForPublish(withFormulas.deps, {
      document: withWindowFormula(textFormula()),
      category: 'task',
      tx: TX,
    });
    expect(withFormulas.calls.definitions.mock.calls.length).toBe(
      plain.calls.definitions.mock.calls.length + 1,
    );
  });
});
