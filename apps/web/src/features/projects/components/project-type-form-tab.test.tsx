// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { fieldIds } from '../../../shared/mocks/data/field-ids.js';

/** Вкладка «Форма создания» типа проекта (#496; #857, единая модель
 *  «Процессов»): редактор окна целиком во вкладке с автосохранением — без
 *  «Готово»; пустой заголовок на сервер не уходит; ошибка держит правку. */

const b = ui.forms.builder;

const TYPE_ID = '41000000-0000-4000-8000-0000000000e1';

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: [],
      projectTypeIds: ['41000000-0000-4000-8000-0000000000e1'],
      nodeKindIds: [],
    },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(fieldIds.projectCode, 'text', 'Шифр'),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик'),
    ],
    isLoading: false,
  }),
}));
const catalog = vi.hoisted(() => ({
  mutateAsync: vi.fn<(vars: unknown) => Promise<void>>(),
  /** С какими опциями рама создала мутацию (автосохранение — «тихая»). */
  options: [] as unknown[],
}));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: (options: unknown) => {
    catalog.options.push(options);
    return { mutateAsync: catalog.mutateAsync };
  },
  useCreateProjectGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AUTOSAVE_DELAY_MS, FormSaveState } from '../../../shared/forms/builder/form-autosave.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectTypeFormTab, useProjectTypeForm } from './project-type-form-tab.js';

const TYPE: ProjectType = {
  id: TYPE_ID,
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  kindIds: null,
  archivedAt: null,
  form: {
    fields: [
      { fieldId: fieldIds.projectCode, state: 'required' },
      { fieldId: fieldIds.projectClient, state: 'optional' },
    ],
  },
};
type FormVars = { id: string; form: { fields: { fieldId: string; width?: string }[] } };

/** Рама типа: автосохранение живёт в ней, вкладка только рисует лист. */
function Harness({
  canSetup = true,
  canCreateField = false,
  renderCreateField,
}: {
  canSetup?: boolean;
  canCreateField?: boolean;
  renderCreateField?: RenderCreateField;
}) {
  const [type, setType] = useState(TYPE);
  const form = useProjectTypeForm(type);
  useEffect(() => {
    // Мутация каталога правит кэш оптимистично: рама сразу видит новую форму.
    catalog.mutateAsync.mockImplementation(async (vars) => {
      setType({ ...TYPE, form: (vars as FormVars).form as ProjectType['form'] });
    });
  }, [setType]);
  return (
    <>
      <FormSaveState state={form.state} onRetry={form.retry} />
      <ProjectTypeFormTab
        type={type}
        canSetup={canSetup}
        canCreateField={canCreateField}
        renderCreateField={renderCreateField}
        form={form}
      />
    </>
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const widthToggles = () =>
  screen
    .getAllByRole('button')
    .filter((button) =>
      ([b.widthHalf, b.widthFull] as string[]).includes(button.getAttribute('aria-label') ?? ''),
    );
const requests = () => catalog.mutateAsync.mock.calls.map(([vars]) => vars as FormVars);

beforeEach(() => {
  vi.useFakeTimers();
  catalog.mutateAsync.mockReset();
  catalog.options = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('вкладка «Форма создания» типа проекта — автосохранение (#857)', () => {
  it('лист — окно в натуральную величину: системные строки и поля в одной прокрутке; без «Готово» и «Отмена»', () => {
    render(<Harness />);
    expect(screen.getByText(`${b.titles.project} · Договор`)).toBeTruthy();
    expect(screen.getByText(b.lead)).toBeTruthy();
    expect(screen.getByTitle(b.fixedRow)).toBeTruthy();
    expect(screen.getByText('Шифр')).toBeTruthy();
    expect(screen.getByText('Заказчик')).toBeTruthy();
    expect(screen.getByText(b.tray)).toBeTruthy();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.queryByRole('button', { name: b.cancel })).toBeNull();
    // Лист — поверхность настоящего окна, не `bg-background`.
    const sheet = screen.getByText('Шифр').closest('.rounded-xl')!;
    expect(sheet.className).toContain('bg-popover');
    expect(sheet.className).not.toContain('bg-background');
  });

  it('мутация тихая: без всплывающих уведомлений — состояние пишет строка бара', () => {
    render(<Harness />);
    expect(catalog.options).toEqual([{ quiet: true }]);
  });

  it('правка сохраняется сама через задержку — формой типа, без кнопок', async () => {
    render(<Harness />);
    fireEvent.click(widthToggles()[0]!);
    // Пауза: строка «Сохранение…», запроса ещё нет.
    expect(document.body.textContent).toContain(b.saving);
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(catalog.mutateAsync).not.toHaveBeenCalled();
    await advance(1);
    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.id).toBe(TYPE_ID);
    expect(
      requests()[0]!.form.fields.find((field) => field.fieldId === fieldIds.projectCode),
    ).toMatchObject({ width: 'half' });
    expect(document.body.textContent).not.toContain(b.saving);
  });

  it('ошибка держит правку: «Не сохранилось»; «Повторить» шлёт форму снова', async () => {
    catalog.mutateAsync.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    render(<Harness />);
    fireEvent.click(widthToggles()[0]!);
    await advance(AUTOSAVE_DELAY_MS);
    expect(screen.getByRole('alert').textContent).toContain(b.notSaved);
    // Правка на листе: ширина по-прежнему на половину строки.
    expect(
      widthToggles().filter((button) => button.getAttribute('aria-label') === b.widthFull),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: b.retry }));
    await advance(0);
    expect(catalog.mutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('пустой заголовок не уходит на сервер: подсказка держит сохранение, текст её отпускает', async () => {
    // Вставка оформления — поповер Radix: живёт на настоящих таймерах.
    vi.useRealTimers();
    const pause = (ms: number) =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: b.insert })[0]!);
    fireEvent.click(screen.getByRole('button', { name: b.decor.heading }));
    expect(screen.getByPlaceholderText(b.headingPlaceholder)).toBeTruthy();
    expect(document.body.textContent).toContain(b.decorEmpty);
    await pause(AUTOSAVE_DELAY_MS + 250);
    expect(catalog.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(b.headingPlaceholder), {
      target: { value: 'Раздел' },
    });
    await pause(AUTOSAVE_DELAY_MS + 250);
    expect(catalog.mutateAsync).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(b.decorEmpty);
  });

  it('без права project.setup.manage — только просмотр: лотка нет, правок нет', async () => {
    render(<Harness canSetup={false} />);
    expect(screen.getByText(b.readOnly)).toBeTruthy();
    expect(screen.queryByText(b.tray)).toBeNull();
    expect(screen.queryByRole('button', { name: b.insert })).toBeNull();
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(catalog.mutateAsync).not.toHaveBeenCalled();
  });

  it('«Создать атрибут» — слот уровня app (I6): окно фичи automation по клику в лотке', () => {
    const renderCreateField = vi.fn<RenderCreateField>(() => <div data-testid="field-dialog" />);
    render(<Harness canCreateField renderCreateField={renderCreateField} />);
    expect(screen.queryByTestId('field-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.createField) }));
    expect(screen.getByTestId('field-dialog')).toBeTruthy();
    expect(renderCreateField).toHaveBeenCalledTimes(1);
  });
});
