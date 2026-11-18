// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AssistantAction } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  executeMutate: vi.fn(),
  cancelMutate: vi.fn(),
  undoMutate: vi.fn(),
}));

vi.mock('../api/assistant-actions-api.js', () => ({
  useExecuteAssistantAction: () => ({ mutate: h.executeMutate, isPending: false }),
  useCancelAssistantAction: () => ({ mutate: h.cancelMutate, isPending: false }),
  useUndoAssistantAction: () => ({ mutate: h.undoMutate, isPending: false }),
}));

import { AssistantActionCard } from './assistant-action-card.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function action(overrides: Partial<AssistantAction> = {}): AssistantAction {
  return {
    id: 'a-1',
    messageId: null,
    toolId: 'tasks.create',
    title: 'Создать задачу',
    summary: 'Задача «Проверить смету» в проекте «Смета-2026»',
    fields: [
      { label: 'Название', value: 'Проверить смету' },
      { label: 'Исполнитель', value: 'Иванов Иван' },
    ],
    consequences: 'Задача появится в портале',
    undoable: true,
    automatic: false,
    state: 'proposed',
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    createdAt: '2026-11-27T10:00:00.000Z',
    executedAt: null,
    undoneAt: null,
    ...overrides,
  };
}

describe('AssistantActionCard: подтверждение (Ф2)', () => {
  it('предложенное действие: поля и кнопки «Выполнить»/«Отмена»', () => {
    render(<AssistantActionCard action={action()} sessionId="s-1" />);
    expect(screen.getByText('Создать задачу')).toBeTruthy();
    expect(screen.getByText('Исполнитель')).toBeTruthy();
    expect(screen.getByText('Иванов Иван')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.actionExecute }));
    expect(h.executeMutate).toHaveBeenCalledWith('a-1', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.actionCancel }));
    expect(h.cancelMutate).toHaveBeenCalledWith('a-1', expect.anything());
  });

  it('выполненное: результат, «Открыть» и «Отменить» (если API позволяет)', () => {
    render(
      <AssistantActionCard
        action={action({
          state: 'executed',
          resultPreview: 'Задача создана: №5 «Проверить смету»',
          href: '?cards=task:task-1',
          hrefLabel: '№5 Проверить смету',
        })}
        sessionId="s-1"
      />,
    );
    expect(screen.getByText(ui.assistant.actionExecuted)).toBeTruthy();
    expect(screen.getByText('Задача создана: №5 «Проверить смету»')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Открыть/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.actionUndo }));
    expect(h.undoMutate).toHaveBeenCalledWith('a-1', expect.anything());
  });

  it('длинная подпись «Открыть» обрезается внутри карточки (#936)', () => {
    render(
      <AssistantActionCard
        action={action({
          state: 'executed',
          href: '?cards=task:task-1',
          hrefLabel: '№29 '.repeat(30).trim(),
        })}
        sessionId="s-1"
      />,
    );
    const button = screen.getByRole('button', { name: /Открыть/ });
    expect(button.className).toContain('max-w-full');
    expect(button.className).toContain('min-w-0');
    expect(button.querySelector('span')?.className).toContain('truncate');
  });

  it('необратимое выполненное — без кнопки «Отменить»', () => {
    render(
      <AssistantActionCard
        action={action({ state: 'executed', undoable: false })}
        sessionId="s-1"
      />,
    );
    expect(screen.queryByRole('button', { name: ui.assistant.actionUndo })).toBeNull();
  });

  it('байпас: пометка «выполнено автоматически»', () => {
    render(
      <AssistantActionCard
        action={action({ state: 'executed', automatic: true, resultPreview: 'Готово' })}
        sessionId="s-1"
      />,
    );
    expect(screen.getByText(ui.assistant.actionExecutedAuto)).toBeTruthy();
  });

  it('ошибка: «Повторить» снова выполняет карточку; отменённая — без кнопок', () => {
    const { rerender } = render(
      <AssistantActionCard
        action={action({ state: 'failed', resultPreview: 'Нет прав' })}
        sessionId="s-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.actionRetry }));
    expect(h.executeMutate).toHaveBeenCalledWith('a-1', expect.anything());

    rerender(<AssistantActionCard action={action({ state: 'cancelled' })} sessionId="s-1" />);
    expect(screen.getByText(ui.assistant.actionCancelled)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.assistant.actionExecute })).toBeNull();
  });
});
