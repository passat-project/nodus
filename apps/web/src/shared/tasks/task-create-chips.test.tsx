// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskCreateChips } from './task-create-chips.js';
import { emptyDraft, type TaskCreateDraft } from './task-create-draft.js';

/**
 * #963: неверное «Планируемое время» не стирается молча — поле остаётся
 * с сообщением и aria-invalid; валидные формы принимаются.
 */
afterEach(cleanup);

function openPlanned() {
  const onChange = vi.fn<(draft: TaskCreateDraft) => void>();
  render(
    <TaskCreateChips
      chips={['planned']}
      draft={emptyDraft()}
      onChange={onChange}
      onOpenChecklist={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Планируемое время/i }));
  const input = screen.getByLabelText(/Плановое время/i) as HTMLInputElement;
  return { onChange, input };
}

describe('TaskCreateChips: планируемое время (#963)', () => {
  it('неверный ввод не принимается и не стирается: остаётся с сообщением', () => {
    const { onChange, input } = openPlanned();

    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('abc');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Введите время');
  });

  it('валидная длительность принимается («1:30» = 90 минут)', () => {
    const { onChange, input } = openPlanned();

    fireEvent.change(input, { target: { value: '1:30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.plannedMinutes).toBe(90);
  });

  it('пустое поле сбрасывает значение', () => {
    const { onChange, input } = openPlanned();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.plannedMinutes).toBeNull();
  });

  it('Esc закрывает поле без сохранения', () => {
    const { onChange, input } = openPlanned();

    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Плановое время/i)).toBeNull();
  });
});
