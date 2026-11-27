// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Стенд — первым импортом: моки должны встать до импорта экрана и его зависимостей.
import { harness, resetScreen, searchOf, setup } from './processes-screen.test-harness.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';

const { cardProps, listProps, navigateSpy, storeApi } = harness;

beforeEach(resetScreen);

afterEach(cleanup);

describe('колонка → URL: выбор заменяет поверхность целиком — папка не «заклинивает» колонку', () => {
  /** Адрес после выбора: апдейтер последнего navigate, применённый к прежнему адресу. */
  const searchFrom = (prev: Record<string, unknown>) =>
    navigateSpy.mock.calls.at(-1)![0].search(prev) as Record<string, string | undefined>;
  const choose = (callback: string, id?: string) => {
    act(() => (listProps.value![callback] as (id?: string) => void)(id));
  };
  /** Адрес с выбранным типом папки: остальное (вкладка, стек карточек) должно остаться. */
  const withFolder = { tab: 'processes', ftype: 'k1', cards: 'task:x' };
  /** Новый адрес диспатчеризуется обратно: что выделено в колонке и что стоит в раме. */
  const reopen = (next: Record<string, string | undefined>) => {
    cleanup();
    cardProps.value = null;
    setup(next);
  };

  it('папка → тип задачи: в адресе не остаётся ftype, выделен тип, в раме его маршрут', () => {
    setup(withFolder);
    expect(listProps.value!.selectedKindId).toBe('k1');
    choose('onSelectProcessType', 't1');
    const next = searchFrom(withFolder);
    expect(next).toEqual({ tab: 'processes', cards: 'task:x', type: 't1' });
    reopen(next);
    expect(listProps.value!.selectedProcessTypeId).toBe('t1');
    expect(listProps.value!.selectedKindId).toBeUndefined();
    expect(screen.getByTestId('process-type-card').dataset.type).toBe('Задание смежнику');
  });

  it('папка → письмо: тот же путь — выделен тип письма, в раме его маршрут', () => {
    setup(withFolder);
    choose('onSelectProcessType', 'l1');
    const next = searchFrom(withFolder);
    expect(next).toEqual({ tab: 'processes', cards: 'task:x', type: 'l1' });
    reopen(next);
    expect(listProps.value!.selectedProcessTypeId).toBe('l1');
    expect(screen.getByTestId('process-type-card').dataset.type).toBe('Письмо заказчику');
  });

  it('папка → тип проекта', () => {
    setup(withFolder);
    choose('onSelectProjectType', 'p2');
    const next = searchFrom(withFolder);
    expect(next).toEqual({ tab: 'processes', cards: 'task:x', ptype: 'p2' });
    reopen(next);
    expect(listProps.value!.selectedProjectTypeId).toBe('p2');
    expect(listProps.value!.selectedKindId).toBeUndefined();
    expect(screen.getByTestId('workspace-slot').dataset.typeId).toBe('p2');
  });

  it('папка → «Без проекта»', () => {
    setup(withFolder);
    choose('onSelectNoProject');
    const next = searchFrom(withFolder);
    expect(next).toEqual({ tab: 'processes', cards: 'task:x', noproject: '1' });
    reopen(next);
    expect(listProps.value!.noProjectSelected).toBe(true);
    expect(listProps.value!.selectedKindId).toBeUndefined();
    expect(screen.getByTestId('without-project')).toBeTruthy();
  });

  it('папка → другая папка', () => {
    setup(withFolder);
    choose('onSelectKind', 'k2');
    const next = searchFrom(withFolder);
    expect(next).toEqual({ tab: 'processes', cards: 'task:x', ftype: 'k2' });
    reopen(next);
    expect(listProps.value!.selectedKindId).toBe('k2');
    expect(screen.getByTestId('folder-slot').dataset.kindId).toBe('k2');
  });

  it('с любой поверхности снимаются все ключи прежней — остаётся только выбранный', () => {
    setup({ tab: 'processes', type: 't1', ptype: 'p1', noproject: '1' });
    choose('onSelectProjectType', 'p2');
    expect(searchOf()).toEqual({ tab: 'processes', ptype: 'p2' });
    choose('onSelectNoProject');
    expect(searchOf()).toEqual({ tab: 'processes', noproject: '1' });
    choose('onSelectProcessType', 't1');
    expect(searchOf()).toEqual({ tab: 'processes', type: 't1' });
  });
});

describe('«⋯ → Настройки типа…» строки колонки — общий стор, рама не переезжает (#857)', () => {
  it('строка задачи: окно настроек получает { kind, id }, выделение редактора сбрасывается', () => {
    storeApi.select.mockClear();
    setup({ tab: 'processes', type: 't1' });
    // Настройки — ДРУГОГО типа, нежели выбран в раме: рама остаётся на t1.
    act(() => (listProps.value!.onOpenProcessTypeSettings as (id: string) => void)('t2'));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'process-type', id: 't2' });
    expect(storeApi.select).toHaveBeenCalledWith(null);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('process-type-card').dataset.type).toBe('Задание смежнику');
  });

  it('строка проекта и строки типа папки — тот же стор, без навигации', () => {
    setup({ tab: 'processes', ptype: 'p1' });
    act(() => (listProps.value!.onOpenProjectSettings as (id: string) => void)('p2'));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'project-type', id: 'p2' });
    act(() => (listProps.value!.onOpenKindSettings as (id: string) => void)('k1'));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: 'k1' });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
