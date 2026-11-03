import { describe, expect, it } from 'vitest';
import type { WorkflowTransition } from '@nodus/contracts';

import { routeTransition, windowCanUnblock } from './window-can-unblock.js';

const access = { canEdit: true, canLogTime: true, canCheck: true };

const transition = (patch: Partial<WorkflowTransition>): WorkflowTransition => ({
  id: 't',
  name: 'Завершить',
  toStageId: 's2',
  toStageName: 'Завершена',
  toStageState: 'closed',
  toStageOutcome: 'success',
  toStageColor: 'info',
  toStageOrder: 1,
  display: 'primary',
  intent: 'action',
  blockedBy: [],
  canOverride: false,
  form: null,
  validators: [],
  ...patch,
});

describe('маршрутизация кнопки (#380)', () => {
  it('кнопка с окном — окно', () => {
    expect(
      routeTransition(
        transition({
          form: { enabled: true, sections: [] },
          blockedBy: [{ kind: 'no_open_subtasks', count: 1 }],
        }),
        access,
      ),
    ).toBe('window');
  });

  it('свободная кнопка — сразу', () => {
    expect(routeTransition(transition({}), access)).toBe('execute');
  });

  it('заблокированная исправимым гейтом — окно', () => {
    const t = transition({ blockedBy: [{ kind: 'fields_required', fields: ['deadline'] }] });
    expect(windowCanUnblock(t, access)).toBe(true);
    expect(routeTransition(t, access)).toBe('window');
  });

  it('подзадачи и чек-лист окно не правит — прежний диалог', () => {
    const t = transition({ blockedBy: [{ kind: 'no_open_subtasks', count: 2 }] });
    expect(windowCanUnblock(t, access)).toBe(false);
    expect(routeTransition(t, access)).toBe('dialog');
  });

  it('нет прав на раздел — окно не разблокирует', () => {
    const t = transition({ blockedBy: [{ kind: 'result_present' }] });
    expect(windowCanUnblock(t, { ...access, canCheck: false })).toBe(false);
    expect(routeTransition(t, { ...access, canCheck: false })).toBe('dialog');
  });
});
