// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkflowAction } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api/transitions-api.js', () => ({ gateReasonsText: () => 'нет отметки' }));

import { TaskActionsMenu } from './task-actions-menu.js';

/** Действие в меню: только поля, которые читает кнопка (#633). */
const action = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    display: 'button',
    form: null,
    blockedBy: [],
    validators: [],
    ...extra,
  }) as unknown as WorkflowAction;

const windowed = () => ({ form: { enabled: true, sections: [] } });
const allButton = (count: number) => `${ui.tasks.allActionsLabel} ${count}`;
const runButton = (name: string) => `${ui.tasks.actionRunLabel} ${name}`;

function mount(actions: WorkflowAction[], onRun = vi.fn()) {
  render(<TaskActionsMenu actions={actions} runningId={null} onRun={onRun} />);
  return { onRun };
}

/** Меню открывается правой частью сдвоенной кнопки (или единственной кнопкой). */
async function openMenu(triggerName: string) {
  const trigger = screen.getByRole('button', { name: triggerName });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return { trigger, menu: await screen.findByRole('menu') };
}

afterEach(cleanup);

describe('TaskActionsMenu: сдвоенная кнопка (модель Битрикс24)', () => {
  it('2+ действия: слева дефолтное, справа шеврон; клик слева выполняет первое', () => {
    const { onRun } = mount([action('a1', 'Первое'), action('a2', 'Второе')]);

    const left = screen.getByRole('button', { name: runButton('Первое') });
    const right = screen.getByRole('button', { name: allButton(2) });
    // Две отдельные кнопки, не вложенные интерактивы.
    expect(left.contains(right)).toBe(false);
    expect(right.getAttribute('aria-haspopup')).toBe('menu');
    // Один визуальный блок: левая со скруглением слева, правая справа.
    expect(left.className).toContain('rounded-l-md');
    expect(right.className).toContain('rounded-r-md');
    expect(right.className).toContain('w-7');
    expect(right.className).toContain('border-l-border/60');

    fireEvent.click(left);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('меню — все действия (включая дефолтное) и шапка «Действия · N»', async () => {
    mount([action('a1', 'Первое'), action('a2', 'Второе'), action('a3', 'Третье')]);
    const { menu } = await openMenu(allButton(3));

    // Шапка — не пункт меню.
    expect(menu.textContent).toContain(`${ui.tasks.actionsMenu} · 3`);
    expect(screen.queryByRole('menuitem', { name: /Действия · 3/ })).toBeNull();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
    expect(items).toEqual(['Первое', 'Второе', 'Третье']);
  });

  it('заблокированное дефолтное действие — не «мертвое», причины в title', () => {
    const { onRun } = mount([
      action('a1', 'С гейтом', { blockedBy: [{ kind: 'time_logged' }] }),
      action('a2', 'Второе'),
    ]);

    const left = screen.getByRole('button', { name: runButton('С гейтом') });
    expect(left.getAttribute('data-blocked')).toBe('true');
    expect(left.getAttribute('title')).toBe(`${ui.tasks.processBlockedMissing} нет отметки`);

    fireEvent.click(left);
    // Тот же путь, что у пункта меню: раннер откроет окно причин.
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('первое действие display:menu — дефолта нет, только «Действия» с шевроном', async () => {
    mount([action('a1', 'В меню', { display: 'menu' }), action('a2', 'Второе')]);

    expect(screen.queryByRole('button', { name: runButton('В меню') })).toBeNull();
    const trigger = screen.getByRole('button', { name: allButton(2) });
    expect(trigger.textContent).toContain(ui.tasks.actionsMenu);

    await openMenu(allButton(2));
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('ширина меню — по содержимому, без фиксированной ширины триггера', async () => {
    mount([action('a1', 'Короткое'), action('a2', 'Тоже короткое')]);
    const { menu } = await openMenu(allButton(2));

    const cls = menu.className;
    expect(cls).toContain('w-auto!');
    expect(cls).toContain('min-w-44');
    expect(cls).toContain('max-w-[22rem]');
    expect(cls).not.toContain('w-72');
    expect(cls).not.toContain('min-w-64');
  });

  it('шеврон один и повёрнут при открытом меню', async () => {
    mount([action('a1', 'Первое'), action('a2', 'Второе')]);
    const { trigger } = await openMenu(allButton(2));

    const chevrons = trigger.querySelectorAll('svg.lucide-chevron-down');
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]?.getAttribute('class')).toContain(
      'group-data-[state=open]/trigger:rotate-180',
    );
    expect(trigger.getAttribute('data-state')).toBe('open');
  });
});

describe('TaskActionsMenu: пункт меню', () => {
  it('одна строка h-9: ни второй строки, ни иконки-карандаша', async () => {
    mount([action('a1', 'Первое'), action('a2', 'Открывает окно', windowed())]);
    await openMenu(allButton(2));

    const withWindow = screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent?.includes('Открывает окно')) as HTMLElement;
    expect(withWindow.className).toContain('h-9');
    expect(withWindow.className).toContain('px-2');
    expect(withWindow.querySelector('.block')).toBeNull();
    // В пункте только иконка действия — маркера окна нет.
    expect(withWindow.querySelectorAll('svg')).toHaveLength(1);
    expect(withWindow.querySelectorAll('svg.lucide-square-pen')).toHaveLength(0);
    // Подсказка об окне — в title самого пункта.
    expect(withWindow.getAttribute('title')).toBe(`Открывает окно — ${ui.tasks.actionOpensWindow}`);
    const plain = screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent?.includes('Первое')) as HTMLElement;
    expect(plain.getAttribute('title')).toBe('Первое');
  });

  it('длинное название — многоточие до 20rem, полное имя в title пункта', async () => {
    const long = 'Очень длинное название действия, которое не влезает в меню целиком';
    mount([action('a1', long), action('a2', 'Короткое')]);
    await openMenu(allButton(2));

    const [item] = screen.getAllByRole('menuitem') as [HTMLElement];
    const name = item?.querySelector('span') as HTMLElement;
    expect(name.textContent).toBe(long);
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('max-w-[20rem]');
    expect(item.getAttribute('title')).toBe(long);
  });

  it('заблокированный пункт — маркер CircleSlash, причины в title, клик работает', async () => {
    const { onRun } = mount([
      action('a1', 'Свободное'),
      action('a2', 'С гейтом', { blockedBy: [{ kind: 'time_logged' }] }),
    ]);
    await openMenu(allButton(2));

    const reasons = `${ui.tasks.processBlockedMissing} нет отметки`;
    const blocked = screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent?.includes('С гейтом')) as HTMLElement;
    expect(blocked.getAttribute('data-blocked')).toBe('true');
    expect(blocked.getAttribute('title')).toBe(reasons);
    // Маркер недоступности + причина текстом для скринридера.
    expect(blocked.querySelectorAll('svg')).toHaveLength(2);
    expect(blocked.querySelector('.sr-only')?.textContent).toBe(reasons);
    expect(blocked.querySelector('.block')).toBeNull();
    const name = blocked.querySelector('span') as HTMLElement;
    expect(name.className).toContain('text-muted-foreground');

    fireEvent.click(blocked);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('разделитель — только на смене группы display', async () => {
    mount([
      action('a1', 'Первое'),
      action('a2', 'Второе'),
      action('a3', 'Третье', { display: 'menu' }),
    ]);
    await openMenu(allButton(3));
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    cleanup();

    mount([action('b1', 'Один'), action('b2', 'Два')]);
    await openMenu(allButton(2));
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });
});

describe('TaskActionsMenu: клавиатура', () => {
  it('Tab идёт по двум частям, Enter открывает меню, Esc возвращает фокус', async () => {
    mount([action('a1', 'Первое'), action('a2', 'Второе')]);

    const left = screen.getByRole('button', { name: runButton('Первое') });
    const right = screen.getByRole('button', { name: allButton(2) });
    // Обе части в порядке табуляции (без tabIndex=-1), фокус переводим явно:
    // jsdom не исполняет дефолтное поведение Tab.
    expect(left.getAttribute('tabindex')).toBeNull();
    expect(right.getAttribute('tabindex')).toBeNull();
    left.focus();
    right.focus();
    expect(document.activeElement).toBe(right);

    fireEvent.keyDown(right, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Radix возвращает фокус на триггер — правую часть.
    await waitFor(() => expect(document.activeElement).toBe(right));
  });

  it('↑/↓ водят фокус, Enter выбирает пункт', async () => {
    const { onRun } = mount([action('a1', 'Первое'), action('a2', 'Второе')]);
    const { menu } = await openMenu(allButton(2));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'));
    const first = document.activeElement as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).not.toBe(first));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
  });
});
