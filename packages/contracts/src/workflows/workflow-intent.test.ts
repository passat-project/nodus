import { describe, expect, it } from 'vitest';

import { smartIntent } from './workflow-intent.js';

describe('smartIntent (#430)', () => {
  it('в «Паузу» — служебная', () => {
    expect(smartIntent({ systemState: 'paused', outcome: null })).toBe('service');
  });

  it('в итог «Отменена» — служебная', () => {
    expect(smartIntent({ systemState: 'closed', outcome: 'cancelled' })).toBe('service');
  });

  it('в «Итог: Выполнена/Отклонена» и рабочие этапы — действие', () => {
    expect(smartIntent({ systemState: 'closed', outcome: 'success' })).toBe('action');
    expect(smartIntent({ systemState: 'closed', outcome: 'rejected' })).toBe('action');
    expect(smartIntent({ systemState: 'active', outcome: null })).toBe('action');
    expect(smartIntent(null)).toBe('action');
  });
});
