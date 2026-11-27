// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { fieldIds } from '../../../../shared/mocks/data/field-ids.js';

/** Вкладка «Форма создания» типа папки (#496; #857, единая модель «Процессов»):
 *  редактор окна целиком во вкладке с автосохранением — вместо раздела
 *  «Поля и форма» (список полей и окно поверх). */

const b = ui.forms.builder;
const s = ui.nodeKinds.form.state;

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(fieldIds.projectCode, 'Код', ids.kind),
      definition(fieldIds.projectClient, 'Заказчик', 'other-kind'),
    ],
    isLoading: false,
  }),
}));
const ids = vi.hoisted(() => ({ kind: '70000000-0000-4000-8000-000000000001' }));
const catalog = vi.hoisted(() => ({
  mutateAsync: vi.fn<(vars: unknown) => Promise<void>>(),
  /** С какими опциями рама создала мутацию (автосохранение — «тихая»). */
  options: [] as unknown[],
}));
vi.mock('../api/node-kinds-api.js', () => ({
  useUpdateNodeKind: (options: unknown) => {
    catalog.options.push(options);
    return { mutateAsync: catalog.mutateAsync };
  },
}));

function definition(id: string, name: string, nodeKindId: string): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [nodeKindId] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

import {
  AUTOSAVE_DELAY_MS,
  FormSaveState,
} from '../../../../shared/forms/builder/form-autosave.js';
import { NodeKindFormTab, useNodeKindForm } from './node-kind-form-tab.js';

const KIND: NodeKind = {
  id: ids.kind,
  name: 'Комплект',
  icon: 'folder',
  color: 'blue',
  archivedAt: null,
  capabilities: [],
  form: { fields: [{ fieldId: fieldIds.projectCode, state: 'required' }] },
} as unknown as NodeKind;
type FormVars = { id: string; form: { fields: { fieldId: string; state?: string }[] } };

/** Рама типа: автосохранение живёт в ней, вкладка только рисует лист. */
function Harness({ canSetup = true }: { canSetup?: boolean }) {
  const [kind, setKind] = useState(KIND);
  const form = useNodeKindForm(kind);
  useEffect(() => {
    // Мутация правит кэш оптимистично: рама сразу видит новую форму.
    catalog.mutateAsync.mockImplementation(async (vars) => {
      setKind({ ...KIND, form: (vars as FormVars).form as NodeKind['form'] });
    });
  }, [setKind]);
  return (
    <>
      <FormSaveState state={form.state} onRetry={form.retry} />
      <NodeKindFormTab kind={kind} canSetup={canSetup} canCreateField={false} form={form} />
    </>
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Открыть настройки первого поля и переставить состояние слота. */
function setState(name: string) {
  fireEvent.click(screen.getAllByRole('button', { name: b.settings })[0]!);
  fireEvent.click(screen.getByRole('radio', { name }));
}

beforeEach(() => {
  vi.useFakeTimers();
  catalog.mutateAsync.mockReset();
  catalog.options = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('вкладка «Форма создания» типа папки — автосохранение (#857)', () => {
  it('лист — окно в натуральную величину: название и вид папки сверху, свои атрибуты, лоток; без «Готово»', () => {
    render(<Harness />);
    expect(screen.getByText(`${b.titles.folder} · Комплект`)).toBeTruthy();
    expect(screen.getByText(b.lead)).toBeTruthy();
    expect(screen.getByText(ui.structure.nodeName)).toBeTruthy();
    expect(screen.getByText(ui.structure.nodeKind)).toBeTruthy();
    expect(screen.getByText('Код')).toBeTruthy();
    // Чужой атрибут в окно этого типа не предлагают.
    expect(screen.queryByText('Заказчик')).toBeNull();
    expect(screen.getByText(b.tray)).toBeTruthy();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.queryByRole('button', { name: b.cancel })).toBeNull();
    const sheet = screen.getByText('Код').closest('.rounded-xl')!;
    expect(sheet.className).toContain('bg-popover');
    expect(sheet.className).not.toContain('bg-background');
  });

  it('мутация тихая; правка сохраняется сама через задержку — формой типа', async () => {
    render(<Harness />);
    expect(catalog.options).toEqual([{ quiet: true }]);
    setState(s.hidden);
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(catalog.mutateAsync).not.toHaveBeenCalled();
    await advance(1);
    expect(catalog.mutateAsync).toHaveBeenCalledTimes(1);
    const [vars] = catalog.mutateAsync.mock.calls[0] as [FormVars];
    expect(vars.id).toBe(ids.kind);
    expect(vars.form.fields).toEqual([
      { fieldId: fieldIds.projectCode, state: 'hidden', label: null },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain(b.saving);
  });

  it('ошибка держит правку: «Не сохранилось» и «Повторить»', async () => {
    catalog.mutateAsync.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    render(<Harness />);
    setState(s.hidden);
    await advance(AUTOSAVE_DELAY_MS);
    expect(screen.getByRole('alert').textContent).toContain(b.notSaved);
    // Правка на месте.
    expect(screen.getByRole('radio', { name: s.hidden }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: b.retry }));
    await advance(0);
    expect(catalog.mutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('без права project.setup.manage — только просмотр: лотка нет, правки не пишутся', async () => {
    render(<Harness canSetup={false} />);
    expect(screen.getByText(b.readOnly)).toBeTruthy();
    expect(screen.queryByText(b.tray)).toBeNull();
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(catalog.mutateAsync).not.toHaveBeenCalled();
  });
});
