// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { EffectiveSection } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { TimeSection } from './time-section.js';
import { emptyDraft } from '../use-window-draft.js';
import type { TransitionWindowContext } from '../window-context.js';

const context: TransitionWindowContext = {
  entityId: 't1',
  conversationId: 'c1',
  currentStageName: 'В работе',
  fields: {
    description: '',
    deadline: null,
    assigneeId: 'bob',
    plannedMinutes: null,
    customFields: {},
  },
  spentMinutes: 0,
  lastResult: null,
  access: { canEdit: true, canLogTime: true, canCheck: true },
  submission: null,
  scope: 'entity',
  customFieldDefinitions: [],
  customFieldRefs: [],
};

const section: Extract<EffectiveSection, { kind: 'time' }> = {
  kind: 'time',
  mode: 'always',
  origin: 'form',
};

function renderTime(amount: string, spentMinutes = 0) {
  const base = emptyDraft({ ...context, spentMinutes });
  return render(
    <TimeSection
      section={section}
      draft={{ ...base, time: { amount, comment: '', daysAgo: 0 } }}
      setTime={() => undefined}
      disabled={false}
      spentMinutes={spentMinutes}
    />,
  );
}

describe('раздел «Трудозатраты»: причина у поля (#866, AUD-009)', () => {
  afterEach(cleanup);

  it('нераспознанный ввод показывает причину формата', () => {
    renderTime('abc');
    expect(screen.getByText(ui.tasks.minutesInvalid)).toBeTruthy();
  });

  it('больше 24 часов показывает причину предела', () => {
    renderTime('30ч');
    expect(screen.getByText(ui.tasks.minutesOverLimit)).toBeTruthy();
  });

  it('пустое и валидное значение ошибки не показывают', () => {
    renderTime('');
    expect(screen.queryByText(ui.tasks.minutesInvalid)).toBeNull();
    expect(screen.queryByText(ui.tasks.minutesOverLimit)).toBeNull();
    renderTime('2ч 30м');
    expect(screen.queryByText(ui.tasks.minutesInvalid)).toBeNull();
    expect(screen.queryByText(ui.tasks.minutesOverLimit)).toBeNull();
  });

  it('режим if_empty при уже учтённом времени ошибку не показывает', () => {
    const base = emptyDraft({ ...context, spentMinutes: 30 });
    render(
      <TimeSection
        section={{ ...section, mode: 'if_empty' }}
        draft={{ ...base, time: { amount: '30ч', comment: '', daysAgo: 0 } }}
        setTime={() => undefined}
        disabled={false}
        spentMinutes={30}
      />,
    );
    expect(screen.queryByText(ui.tasks.minutesOverLimit)).toBeNull();
  });
});
