// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TaskPressButton, TaskPressStatus } from './task-press-button.js';

afterEach(cleanup);

function setup() {
  const onPress = vi.fn();
  const onOpenStatuses = vi.fn();
  render(
    <TaskPressButton
      name="Ознакомлен"
      pressed={5}
      total={9}
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
    expect(await screen.findByText('Прогресс')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Статусы участников' }));
    expect(onOpenStatuses).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Прогресс')).toBeNull());
  });

  it('кольцо показывает прогресс без текста «Кто нажал»', async () => {
    setup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Статусы участников: 5 / 9' }));
    expect(await screen.findByText('5 / 9')).toBeTruthy();
    expect(screen.queryByText('Кто нажал')).toBeNull();
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
});
