// @vitest-environment jsdom
import type { LetterDetail } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReceiptMethodValue } from './letter-field-editors.js';

/** Меню «Способ поступления» (#599): выбор сохраняется, а уход указателя в
 *  соседнее поле не возвращает фокус на триггер — иначе возврат фокуса после
 *  анимации закрытия гасит инлайн-редактор темы пустым blur-commit. */
vi.mock('../../api/letters-queries.js', () => ({
  useReceiptMethods: () => ({
    data: [
      { id: 'method-mail', name: 'Почта', isActive: true },
      { id: 'method-courier', name: 'Курьер', isActive: true },
    ],
  }),
}));

const letter = { receiptMethod: null } as unknown as LetterDetail;
const triggerName = 'Изменить: Способ поступления';

afterEach(cleanup);

function renderValue(props: Partial<Parameters<typeof ReceiptMethodValue>[0]> = {}) {
  const onCommit = vi.fn();
  render(<ReceiptMethodValue letter={letter} editable onCommit={onCommit} {...props} />);
  return { onCommit };
}

async function openMenu() {
  const trigger = screen.getByRole('button', { name: triggerName });
  // Radix открывает меню по pointerdown левой кнопкой.
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  await screen.findByRole('menuitem', { name: 'Почта' });
  return trigger;
}

describe('ReceiptMethodValue (#599)', () => {
  it('выбор способа поступления сохраняется', async () => {
    const { onCommit } = renderValue();
    await openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Почта' }));

    expect(onCommit).toHaveBeenCalledWith({ id: 'method-mail', name: 'Почта' });
  });

  it('уход указателя из меню не возвращает фокус на триггер', async () => {
    renderValue();
    const trigger = await openMenu();

    // Пользователь уже кликнул в другое поле: меню закрывается кликом снаружи,
    // гард не даёт вернуть фокус на триггер после анимации закрытия.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());

    expect(document.activeElement).not.toBe(trigger);
  });

  it('без права правки — значение без меню', () => {
    renderValue({ editable: false });

    expect(screen.queryByRole('button', { name: triggerName })).toBeNull();
    expect(screen.getByText('Не задано')).toBeTruthy();
  });
});
