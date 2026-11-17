// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  removeMutate: vi.fn(),
  memory: {
    data: {
      items: [
        {
          id: 'm-1',
          text: 'Отчёты — по пятницам',
          createdAt: '2026-11-27T10:00:00.000Z',
          updatedAt: '2026-11-27T10:00:00.000Z',
        },
      ],
      limit: 50,
    },
  },
}));

vi.mock('../api/assistant-actions-api.js', () => ({
  useAssistantMemory: () => h.memory,
  useDeleteAssistantMemory: () => ({ mutate: h.removeMutate }),
}));

import { AssistantMemoryPicker } from './assistant-memory-picker.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AssistantMemoryPicker: блокнот агента (#900)', () => {
  it('открывается иконкой, показывает записи и счётчик, удаляет по крестику', () => {
    render(<AssistantMemoryPicker />);
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.memoryTitle }));

    expect(screen.getByText('Отчёты — по пятницам')).toBeTruthy();
    expect(screen.getByText('1 из 50')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.memoryRemove }));
    expect(h.removeMutate).toHaveBeenCalledWith('m-1', expect.anything());
  });

  it('пустой блокнот — каноничное пустое состояние', () => {
    h.memory.data = { items: [], limit: 50 };
    render(<AssistantMemoryPicker />);
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.memoryTitle }));
    expect(screen.getByText(ui.assistant.memoryEmpty)).toBeTruthy();
  });
});
