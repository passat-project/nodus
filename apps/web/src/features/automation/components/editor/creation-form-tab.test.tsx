// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm, FormulaNode, ProcessType } from '@nodus/contracts';
import { customFieldKey, ui } from '@nodus/contracts';

/** Вкладка «Форма создания» типа задачи (#496; #857, единая модель
 *  «Процессов»): редактор окна целиком во вкладке, правки — прямо в черновик
 *  маршрута, одна правка — один коммит стора; без «Готово» и «Отмена». */

const b = ui.forms.builder;
const c = ui.automation.creation;

const fixtures = vi.hoisted(() => ({
  typeId: '20000000-0000-4000-8000-000000000901',
  fieldId: 'c0000000-0000-4000-8000-0000000000e1',
  definitions: [
    {
      id: 'c0000000-0000-4000-8000-0000000000e1',
      number: 1,
      type: 'text',
      name: '№ накладной',
      hint: null,
      settings: {},
      dictionary: null,
      defaultValue: null,
      defaultRefs: [],
      reportIndexed: false,
      isCompany: false,
      companyValue: null,
      bindings: {
        processTypeIds: ['20000000-0000-4000-8000-000000000901'],
        projectTypeIds: [],
        nodeKindIds: [],
      },
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}));

const TYPE_ID = fixtures.typeId;
const FIELD_ID = fixtures.fieldId;
const CF = customFieldKey(FIELD_ID);

const TITLE_FORMULA = { kind: 'literal', value: 'Поручение' } as CreationForm['titleFormula'];
const FIELD_FORMULA = { kind: 'literal', value: 'x' } as unknown as FormulaNode;

const FORM: CreationForm = {
  fields: [
    { key: 'assignee', label: null, required: false, preset: null },
    { key: 'description', label: null, required: false, preset: null },
    { key: 'deadline', label: null, required: true, preset: null },
    { key: CF, label: null, required: false, preset: null, formula: FIELD_FORMULA },
    { kind: 'heading', id: 'dhead001', text: 'Что поручаем' },
  ],
  chips: ['checklist'],
  titleFormula: TITLE_FORMULA,
};

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions, isLoading: false }),
}));
vi.mock('../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));

/** Живой стор: коммит меняет документ, компонент перерисовывается — как в приложении. */
const route = vi.hoisted(() => ({ commits: [] as unknown[] }));
vi.mock('../../model/route-doc-store.js', async () => {
  const { useSyncExternalStore } = await import('react');
  const listeners = new Set<() => void>();
  const state = {
    document: { stages: [], transitions: [], creation: null as CreationForm | null },
    setCreationForm: vi.fn((next: CreationForm | null) => {
      route.commits.push(next);
      state.document = { ...state.document, creation: next };
      for (const listener of listeners) listener();
    }),
    select: vi.fn(),
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const useRouteDocStore = (selector: (value: typeof state) => unknown) =>
    useSyncExternalStore(subscribe, () => selector(state));
  useRouteDocStore.getState = () => state;
  return { useRouteDocStore };
});

import { useRouteDocStore } from '../../model/route-doc-store.js';
import { CreationFormTab } from './creation-form-tab.js';

const TYPE = { id: TYPE_ID, name: 'Поручение', category: 'task' } as ProcessType;

beforeEach(() => {
  route.commits = [];
});

afterEach(cleanup);

/** Открыть вкладку с формой `creation` в документе маршрута. */
function openTab(creation: CreationForm | null, readOnly = false, focusKey: string | null = null) {
  useRouteDocStore.getState().setCreationForm(creation);
  route.commits = [];
  return render(<CreationFormTab type={TYPE} readOnly={readOnly} focusKey={focusKey} />);
}

function itemOf(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const inside = matches.find((element) => element.closest('.group\\/item'));
  return (inside ?? matches[0]!).closest('.group\\/item') as HTMLElement;
}

function openSettings(label: string): HTMLElement {
  const item = itemOf(label);
  fireEvent.click(within(item).getAllByRole('button', { name: b.settings })[0]!);
  return item;
}

const commits = () => route.commits as CreationForm[];
const lastCommit = () => commits().at(-1)!;

describe('вкладка «Форма создания»: состав', () => {
  it('редактор окна целиком во вкладке: подводка, лист на поверхности окна, лоток; без «Готово» и «Отмена»', () => {
    openTab(FORM);
    expect(screen.getByText(`${b.titles.creation} · Поручение`)).toBeTruthy();
    expect(screen.getByText(b.lead)).toBeTruthy();
    expect(screen.getByTitle(b.fixedRow)).toBeTruthy();
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.getByDisplayValue('Что поручаем')).toBeTruthy();
    expect(screen.getAllByText(c.chipChecklist).length).toBeGreaterThan(0);
    expect(screen.getByText(b.badgeFormula)).toBeTruthy();
    expect(screen.getByText(b.tray)).toBeTruthy();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.queryByRole('button', { name: b.cancel })).toBeNull();
    // Лист — поверхность настоящего окна (`bg-popover` с кольцом), не `bg-background`.
    const sheet = screen.getByDisplayValue('Что поручаем').closest('.rounded-xl')!;
    expect(sheet.className).toContain('bg-popover');
    expect(sheet.className).toContain('ring-1');
    expect(sheet.className).not.toContain('bg-background');
  });

  it('только просмотр (письмо, без права): лотка нет, правки не пишутся', () => {
    openTab(FORM, true);
    expect(screen.getByText(b.readOnly)).toBeTruthy();
    expect(screen.queryByText(b.tray)).toBeNull();
    expect(commits()).toHaveLength(0);
  });

  it('форма не настроена: тихая заметка «Стандартная форма»; первая правка пишет форму в документ маршрута', () => {
    openTab(null);
    expect(screen.getByText(c.defaultForm)).toBeTruthy();
    expect(screen.getByText(c.defaultFormHint)).toBeTruthy();
    expect(commits()).toHaveLength(0);

    // Стандартная форма уже содержит всё, включая «Плановое время»: первая
    // правка — убрать чип «Чек-лист».
    openSettings(c.chipChecklist);
    fireEvent.click(screen.getByRole('button', { name: b.remove }));
    expect(commits()).toHaveLength(1);
    const next = lastCommit();
    expect(next!.chips).not.toContain('checklist');
    expect(next!.fields.length).toBeGreaterThan(0);
    expect(screen.queryByText(c.defaultForm)).toBeNull();
  });

  it('фокус поля из проблемы публикации: настройки поля открыты сразу', () => {
    openTab(FORM, false, 'description');
    expect(screen.getByRole('switch', { name: new RegExp(c.hideTitle) })).toBeTruthy();
    expect(commits()).toHaveLength(0);
  });
});

