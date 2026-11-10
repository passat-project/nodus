import { describe, expect, it, vi } from 'vitest';
import type { PressConfig, TransitionForm } from '@nodus/contracts';

import { WorkflowPressReaderProvider } from './workflow-press-reader.provider.js';

const press: PressConfig = {
  sources: [{ kind: 'coexecutors' }],
  quorum: { kind: 'all' },
  order: 'parallel',
  excludeAuthor: true,
};
const form: TransitionForm = {
  enabled: true,
  sections: [{ kind: 'result' }],
};
const transition = {
  id: 'tr1',
  name: 'Завершить',
  fromStageId: 's1',
  toStageId: 's2',
  display: 'primary',
  intent: 'action',
  sortOrder: 0,
  rules: { conditions: [], validators: [], postFunctions: [] },
  form,
  press,
};

function setup() {
  const workflows = {
    load: vi.fn(async () => ({
      transitions: [transition, { ...transition, id: 'tr2', press: null }],
    })),
  };
  return { provider: new WorkflowPressReaderProvider(workflows as never), workflows };
}

describe('WorkflowPressReaderProvider (#434)', () => {
  it('кнопки сбора стадии отдаются с окном и настройкой', async () => {
    const { provider, workflows } = setup();
    await expect(provider.pressTransitionsForStage('wf', 's1')).resolves.toEqual([
      expect.objectContaining({ id: 'tr1', name: 'Завершить', press, form }),
    ]);
    expect(workflows.load).toHaveBeenCalledWith('wf', undefined);
  });

  it('кнопка по id: обычная — null, коллективная — view', async () => {
    const { provider } = setup();
    await expect(provider.pressTransition('wf', 'tr2')).resolves.toBeNull();
    await expect(provider.pressTransition('wf', 'tr1')).resolves.toMatchObject({ id: 'tr1' });
  });

  it('личные разделы и сверка ввода: поля карточки не входят', () => {
    const { provider } = setup();
    const sections = provider.personalSections(form);
    expect(sections.map((section) => section.kind)).toEqual(['result']);
    expect(provider.checkPressInput(form, { result: { text: 'Итог', messageIds: [] } })).toEqual({
      missing: [],
      unexpected: [],
    });
    expect(provider.checkPressInput(form, { comment: 'x' })).toMatchObject({
      unexpected: ['comment'],
    });
  });
});
