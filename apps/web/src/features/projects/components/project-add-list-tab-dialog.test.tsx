// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedView } from '@nodus/contracts';

import { ProjectAddListTabDialog } from './project-add-list-tab-dialog.js';

/**
 * #435: окно новой вкладки-списка — «что показывать» (три сущности), панель
 * фильтра та же, «Сохранить вкладкой» с рамкой проекта и уровнем доступа
 * (личная по умолчанию; общая — только руководству). Условий projectId в
 * панели нет — рамку снять нельзя.
 */

vi.mock('../lib/view-tab-filter-defs.js', () => ({
  useFilterDefsOfEntity: () => [],
}));
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));

const created = { current: null as Record<string, unknown> | null };
const makeSavedView = (): SavedView => ({
  id: 'v-9',
  name: 'Переработки',
  entity: 'task',
  scope: { kind: 'project', projectId: 'p-1' },
  level: 'project',
  filter: [],
  sort: [],
  totals: [],
  columns: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: null,
});
const mutate = vi.fn((body: unknown, options: { onSuccess: (view: SavedView) => void }) => {
  created.current = body as Record<string, unknown>;
  options.onSuccess({
    id: 'v-1',
    name: 'Имя с сервера',
    entity: 'task',
    scope: { kind: 'project', projectId: 'p-1' },
    level: 'personal',
    filter: [],
    sort: [],
    totals: [],
    columns: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    createdBy: null,
  });
});
vi.mock('../../../shared/views/list-ext/saved-views-api.js', () => ({
  useCreateSavedView: () => ({ mutate, isPending: false }),
  useUpdateSavedView: () => ({ mutate: () => undefined, isPending: false }),
}));

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  cleanup();
  mutate.mockClear();
  created.current = null;
});

function renderDialog(canManage = true) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ProjectAddListTabDialog
      projectId="p-1"
      canManage={canManage}
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onOpenChange };
}

describe('ProjectAddListTabDialog: что показывать → панель → вкладка (#435)', () => {
  it('сохраняет письма проекта личной вкладкой с рамкой проекта', () => {
    const { onSaved } = renderDialog();
    // Шаг «что показывать»: три варианта, выбираем «Письма проекта».
    fireEvent.click(screen.getByText('Письма проекта'));
    // Панель фильтра та же, что в журналах (секции расширения на месте).
    expect(screen.getByText('Группировка')).not.toBeNull();
    // Название и сохранение.
    fireEvent.change(screen.getByPlaceholderText('Например, Переработки'), {
      target: { value: 'Переписка' },
    });
    fireEvent.click(screen.getByText('Сохранить вкладкой'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(created.current).toMatchObject({
      name: 'Переписка',
      entity: 'letter',
      scope: { kind: 'project', projectId: 'p-1' },
      level: 'personal',
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('руководство может сохранить общую проектную вкладку', () => {
    renderDialog(true);
    fireEvent.change(screen.getByPlaceholderText('Например, Переработки'), {
      target: { value: 'Сметы' },
    });
    fireEvent.click(screen.getByText('Общая — всему проекту'));
    fireEvent.click(screen.getByText('Сохранить вкладкой'));
    expect(created.current).toMatchObject({ level: 'project' });
  });

  it('не-руководство не видит выбора уровня — только личная', () => {
    renderDialog(false);
    expect(screen.queryByText('Общая — всему проекту')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Например, Переработки'), {
      target: { value: 'Мои переработки' },
    });
    fireEvent.click(screen.getByText('Сохранить вкладкой'));
    expect(created.current).toMatchObject({ level: 'personal' });
  });

  it('правка существующего: имя подставлено, сущность не переключается', () => {
    render(
      <ProjectAddListTabDialog
        projectId="p-1"
        canManage={false}
        editView={{
          ...makeSavedView(),
          name: 'Переработки',
          entity: 'task',
          level: 'project',
        }}
        open
        onOpenChange={() => undefined}
        onSaved={() => undefined}
      />,
    );
    // Шага «что показывать» в правке нет — сущность списка не меняется;
    // уровень тоже (права и место хранения).
    expect(screen.queryByText('Письма проекта')).toBeNull();
    expect(screen.queryByText('Кому доступна вкладка')).toBeNull();
    expect((screen.getByPlaceholderText('Например, Переработки') as HTMLInputElement).value).toBe(
      'Переработки',
    );
    expect(screen.getByText('Редактирование списка')).not.toBeNull();
    expect(screen.getByText('Сохранить изменения')).not.toBeNull();
  });
});
