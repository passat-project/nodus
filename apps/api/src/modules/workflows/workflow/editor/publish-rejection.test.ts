import { describe, expect, it } from 'vitest';
import { ui, type WorkflowDocument, type WorkflowProblem } from '@nodus/contracts';

import { publishRejectionMessage } from './publish-rejection.js';

/** Сообщение отказа публикации (#633): одна понятная фраза с именем хозяина. */

const S1 = '00000000-0000-4000-8000-000000000001';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const T1 = '00000000-0000-4000-8000-0000000000b1';

const document = (): WorkflowDocument =>
  ({
    stages: [
      { id: S1, code: null, name: 'В работе', isInitial: true },
      { id: 'stage-done', code: null, name: 'Завершена' },
    ],
    transitions: [
      {
        id: T1,
        code: null,
        name: 'Завершить',
        fromStageId: S1,
        toStageId: 'stage-done',
      },
    ],
    actions: [
      {
        id: A1,
        code: null,
        name: 'Запросить уточнение',
        stageId: S1,
        form: { enabled: true, sections: [] },
        steps: [],
      },
    ],
  }) as unknown as WorkflowDocument;

const problem = (partial: Partial<WorkflowProblem>): WorkflowProblem => ({
  code: 'action_window_empty',
  severity: 'error',
  ...partial,
});

describe('publishRejectionMessage (#633)', () => {
  it('называет действие и его дефект по-русски', () => {
    expect(publishRejectionMessage(document(), [problem({ actionId: A1 })])).toBe(
      'В действии «Запросить уточнение» включено окно, но не выбрано ни одного раздела — добавьте поле или выключите окно',
    );
  });

  it('текст дефекта — из i18n контрактов, не дублируется в сервере', () => {
    const message = publishRejectionMessage(document(), [problem({ actionId: A1 })]);
    expect(message).toContain(ui.automation.problems.action_window_empty.toLowerCase());
  });

  it('хозяин кнопки и статуса тоже называется', () => {
    expect(
      publishRejectionMessage(document(), [
        problem({ code: 'no_roles', actionId: undefined, transitionId: T1 }),
      ]),
    ).toBe('В кнопке «Завершить» кнопку никто не видит');
    expect(
      publishRejectionMessage(document(), [
        problem({ code: 'empty_name', actionId: undefined, stageId: S1 }),
      ]),
    ).toBe('В статусе «В работе» пустое название статуса или кнопки');
  });

  it('первым берётся блокирующий дефект, предупреждения не перебивают', () => {
    const message = publishRejectionMessage(document(), [
      problem({ code: 'no_primary', severity: 'warning', stageId: S1 }),
      problem({ actionId: A1 }),
    ]);
    expect(message.startsWith('В действии «Запросить уточнение»')).toBe(true);
  });

  it('без хозяина (общий дефект) — просто текст проблемы; без проблем — запасная фраза', () => {
    expect(publishRejectionMessage(document(), [problem({ code: 'no_initial' })])).toBe(
      ui.automation.problems.no_initial,
    );
    expect(publishRejectionMessage(document(), [])).toBe('Workflow document is invalid');
  });
});
