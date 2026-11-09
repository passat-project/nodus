// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskFieldLock } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';

import { fieldLockedText, LockReasonDialog, TaskLockBadge, useFieldLock } from './field-lock-ui.js';

/** Замок записи в карточке (#496, Р10): тост отказа, значок с источником и
 *  следом правки, окно причины и решение «спрашивать причину или нет». */

const l = ui.forms.locks;

function lock(overrides: Partial<TaskFieldLock> = {}): TaskFieldLock {
  return {
    key: 'description',
    editors: 'none',
    lockedAt: '2026-11-08T10:00:00.000Z',
    lockedBy: {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'Петров',
      avatarUrl: null,
    },
    source: { kind: 'creation' },
    canEdit: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('fieldLockedText: тост отказа замка', () => {
  it('не ошибка API или чужой код — не наш тост', () => {
    expect(fieldLockedText(new Error('boom'))).toBeNull();
    expect(fieldLockedText(new ApiError(ErrorCode.NOT_FOUND, 'nope', 404))).toBeNull();
  });

  it('причина отказа из details — свой текст, без details — общий', () => {
    expect(
      fieldLockedText(
        new ApiError(ErrorCode.FIELD_LOCKED, 'locked', 422, { reason: 'owners_only' }),
      ),
    ).toBe(l.denied.owners_only);
    expect(
      fieldLockedText(
        new ApiError(ErrorCode.FIELD_LOCKED, 'locked', 422, { reason: 'reason_required' }),
      ),
    ).toBe(l.denied.reason_required);
    expect(fieldLockedText(new ApiError(ErrorCode.FIELD_LOCKED, 'locked', 422))).toBe(
      l.denied.locked,
    );
  });
});

describe('TaskLockBadge: значок и поповер', () => {
  it('замок создания: источник, «никто», кто закрепил', () => {
    render(<TaskLockBadge lock={lock()} />);

    fireEvent.click(screen.getByRole('button', { name: l.badge }));

    expect(screen.getByText(l.lockedAfterCreation)).toBeTruthy();
    expect(screen.getByText(l.editorsNone)).toBeTruthy();
    expect(screen.getByText(new RegExp(l.lockedBy))).toBeTruthy();
    expect(screen.queryByText(l.canEditHint)).toBeNull();
  });

  it('замок кнопки с последней правкой: имя кнопки, правило и след с причиной', () => {
    render(
      <TaskLockBadge
        lock={lock({
          editors: 'owners',
          source: {
            kind: 'transition',
            transitionId: '22222222-2222-4222-8222-222222222222',
            name: 'Выдать в печать',
          },
          canEdit: true,
          lastChange: {
            at: '2026-11-09T08:30:00.000Z',
            by: {
              id: '33333333-3333-4333-8333-333333333333',
              displayName: 'Сидоров',
              avatarUrl: null,
            },
            reason: 'Заказчик перенёс срок письмом',
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: l.badge }));

    expect(screen.getByText(l.lockedAfter('Выдать в печать'))).toBeTruthy();
    expect(screen.getByText(l.editorsOwners)).toBeTruthy();
    expect(screen.getByText(l.lastChange)).toBeTruthy();
    expect(screen.getByText(/Сидоров/)).toBeTruthy();
    expect(screen.getByText('Заказчик перенёс срок письмом')).toBeTruthy();
    expect(screen.getByText(l.canEditHint)).toBeTruthy();
  });

  it('без «кто закрепил» строки нет', () => {
    render(<TaskLockBadge lock={lock({ lockedBy: null })} />);

    fireEvent.click(screen.getByRole('button', { name: l.badge }));

    expect(screen.queryByText(new RegExp(l.lockedBy))).toBeNull();
  });
});

describe('LockReasonDialog: причина изменения', () => {
  it('короткая причина — подсказка и «Изменить» выключено; валидная — обрезается', () => {
    const confirm = vi.fn();
    render(<LockReasonDialog open onCancel={vi.fn()} onConfirm={confirm} />);

    fireEvent.change(screen.getByRole('textbox', { name: l.reasonTitle }), {
      target: { value: 'ок' },
    });
    expect(screen.getByText(l.reasonShort)).toBeTruthy();
    expect(screen.getByRole('button', { name: l.reasonSave }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: l.reasonTitle }), {
      target: { value: '  перенос письмом  ' },
    });
    expect(screen.queryByText(l.reasonShort)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: l.reasonSave }));
    expect(confirm).toHaveBeenCalledWith('перенос письмом');
  });

  it('«Отмена» и переоткрытие окна: причина очищается', () => {
    const cancel = vi.fn();
    const { rerender } = render(<LockReasonDialog open onCancel={cancel} onConfirm={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: l.reasonTitle }), {
      target: { value: 'причина' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(cancel).toHaveBeenCalled();

    rerender(<LockReasonDialog open={false} onCancel={cancel} onConfirm={vi.fn()} />);
    rerender(<LockReasonDialog open onCancel={cancel} onConfirm={vi.fn()} />);
    expect(
      (screen.getByRole('textbox', { name: l.reasonTitle }) as HTMLTextAreaElement).value,
    ).toBe('');
  });
});

/** Подопытный компонент: фиксирует, что и с какой причиной запросили. */
function LockProbe({
  lockValue,
  onAction,
}: {
  lockValue?: TaskFieldLock;
  onAction: (reason?: string) => void;
}) {
  const field = useFieldLock(lockValue);
  return (
    <>
      <span>{field.editable ? 'editable' : 'readonly'}</span>
      <button type="button" onClick={() => field.request((reason) => onAction(reason))}>
        change
      </button>
      {field.dialog}
    </>
  );
}

describe('useFieldLock: причина — только когда правило замка разрешает', () => {
  it('без замка действие идёт сразу и причина не спрашивается', () => {
    const action = vi.fn();
    render(<LockProbe onAction={action} />);

    expect(screen.getByText('editable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0]![0]).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('замок без canEdit — только чтение, причина не спрашивается', () => {
    const action = vi.fn();
    render(<LockProbe lockValue={lock()} onAction={action} />);

    expect(screen.getByText('readonly')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0]![0]).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('canEdit: причина спрашивается; отмена — без действия, ввод — с причиной', () => {
    const action = vi.fn();
    render(<LockProbe lockValue={lock({ canEdit: true })} onAction={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    fireEvent.change(screen.getByRole('textbox', { name: l.reasonTitle }), {
      target: { value: 'по звонку' },
    });
    fireEvent.click(screen.getByRole('button', { name: l.reasonSave }));
    expect(action).toHaveBeenCalledWith('по звонку');
  });
});
