// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { DeadlineChip } from './deadline-chip.js';

/** Просрочка — цвет и скрытое слово: зрячий видит красный чип, скринридер —
 *  «просрочена». Видимого текста «Просрочена» в чипе быть не должно (#734). */
describe('DeadlineChip (#734)', () => {
  afterEach(() => cleanup());

  it('просроченный срок: слово только в sr-only, видимого текста нет', () => {
    const { container } = render(
      <DeadlineChip deadline="2020-01-15T10:00:00.000Z" state="active" />,
    );

    const hidden = container.querySelector('.sr-only');
    expect(hidden?.textContent).toContain(ui.tasks.overdue);
    expect(container.textContent?.replace(hidden?.textContent ?? '', '')).not.toContain(
      ui.tasks.overdue,
    );
    expect(container.firstElementChild?.className).toContain('bg-danger-soft');
  });

  it('закрытая задача: срок нейтрален, слова «просрочена» нет', () => {
    const { container } = render(<DeadlineChip deadline="2020-01-15T10:00:00.000Z" state="done" />);

    expect(container.querySelector('.sr-only')).toBeNull();
    expect(container.textContent).not.toContain(ui.tasks.overdue);
    expect(container.firstElementChild?.className).toContain('bg-muted');
  });

  /** Плотный режим (#730): карточка канбана узкая — дата короткая, у
   *  нейтрального/просроченного срока нет плашки у нейтрального, а без срока
   *  чип не рисуется вовсе (мета-строку не удлиняет). */
  it('compact: короткая дата и ничего без срока', () => {
    const { container, rerender } = render(
      <DeadlineChip compact deadline="2026-11-12T14:00:00.000Z" state="active" />,
    );
    expect(container.textContent).toContain('12.11');
    expect(container.textContent).not.toContain('ноября');

    rerender(<DeadlineChip compact deadline={null} state="active" />);
    expect(container.textContent).toBe('');
  });
});
