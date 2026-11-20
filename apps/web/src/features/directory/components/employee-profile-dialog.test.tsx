// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCard } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { EmployeeProfileDialog } from './employee-profile-dialog.js';

/**
 * Окно профиля (#923): сотрудник видит структуру only-read и сохраняет
 * self-поля через `/me`; админ правит структуру карточкой. Шлём только
 * изменённые поля (детали патчей — unit `profile-draft.test.ts`).
 */

const ME = 'me-1';
const OTHER = 'user-2';

const hooks = vi.hoisted(() => ({
  updateSelf: { mutate: vi.fn(), isPending: false },
  updateUser: { mutate: vi.fn(), isPending: false },
}));

vi.mock('../api/directory-api.js', () => ({
  useUpdateMyProfile: () => hooks.updateSelf,
  useUpdateUser: () => hooks.updateUser,
  usePositions: () => ({
    data: [
      { id: 'pos-1', name: 'БИМ-менеджер', kind: 'management', sortOrder: 0 },
      { id: 'pos-2', name: 'ГИП', kind: 'management', sortOrder: 1 },
    ],
  }),
}));

vi.mock('../../../shared/api/departments-list.js', () => ({
  useDepartmentsList: () => [
    {
      id: 'dep-1',
      name: 'BIM-отдел',
      depth: 0,
      isActive: true,
      headId: null,
      deputyId: null,
    },
  ],
}));

const card = (overrides: Partial<UserCard> = {}): UserCard => ({
  id: OTHER,
  email: 'user@nodus.by',
  displayName: 'Иванов Иван',
  status: 'active',
  lastName: 'Иванов',
  firstName: 'Иван',
  middleName: null,
  managerId: 'boss-1',
  departmentId: 'dep-1',
  positionId: null,
  legalDepartmentId: null,
  legalPositionId: null,
  mobilePhone: null,
  city: null,
  officeLocation: null,
  isRemote: false,
  workRate: null,
  gender: null,
  birthDate: null,
  hiredAt: null,
  workdayStart: null,
  avatarUrl: null,
  roles: [],
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
  });
});

afterEach(cleanup);

describe('EmployeeProfileDialog (#923)', () => {
  it('сотрудник: структура только для чтения, изменённый телефон уходит в /me', () => {
    render(
      <EmployeeProfileDialog
        open
        onOpenChange={vi.fn()}
        card={card({ id: ME })}
        users={[]}
        canManage={false}
      />,
    );
    // Подразделение — текст синим, без выпадающего списка.
    expect(screen.getByText('BIM-отдел')).not.toBeNull();
    expect(screen.queryByRole('combobox', { name: ui.employees.department })).toBeNull();

    fireEvent.change(screen.getByLabelText(ui.employees.fieldPhone), {
      target: { value: '+375291234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));

    expect(hooks.updateSelf.mutate).toHaveBeenCalledWith({ mobilePhone: '+375291234567' });
    expect(hooks.updateUser.mutate).not.toHaveBeenCalled();
  });

  it('админ: подразделение правится списком', () => {
    render(
      <EmployeeProfileDialog open onOpenChange={vi.fn()} card={card()} users={[]} canManage />,
    );
    expect(screen.getByRole('combobox', { name: ui.employees.department })).not.toBeNull();
  });

  it('без имени сохранить нельзя', () => {
    render(
      <EmployeeProfileDialog
        open
        onOpenChange={vi.fn()}
        card={card({ id: ME })}
        users={[]}
        canManage={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(ui.employees.fieldFirstName), {
      target: { value: '   ' },
    });
    expect(
      (screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('фокус открытия — в «Фамилию» в конце, без выделения (#923)', async () => {
    render(
      <EmployeeProfileDialog
        open
        onOpenChange={vi.fn()}
        card={card({ id: ME, lastName: 'Иванов' })}
        users={[]}
        canManage={false}
      />,
    );
    const input = screen.getByLabelText(ui.employees.fieldLastName) as HTMLInputElement;
    // Каретка ставится следующим кадром (rAF) — как в окне подразделения.
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe('Иванов'.length);
    expect(input.selectionEnd).toBe('Иванов'.length);
  });

  it('подразделения — плоский список: дерево без отступов уровней (#923)', () => {
    render(
      <EmployeeProfileDialog open onOpenChange={vi.fn()} card={card()} users={[]} canManage />,
    );
    const trigger = screen.getByRole('combobox', { name: ui.employees.department });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: 'BIM-отдел' });
    // Уровни дерева списку не рисуются — отступа по глубине нет.
    expect(option.getAttribute('style') ?? '').not.toContain('padding-left');
  });

  it('«Должность» — тот же комбобокс с поиском, выбранное значение в поле (#981)', () => {
    render(
      <EmployeeProfileDialog open onOpenChange={vi.fn()} card={card()} users={[]} canManage />,
    );
    const position = screen.getByRole('combobox', { name: ui.employees.position });
    fireEvent.click(position);
    fireEvent.change(position, { target: { value: 'гип' } });

    expect(screen.queryByRole('option', { name: 'БИМ-менеджер' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'ГИП' }));
    expect((position as HTMLInputElement).value).toBe('ГИП');

    fireEvent.click(
      within(position.parentElement as HTMLElement).getByRole('button', {
        name: ui.employees.clearSelection,
      }),
    );
    expect((position as HTMLInputElement).value).toBe('');
  });

  it('секции: Личные данные → Контакты → Структура → Работа (#981)', () => {
    render(
      <EmployeeProfileDialog open onOpenChange={vi.fn()} card={card()} users={[]} canManage />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual([
      ui.employees.sectionPersonal,
      ui.employees.sectionContacts,
      ui.employees.sectionStructure,
      ui.employees.sectionWork,
    ]);
  });
});
