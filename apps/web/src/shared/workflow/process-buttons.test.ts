import { describe, expect, it } from 'vitest';
import type { WorkflowTransition, WorkflowDraftTransition } from '@nodus/contracts';

import { groupByDisplay, previewForRole, PREVIEW_ROLES } from './process-buttons.js';

const t = (id: string, display: WorkflowTransition['display']): WorkflowTransition => ({
  id,
  name: id,
  toStageId: '00000000-0000-4000-8000-000000000001',
  toStageName: 'В работе',
  toStageState: 'active',
  toStageOutcome: null,
  toStageColor: 'success',
  toStageOrder: 1,
  display,
  intent: 'action',
  blockedBy: [],
  canOverride: false,
  form: null,
  validators: [],
});

const doc = (
  id: string,
  display: WorkflowDraftTransition['display'],
  roles: ('creator' | 'assignee' | 'coexecutor' | 'observer')[],
): WorkflowDraftTransition => ({
  id,
  code: null,
  name: id,
  fromStageId: '00000000-0000-4000-8000-000000000001',
  toStageId: '00000000-0000-4000-8000-000000000002',
  display,
  intent: 'action',
  sortOrder: 0,
  rules: {
    conditions: roles.length > 0 ? [{ kind: 'role_in', roles }] : [],
    validators: [],
    postFunctions: [],
  },
  form: { enabled: false, sections: [] },
});

describe('process-buttons: панель процесса (#378)', () => {
  it('главная одна слева, видимые по порядку, «Ещё» — меню', () => {
    const groups = groupByDisplay([
      t('a', 'button'),
      t('b', 'primary'),
      t('c', 'menu'),
      t('d', 'button'),
      t('e', 'menu'),
    ]);
    expect(groups.primary?.id).toBe('b');
    expect(groups.visible.map((x) => x.id)).toEqual(['a', 'd']);
    expect(groups.menu.map((x) => x.id)).toEqual(['c', 'e']);
  });

  it('превью по ролям: условия ИЛИ внутри кнопки', () => {
    const transitions = [
      doc('start', 'primary', ['assignee', 'coexecutor']),
      doc('accept', 'primary', ['creator']),
      doc('watch', 'button', ['observer']),
    ];
    const assignee = previewForRole(transitions, ['assignee']);
    expect(assignee.map((x) => x.id)).toEqual(['start']);
    const creatorAssignee = previewForRole(transitions, ['creator', 'assignee']);
    expect(creatorAssignee.map((x) => x.id)).toEqual(['start', 'accept']);
    const observer = previewForRole(transitions, ['observer']);
    expect(observer.map((x) => x.id)).toEqual(['watch']);
  });

  it('пустые условия — постановщик или исполнитель (как у движка)', () => {
    const transitions = [doc('free', 'button', [])];
    expect(previewForRole(transitions, ['creator']).map((x) => x.id)).toEqual(['free']);
    expect(previewForRole(transitions, ['assignee']).map((x) => x.id)).toEqual(['free']);
    expect(previewForRole(transitions, ['observer'])).toEqual([]);
  });

  it('набор ролей предпросмотра фиксирован', () => {
    expect(PREVIEW_ROLES.map((r) => r.id)).toEqual([
      'creator',
      'assignee',
      'coexecutor',
      'observer',
      'creator_assignee',
    ]);
  });
});