describe('вкладка «Форма создания»: правки идут прямо в черновик маршрута', () => {
  it('одна правка — один коммит стора: убрать чип', () => {
    openTab(FORM);
    openSettings(c.chipChecklist);
    expect(screen.getByText(c.chipChecklistHint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));
    expect(commits()).toHaveLength(1);
    expect(lastCommit().chips).toEqual([]);
  });

  it('одна правка — один коммит стора: лоток добавляет чип «Плановое время»', () => {
    openTab(FORM);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(c.chipPlanned) }));
    expect(commits()).toHaveLength(1);
    expect(lastCommit().chips).toEqual(['checklist', 'planned']);
  });

  it('правка листа не стирает формулу названия и формулы атрибутов', () => {
    openTab(FORM);
    openSettings('№ накладной');
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(c.required, 'u') }));
    expect(commits()).toHaveLength(1);
    const next = lastCommit();
    expect(next.titleFormula).toEqual(TITLE_FORMULA);
    expect(next.fields).toContainEqual(expect.objectContaining({ key: CF, required: true }));
    expect(next.fields.find((field) => 'key' in field && field.key === CF)).toMatchObject({
      formula: FIELD_FORMULA,
    });
  });

  it('скрытое значение: включение, ввод текста и снятая обязательность — каждый шаг своим коммитом', () => {
    openTab(FORM);
    openSettings('Описание');
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(c.hideTitle) }));
    expect(commits()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(c.preset), { target: { value: 'По умолчанию' } });
    expect(commits()).toHaveLength(2);
    expect(lastCommit().fields).toContainEqual(
      expect.objectContaining({ key: 'description', preset: 'По умолчанию', required: false }),
    );
    // Формула названия пережила оба коммита.
    expect(lastCommit().titleFormula).toEqual(TITLE_FORMULA);
  });

  it('обязательность и смена подписи у атрибута', () => {
    openTab(FORM);
    openSettings('№ накладной');
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(c.required, 'u') }));
    fireEvent.change(screen.getByLabelText(b.label), { target: { value: 'Накладная' } });
    expect(lastCommit().fields).toContainEqual(
      expect.objectContaining({ key: CF, required: true, label: 'Накладная' }),
    );
  });

  it('необязательное системное поле: «Обязательно» недоступно с пояснением', () => {
    openTab(FORM);
    openSettings('Ответственный');
    expect(screen.getByText(c.requiredAlways)).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: new RegExp(c.required, 'u') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('формула названия открывается из системной строки листа', () => {
    openTab(FORM);
    fireEvent.click(screen.getByRole('button', { name: b.titleFormula }));
    expect(screen.getByText(b.titleFormulaHint)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.formulas.typeFormula.edit })).toBeTruthy();
  });
});
