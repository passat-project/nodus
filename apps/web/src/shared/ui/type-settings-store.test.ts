import { beforeEach, describe, expect, it } from 'vitest';

import { useTypeSettingsStore } from './type-settings-store.js';

/** Состояние стора без функций (функции сравниваем по поведению). */
function state() {
  const { target } = useTypeSettingsStore.getState();
  return { target };
}

beforeEach(() => {
  useTypeSettingsStore.setState({ target: null });
});

describe('стор окна настроек типа (#857, ревизия UI v3)', () => {
  it('по умолчанию закрыт', () => {
    expect(state()).toEqual({ target: null });
  });

  it('openSettings запоминает { вид, id }: окно одно — повторный вызов заменяет цель', () => {
    const store = useTypeSettingsStore.getState();
    store.openSettings({ kind: 'process-type', id: 't1' });
    expect(state().target).toEqual({ kind: 'process-type', id: 't1' });
    store.openSettings({ kind: 'node-kind', id: 'k1' });
    expect(state().target).toEqual({ kind: 'node-kind', id: 'k1' });
    store.openSettings({ kind: 'project-type', id: 'p1' });
    expect(state().target).toEqual({ kind: 'project-type', id: 'p1' });
  });

  it('closeSettings закрывает окно', () => {
    const store = useTypeSettingsStore.getState();
    store.openSettings({ kind: 'project-type', id: 'p1' });
    store.closeSettings();
    expect(state()).toEqual({ target: null });
  });

  it('в состоянии стора нет ничего, кроме цели окна: формы создания настраиваются вкладкой рамы (#857)', () => {
    // Рама не переезжает (раньше её выбор менял счётчик settingsRequest), а
    // конструктор окна создания больше не открывается окном из настроек.
    expect(Object.keys(useTypeSettingsStore.getState()).sort()).toEqual([
      'closeSettings',
      'openSettings',
      'target',
    ]);
  });
});
