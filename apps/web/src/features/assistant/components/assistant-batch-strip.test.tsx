// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AssistantMessage } from '@nodus/contracts';

import { AssistantBatchStrip, findOpenBatch } from './assistant-batch-strip.js';

/**
 * Липкая строка пачки (#916): пока часть карточек ждёт решения, над
 * композером видно «Решено N из M» с возвратом к карточкам и «Продолжить
 * сейчас». Пока агент отвечает — строки нет; после продолжения пачка
 * закрыта и строка исчезает.
 */

const strings = ui.assistant;

const mutate = vi.hoisted(() => vi.fn());
const mutationState = vi.hoisted(() => ({ isPending: false }));

vi.mock('../api/assistant-actions-api.js', () => ({
  useContinueAssistantBatch: () => ({
    mutate,
    isPending: mutationState.isPending,
  }),
}));

let seq = 0;

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    role: 'assistant',
    text: 'Готово',
    reasoning: null,
    createdAt: '2026-11-17T09:00:00.000Z',
    runId: null,
    streaming: false,
    errorCode: null,
    toolCalls: [],
    actions: [],
    actionBatch: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mutate.mockReset();
  mutationState.isPending = false;
});

describe('findOpenBatch', () => {
  it('берёт самую свежую открытую пачку, в т.ч. когда все карточки решены', () => {
    const older = message({
      actionBatch: { state: 'open', total: 2, decided: 1, pending: 1 },
    });
    const closed = message({
      actionBatch: { state: 'continued', total: 2, decided: 2, pending: 0 },
    });
    const pendingNone = message({
      actionBatch: { state: 'open', total: 2, decided: 2, pending: 0 },
    });
    // Решения пришли, пока агент печатал: пачка открыта, pending = 0 —
    // строка «Продолжить сейчас» остаётся запасным путём (#916).
    expect(findOpenBatch([older, closed, pendingNone])?.id).toBe(pendingNone.id);
    expect(findOpenBatch([older])?.id).toBe(older.id);
    expect(findOpenBatch([closed])).toBeNull();
    expect(findOpenBatch([])).toBeNull();
  });
});

describe('AssistantBatchStrip', () => {
  it('показывает прогресс и обе команды пачки', () => {
    render(
      <AssistantBatchStrip
        messages={[message({ actionBatch: { state: 'open', total: 3, decided: 1, pending: 2 } })]}
        sessionId="s-1"
        busy={false}
      />,
    );
    expect(
      screen.getByText(new RegExp(`${strings.batchProgress} 1 ${strings.batchOf} 3`)),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.batchToCards })).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.batchContinue })).toBeTruthy();
  });

  it('«Продолжить сейчас» шлёт id сообщения пачки', () => {
    const target = message({
      actionBatch: { state: 'open', total: 2, decided: 1, pending: 1 },
    });
    render(<AssistantBatchStrip messages={[target]} sessionId="s-1" busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: strings.batchContinue }));
    expect(mutate).toHaveBeenCalledWith(target.id, expect.any(Object));
  });

  it('все карточки решены, пачка открыта — «Продолжить сейчас» доступно', () => {
    const target = message({
      actionBatch: { state: 'open', total: 2, decided: 2, pending: 0 },
    });
    render(<AssistantBatchStrip messages={[target]} sessionId="s-1" busy={false} />);
    expect(screen.getByText(new RegExp(strings.batchAllDone))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: strings.batchContinue }));
    expect(mutate).toHaveBeenCalledWith(target.id, expect.any(Object));
  });

  it('пока агент отвечает или пачки нет — строки нет', () => {
    const target = message({
      actionBatch: { state: 'open', total: 2, decided: 1, pending: 1 },
    });
    const busy = render(<AssistantBatchStrip messages={[target]} sessionId="s-1" busy />);
    expect(busy.container.textContent).toBe('');
    busy.unmount();

    const idle = render(
      <AssistantBatchStrip messages={[message()]} sessionId="s-1" busy={false} />,
    );
    expect(idle.container.textContent).toBe('');
  });

  it('ошибка продолжения видна в строке, пачка остаётся', () => {
    mutate.mockImplementation((_id: string, options: { onError: () => void }) => options.onError());
    render(
      <AssistantBatchStrip
        messages={[message({ actionBatch: { state: 'open', total: 2, decided: 1, pending: 1 } })]}
        sessionId="s-1"
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: strings.batchContinue }));
    expect(screen.getByText(new RegExp(strings.batchContinueError))).toBeTruthy();
  });
});
