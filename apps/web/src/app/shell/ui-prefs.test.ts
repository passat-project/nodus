// @vitest-environment jsdom
import { resolveHidden, resolveOrder } from './ui-prefs.js';

import { describe, expect, it } from 'vitest';

import { useUiPrefsStore } from '../../shared/preferences/ui-prefs-store.js';

const SYSTEM = ['home', 'tasks', 'letters', 'projects', 'chat', 'employees'];

describe('AUD-032: общий скоуп company не применяется', () => {
  it('ранее сохранённое «общее» значение не меняет навигацию', () => {
    useUiPrefsStore.setState({ personal: {}, company: { navOrder: ['chat', 'home'] } });
    const { personal } = useUiPrefsStore.getState();
    // Тот же вызов, что в node-rail/router: общий слой не участвует.
    expect(resolveOrder(SYSTEM, personal.navOrder)).toEqual(SYSTEM);
    expect(resolveHidden(SYSTEM, personal.navHidden)).toEqual([]);
  });
});

describe('resolveOrder', () => {
  it('без сохранённого личного — системный порядок', () => {
    expect(resolveOrder(SYSTEM)).toEqual(SYSTEM);
    expect(resolveOrder(SYSTEM, [])).toEqual(SYSTEM);
  });

  it('личный порядок применяется', () => {
    const personal = ['tasks', 'home', 'letters', 'projects', 'chat', 'employees'];
    expect(resolveOrder(SYSTEM, personal)).toEqual(personal);
  });

  it('неизвестные id отбрасываются, новые из реестра — в конец системным порядком', () => {
    const stored = ['chat', 'legacy-gone', 'home'];
    expect(resolveOrder(SYSTEM, stored)).toEqual([
      'chat',
      'home',
      'tasks',
      'letters',
      'projects',
      'employees',
    ]);
  });
});

describe('resolveHidden', () => {
  it('только личные скрытые, неизвестные отбрасываются', () => {
    expect(resolveHidden(SYSTEM, ['chat', 'gone'])).toEqual(['chat']);
    expect(resolveHidden(SYSTEM)).toEqual([]);
  });
});
