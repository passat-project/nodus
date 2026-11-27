// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TaskPressButton, TaskPressStatus } from './task-press-button.js';

afterEach(cleanup);

function setup(participants: { userId: string; displayName: string }[] = []) {
  const onPress = vi.fn();
  const onOpenStatuses = vi.fn();
  render(
    <TaskPressButton
      name="Ознакомлен"
      pressed={5}
      total={9}
      participants={participants}
      main
      onPress={onPress}
      onOpenStatuses={onOpenStatuses}
    />,
  );
  return { onPress, onOpenStatuses };
}

describe('кнопка коллективного действия (#434)', () => {
  it('название нажимает кнопку, кольцо открывает статусы', async () => {
    const { onPress, onOpenStatuses } = setup();
    const label = screen.getByRole('button', { name: 'Ознакомлен' });
    expect(label.getAttribute('title')).toBe('Ознакомлен');
    fireEvent.click(label);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onOpenStatuses).not.toHaveBeenCalled();

    const ring = screen.getByRole('button', { name: 'Статусы участников: 5 / 9' });
    fireEvent.mouseEnter(ring);
    fireEvent.click(await screen.findByRole('button', { name: 'Статусы участников' }));
    expect(onOpenStatuses).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Статусы участников' })).toBeNull(),
    );
  });

  it('попап показывает фото нажавших без строки «Прогресс» и счётчика (#965)', async () => {
    setup([
      { userId: 'u1', displayName: 'Борис Климов' },
      { userId: 'u2', displayName: 'Анна Петрова' },
    ]);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Статусы участников: 5 / 9' }));
    expect(await screen.findByTitle('Борис Климов')).toBeTruthy();
    expect(screen.getByTitle('Анна Петрова')).toBeTruthy();
    expect(screen.queryByText('Прогресс')).toBeNull();
    expect(screen.queryByText('5 / 9')).toBeNull();
  });

  it('индикатор после нажатия открывает статусы без действия кнопки', async () => {
    const onOpenStatuses = vi.fn();
    render(<TaskPressStatus pressed={5} total={9} onOpenStatuses={onOpenStatuses} />);
    const chip = screen.getByRole('button', { name: 'Статусы участников: 5 / 9' });
    expect(screen.queryByRole('button', { name: 'Ознакомлен' })).toBeNull();
    fireEvent.mouseEnter(chip);
    fireEvent.click(await screen.findByRole('button', { name: 'Статусы участников' }));
    expect(onOpenStatuses).toHaveBeenCalledTimes(1);
  });

  it('кольцо закрывает поповер после ухода мыши', async () => {
    setup();
    const ring = screen.getByRole('button', { name: 'Статусы участников: 5 / 9' });
    fireEvent.mouseEnter(ring);
    expect(await screen.findByRole('button', { name: 'Статусы участников' })).toBeTruthy();
    fireEvent.mouseLeave(ring);
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'Статусы участников' })).toBeNull(),
      { timeout: 1000 },
    );
  });

  it('клик по кольцу и чипу открывает статусы без нажатия кнопки', async () => {
    const onOpenStatuses = vi.fn();
    render(<TaskPressStatus pressed={2} total={4} onOpenStatuses={onOpenStatuses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Статусы участников: 2 / 4' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Статусы участников' }));
    expect(onOpenStatuses).toHaveBeenCalledTimes(1);
  });

  it('немаркерная кнопка тоже нажимается', () => {
    const onPress = vi.fn();
    render(
      <TaskPressButton
        name="Согласовать"
        pressed={0}
        total={2}
        main={false}
        onPress={onPress}
        onOpenStatuses={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Согласовать' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
