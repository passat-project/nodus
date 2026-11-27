// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWorkflowDocument, ui } from '@nodus/contracts';

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  // Стадии маршрутов чужих типов тесту не нужны: запросы не уходят.
  useQueries: () => [],
}));
vi.mock('../../../../../shared/api/users-list.js', () => ({
  useActiveUsersList: () => ({ data: { items: [{ id: 'u1', displayName: 'Иванов' }] } }),
}));
vi.mock('../../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: () => ({
    data: [{ id: 'nk1', name: 'Комплект', archivedAt: null }],
  }),
}));
vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [{ id: 'f1', name: 'Комплект по ссылке', type: 'node', bindings: null }],
  }),
}));
vi.mock('../../../../../shared/custom-fields/value-editor.js', () => ({
  CustomFieldEditor: () => <input aria-label="значение" />,
}));
vi.mock('../../../../../shared/ui/people-picker.js', () => ({
  PeoplePicker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../api/automation-api.js', () => ({
  useProcessTypes: () => ({
    data: [
      { id: 'ty1', name: 'Стандартный', workflowId: 'wf1', category: 'task', archivedAt: null },
      {
        id: 'ty2',
        name: 'Исходящее письмо',
        workflowId: 'wf2',
        category: 'letter',
        archivedAt: null,
      },
    ],
  }),
}));

import { ConditionRuleCards } from './condition-rule-cards.js';
import { emptyConditionQuery, newRecordsValidator } from '../../../model/condition-rules.js';
import type { Rules } from '../../../model/transition-rules.js';

afterEach(cleanup);

const t = ui.automation.condition;

/** Правила с одним условием-выборкой: карточка редактора уже открыта. */
const rulesWithQuery = (extra: Partial<Rules> = {}): Rules => ({
  conditions: [{ kind: 'records', query: emptyConditionQuery() }],
  validators: [],
  postFunctions: [],
  ...extra,
});

