import { describe, expect, it } from 'vitest';

import {
  isCompletedState,
  isFinalState,
  isOpenState,
  isReviewState,
  statesOfPhase,
  taskStatePhase,
} from './task-state-phase.js';

describe('фазы системного состояния (ADR-0020, дополнение 2)', () => {
  it('backlog/active/paused — open, done — review (не завершение), closed — final', () => {
    expect(['backlog', 'active', 'paused', 'done', 'closed'].map(taskStatePhase)).toEqual([
      'open',
      'open',
      'open',
      'review',
      'final',
    ]);
  });

  it('предикаты фаз взаимоисключающие', () => {
    for (const state of ['backlog', 'active', 'paused', 'done', 'closed']) {
      const hits = [isOpenState(state), isReviewState(state), isFinalState(state)];
      expect(hits.filter(Boolean)).toHaveLength(1);
    }
    expect(isReviewState('done')).toBe(true);
    expect(isFinalState('done')).toBe(false);
    expect(isOpenState('done')).toBe(false);
  });

  it('значение вне набора — ни одной фазы (в т.ч. имена из прототипа объекта)', () => {
    for (const state of ['', 'review', 'toString', 'constructor']) {
      expect(taskStatePhase(state)).toBeUndefined();
      expect(isOpenState(state) || isReviewState(state) || isFinalState(state)).toBe(false);
    }
  });

  it('выполнена — только итог без исхода «отменена»', () => {
    expect(isCompletedState('closed', 'success')).toBe(true);
    expect(isCompletedState('closed', null)).toBe(true);
    expect(isCompletedState('closed', 'cancelled')).toBe(false);
    expect(isCompletedState('closed', 'rejected')).toBe(false);
    expect(isCompletedState('done', 'success')).toBe(false);
    expect(isCompletedState('active', undefined)).toBe(false);
  });

  it('состояния фазы — в порядке оси, каждый раз новый массив', () => {
    expect(statesOfPhase('open')).toEqual(['backlog', 'active', 'paused']);
    expect(statesOfPhase('review')).toEqual(['done']);
    expect(statesOfPhase('final')).toEqual(['closed']);
    const a = statesOfPhase('open');
    a.push('closed');
    expect(statesOfPhase('open')).toHaveLength(3);
  });
});
