// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AssistantActionBatch } from '@nodus/contracts';

import { AssistantActionBatchBar } from './assistant-action-batch.js';

/**
 * Полоса пачки карточек (#916): терминальные подписи не врут о состоянии.
 * «Продолжаю…» навсегда было бы ложью после завершения прогона, а «Все
 * карточки решены» — ложью для пачки, закрытой «Продолжить сейчас» с
 * ожидающими решениями (security/logic-ревью 18.11.2026).
 */

const strings = ui.assistant;

const mutate = vi.hoisted(() => vi.fn());

vi.mock('../api/assistant-actions-api.js', () => ({
  useAssistantBatchDecision: () => ({ mutate, isPending: false }),
}));

function batch(overrides: Partial<AssistantActionBatch> = {}): AssistantActionBatch {
  return { state: 'open', total: 2, decided: 1, pending: 1, ...overrides };
}

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderBar(value: AssistantActionBatch) {
  render(<AssistantActionBatchBar messageId="m-1" batch={value} sessionId="s-1" />);
}

describe('AssistantActionBatchBar: терминальные подписи (#916)', () => {
  it('открытая пачка — кнопки «Выполнить все» и «Отменить все»', () => {
    renderBar(batch());
    expect(screen.getByRole('button', { name: strings.batchExecuteAll })).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.batchCancelAll })).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`${strings.batchProgress} 1 ${strings.batchOf} 2`)),
    ).toBeTruthy();
  });

  it('continued — «Продолжение запущено», а не вечное «Продолжаю…»', () => {
    renderBar(batch({ state: 'continued', decided: 2, pending: 0 }));
    expect(screen.getByText(strings.batchContinued)).toBeTruthy();
    expect(screen.queryByText(strings.batchWaiting)).toBeNull();
  });

  it('closed с ожидающими карточками — «Пачка закрыта · N ждут решения»', () => {
    renderBar(batch({ state: 'closed', decided: 1, pending: 1 }));
    expect(
      screen.getByText(`${strings.batchClosed} · 1 ${strings.batchStillPending}`),
    ).toBeTruthy();
    expect(screen.queryByText(strings.batchAllDone)).toBeNull();
  });

  it('closed без ожидающих — «Все карточки решены»', () => {
    renderBar(batch({ state: 'closed', decided: 2, pending: 0 }));
    expect(screen.getByText(strings.batchAllDone)).toBeTruthy();
  });

  it('одиночная карточка полосу не получает', () => {
    const { container } = render(
      <AssistantActionBatchBar
        messageId="m-1"
        batch={batch({ total: 1, decided: 0, pending: 1 })}
        sessionId="s-1"
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('нет серверной пачки (байпас/история) — полосы нет', () => {
    const { container } = render(
      <AssistantActionBatchBar messageId="m-1" batch={null} sessionId="s-1" />,
    );
    expect(container.textContent).toBe('');
  });

  it('ошибка решения видна сотруднику, а не теряется молча', () => {
    mutate.mockImplementation((_id: string, options?: { onError?: () => void }) => {
      options?.onError?.();
    });
    renderBar(batch());
    fireEvent.click(screen.getByRole('button', { name: strings.batchExecuteAll }));
    expect(screen.getByText(new RegExp(strings.batchActionError))).toBeTruthy();
  });
});