describe('конструктор условий и проверок (#635)', () => {
  it('у письма задачные субъекты не предлагаются', () => {
    render(
      <ConditionRuleCards
        rules={rulesWithQuery()}
        category="letter"
        scope="letter"
        readOnly={false}
        patch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: t.subject }));
    const options = screen.getAllByRole('option');
    const names = options.map((option) => option.textContent);
    expect(names).toContain(t.subjects.self);
    expect(names).toContain(t.subjects.project_tasks);
    expect(names).not.toContain(t.subjects.subtasks);
    expect(names).not.toContain(t.subjects.parent_task);
    expect(names).not.toContain(t.subjects.folder_tasks);
    expect(names).not.toContain(t.subjects.folder_type_tasks);
  });

  it('статус записи выбирается только после типа', () => {
    render(
      <ConditionRuleCards
        rules={rulesWithQuery()}
        category="task"
        scope="task"
        readOnly={false}
        patch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: t.addPredicate }));
    const stageOption = screen
      .getAllByRole('option')
      .find((option) => option.textContent === t.predicates.stage_is);
    expect(stageOption).toBeTruthy();
    // Без type_is в той же выборке статус недоступен (грамматика публикации).
    expect(stageOption!.closest('[data-disabled]')).not.toBeNull();
  });

  it('подпись проверки обязательна: карточка подсвечивает, публикация отказывает', () => {
    const check = newRecordsValidator();
    check.title = '';
    render(
      <ConditionRuleCards
        rules={{
          conditions: [],
          validators: [check, { kind: 'no_open_subtasks' }],
          postFunctions: [],
        }}
        category="task"
        scope="task"
        readOnly={false}
        patch={() => undefined}
      />,
    );
    expect(screen.getByPlaceholderText(t.checkTitlePlaceholder).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByText(t.checkTitleHint)).toBeTruthy();

    const doc = {
      stages: [
        {
          id: 's1',
          code: null,
          name: 'В работе',
          color: 'neutral',
          systemState: 'active',
          outcome: null,
          resultIssued: false,
          isInitial: true,
          sortOrder: 0,
        },
      ],
      transitions: [
        {
          id: 't1',
          code: null,
          name: 'Завершить',
          fromStageId: 's1',
          toStageId: 's1',
          display: 'primary',
          intent: 'action',
          sortOrder: 0,
          rules: {
            conditions: [],
            validators: [check, { kind: 'no_open_subtasks' }],
            postFunctions: [],
          },
          form: { enabled: false, sections: [] },
        },
      ],
    } as Parameters<typeof checkWorkflowDocument>[0];
    const problems = checkWorkflowDocument(doc, { category: 'task' });
    expect(problems.some((problem) => problem.code === 'condition_title_empty')).toBe(true);
  });

  it('обход forbidden не предлагает сотрудников и роль', () => {
    const check = { ...newRecordsValidator(), title: 'Проверка' };
    check.override = { mode: 'forbidden', extraUserIds: [] };
    render(
      <ConditionRuleCards
        rules={{ conditions: [], validators: [check], postFunctions: [] }}
        category="task"
        scope="task"
        readOnly={false}
        patch={() => undefined}
      />,
    );
    // Запрет включён: подсказка видна, пикеры допусков скрыты.
    expect(screen.getByText(t.overrideForbiddenHint)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: t.overrideRole })).toBeNull();
    const usersButton = screen
      .queryAllByRole('button')
      .find((button) => button.textContent === t.overrideUsersEmpty);
    expect(usersButton).toBeUndefined();
  });

  it('добавление проверки через селектор пишет records-валидатор в правила', () => {
    const patch = vi.fn();
    render(
      <ConditionRuleCards
        rules={{ conditions: [], validators: [], postFunctions: [] }}
        category="task"
        scope="task"
        readOnly={false}
        patch={patch}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: t.addCheck }));
    fireEvent.click(screen.getByRole('option', { name: t.addKinds.records }));
    expect(patch).toHaveBeenCalledTimes(1);
    const rules = patch.mock.calls[0]![0] as { validators: { kind: string; title: string }[] };
    expect(rules.validators[0]!.kind).toBe('records');
    expect(rules.validators[0]!.title).toBe('');
  });

  it('сводка карточек читается по группам «Условия» и «Проверки»', () => {
    render(
      <ConditionRuleCards
        rules={{ conditions: [], validators: [], postFunctions: [] }}
        category="task"
        scope="task"
        readOnly={false}
        patch={() => undefined}
      />,
    );
    expect(screen.getByText(t.groupConditions, { exact: true })).toBeTruthy();
    expect(screen.getByText(t.groupChecks, { exact: true })).toBeTruthy();
    expect(screen.getByText(t.groupConditionsHint)).toBeTruthy();
    expect(screen.getByText(t.groupChecksHint)).toBeTruthy();
  });
});

describe('конструктор: пикер субъектов с параметрами (#635)', () => {
  it('папки проекта предлагают тип папки и «любой тип»', () => {
    let rules = rulesWithQuery();
    const view = render(
      <ConditionRuleCards
        rules={rules}
        category="task"
        scope="task"
        readOnly={false}
        patch={(next) => {
          rules = next;
          view.rerender(
            <ConditionRuleCards
              rules={rules}
              category="task"
              scope="task"
              readOnly={false}
              patch={(again) => {
                rules = again;
              }}
            />,
          );
        }}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: t.subject }));
    fireEvent.click(screen.getByRole('option', { name: t.subjects.project_folders }));
    const folderSelect = screen
      .getAllByRole('combobox')
      .find((combobox) => combobox.getAttribute('aria-label') === t.subjectFolderType);
    expect(folderSelect).toBeTruthy();
    fireEvent.click(folderSelect!);
    const option = screen.getAllByRole('option').find((o) => o.textContent === 'Комплект');
    expect(option).toBeTruthy();
    expect(
      screen.getAllByRole('option').some((o) => o.textContent === t.subjectFolderTypeAny),
    ).toBe(true);
  });
});
