// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColumnResizer } from './column-resizer.js';

/** Ручка ширины колонки (#843): pointercancel завершает drag, как pointerup —
 *  иначе колонка продолжает тянуться за курсором после отмены жеста. */

afterEach(cleanup);

describe('ColumnResizer: pointercancel', () => {
  it('отменяет ресайз и снимает слушатели', () => {
    const onResize = vi.fn();
    render(<ColumnResizer width={200} minWidth={80} onResize={onResize} />);
    const handle = screen.getByRole('separator');

    fireEvent.pointerDown(handle, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 250 });
    expect(onResize).toHaveBeenLastCalledWith(250);

    fireEvent.pointerCancel(window);
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
