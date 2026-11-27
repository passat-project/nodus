// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

// Стенд — первым импортом: моки должны встать до импорта экрана и его зависимостей.
import {
  harness,
  resetScreen,
  screenElement,
  setup,
  workflowLoaded,
} from './processes-screen.test-harness.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useWorkflowDetail } from '../../../../shared/workflow/workflow-api.js';

const {
  cardProps,
  listProps,
  prefetchState,
  routeDocState,
  searchState,
  stackState,
  workflowState,
} = harness;

beforeEach(resetScreen);

afterEach(cleanup);

describe('диспетчер «Процессов» по URL (#857)', () => {
  it('?type= — редактор маршрута выбранного типа', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.type).toBe('Задание смежнику');
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
    expect(screen.queryByTestId('without-project')).toBeNull();
  });

  it('?ptype= — рабочая область типа проекта через слот', () => {
    setup({ tab: 'processes', ptype: 'p2' });
    expect(screen.getByTestId('workspace-slot').dataset.typeId).toBe('p2');
    expect(screen.queryByTestId('process-type-card')).toBeNull();
  });

  it('без параметров — умолчание: первый живой тип проекта', () => {
    setup({ tab: 'processes' });
    expect(screen.getByTestId('workspace-slot').dataset.typeId).toBe('p1');
  });

  it('?ftype= — карточка типа папки в раме (колонка стоит на месте)', () => {
    setup({ tab: 'processes', ftype: 'k1' });
    expect(screen.getByTestId('folder-slot').dataset.kindId).toBe('k1');
    expect(screen.getByTestId('unified-list')).toBeTruthy();
  });

  it('?noproject=1 — страница «Без проекта»', () => {
    setup({ tab: 'processes', noproject: '1' });
    expect(screen.getByTestId('without-project')).toBeTruthy();
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
  });

  it('колонке отдаются выбранные id по поверхности', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('unified-list').dataset.props).toContain('selectedProcessTypeId');
    cleanup();
    setup({ tab: 'processes', ptype: 'p2' });
    expect(screen.getByTestId('unified-list').dataset.props).toContain('selectedProjectTypeId');
  });
});

describe('смена типа без мерцания: рама не пустеет и не показывает чужой граф (#857)', () => {
  const rerenderWith = (view: ReturnType<typeof setup>, search: Record<string, unknown>) => {
    searchState.value = search;
    act(() => view.rerender(screenElement()));
  };

  it('запрос маршрута держит прежние данные, пока грузится следующий', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(vi.mocked(useWorkflowDetail).mock.calls.at(-1)).toEqual([
      'wf-1',
      { keepPrevious: true },
    ]);
  });

  it('маршрут нового типа грузится: рама держит прежнюю пару «тип + маршрут» — без заглушки', () => {
    // На руках ещё прежний маршрут (wf-1), грузится wf-2.
    workflowState.reply = () => ({ data: { id: 'wf-1', document: { stages: [] } } });
    const view = setup({ tab: 'processes', type: 't1' });
    rerenderWith(view, { tab: 'processes', type: 't2' });
    // Ни пустоты с «Создайте первый процесс», ни прежнего графа под новым типом:
    // тип в раме — тот, чей маршрут на руках.
    expect(cardProps.value!.type).toMatchObject({ id: 't1' });
    expect(cardProps.value!.workflow).toMatchObject({ id: 'wf-1' });
    expect(screen.queryByText(ui.automation.createFirstType)).toBeNull();
    expect(document.querySelector('main')?.hasAttribute('aria-busy')).toBe(false);
    // Маршрут пришёл — рама показывает новый тип вместе с его маршрутом.
    workflowState.reply = workflowLoaded;
    rerenderWith(view, { tab: 'processes', type: 't2' });
    expect(cardProps.value!.type).toMatchObject({ id: 't2' });
    expect(cardProps.value!.workflow).toMatchObject({ id: 'wf-2' });
  });

  it('первое открытие типа — маршрута ещё нет: рабочая область ждёт его, без рамы с пустым «Маршрутом»', () => {
    workflowState.reply = () => ({ data: undefined });
    setup({ tab: 'processes', type: 't1' });
    expect(screen.queryByTestId('process-type-card')).toBeNull();
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(ui.automation.createFirstType)).toBeNull();
  });

  it('первое открытие под карточкой стека — рама на месте с пустыми панелями: маршрут ей не нужен', () => {
    workflowState.reply = () => ({ data: undefined });
    stackState.value = [{ kind: 'process-type', id: 't2' }];
    setup({ tab: 'processes', type: 't1' });
    expect(cardProps.value!.type).toMatchObject({ id: 't1' });
    expect(cardProps.value!.workflow).toBeUndefined();
    expect(screen.getByTestId('process-type-card').dataset.suspended).toBe('yes');
  });

  it('маршрут не удалось загрузить — «недоступно», а не пустота', () => {
    workflowState.reply = () => ({ data: undefined, isError: true });
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByText(ui.automation.workflowUnavailable)).toBeTruthy();
    expect(screen.queryByTestId('process-type-card')).toBeNull();
    expect(document.querySelector('main')?.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('после перезагрузки: ни заглушки до списков, ни рамы без маршрута (#857, К4)', () => {
  const main = () => document.querySelector('main');

  it('списки ещё грузятся — пустая занятая область вместо «Создайте первый процесс»', () => {
    vi.mocked(useProcessTypes).mockReturnValueOnce({ data: undefined, isLoading: true } as never);
    setup({ tab: 'processes' });
    expect(main()?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(ui.automation.createFirstType)).toBeNull();
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
  });

  it('адрес папки при незагруженном списке папок — тоже ждём: карточка не сменит раму проекта', () => {
    vi.mocked(useNodeKinds).mockReturnValueOnce({ data: undefined, isLoading: true } as never);
    setup({ tab: 'processes', ftype: 'k1' });
    expect(main()?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
    expect(screen.queryByTestId('folder-slot')).toBeNull();
  });

  it('маршруты живых типов предзагружаются при входе — первый выбор без пустого «Маршрута»', () => {
    setup({ tab: 'processes', ptype: 'p2' });
    expect(prefetchState.ids).toEqual(['t1', 't2', 'l1']);
  });
});

describe('правило одного редактора маршрута (#857, ревизия UI v3)', () => {
  it('в стеке нет карточки типа процесса — редактор рамы работает', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.suspended).toBe('no');
  });

  it('карточка типа процесса в стеке — редактор рамы приостановлен', () => {
    stackState.value = [{ kind: 'project-type', id: 'p1' }];
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.suspended).toBe('no');
    cleanup();
    // Другие виды карточек редактора не содержат — рама не приостанавливается.
    stackState.value = [{ kind: 'process-type', id: 't2' }];
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.suspended).toBe('yes');
  });

  it('метка черновика — у строки типа, чей маршрут в сторе редактора, даже если выбран другой', () => {
    // Рама показывает t1, а черновик (в стеке поверх) — у t2.
    routeDocState.value = { selection: null, dirty: true, workflowId: 'wf-2' };
    stackState.value = [{ kind: 'process-type', id: 't2' }];
    setup({ tab: 'processes', type: 't1' });
    const dirtyIds = listProps.value!.dirtyIds as Set<string>;
    expect([...dirtyIds]).toEqual(['t2']);
    // Черновика нет — меток нет.
    cleanup();
    routeDocState.value = { selection: null, dirty: false, workflowId: 'wf-2' };
    setup({ tab: 'processes', type: 't1' });
    expect([...(listProps.value!.dirtyIds as Set<string>)]).toEqual([]);
  });
});
