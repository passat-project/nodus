// @vitest-environment jsdom
import type { ProjectSecretPreview } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectSecretPreviewBlock } from './project-secret-preview.js';

/** Предпросмотр перевода в секретный (#541): руководитель видит, кто
 *  останется участником, кто потеряет доступ, и подтверждает переход. */
const PREVIEW: ProjectSecretPreview = {
  willBecomeMembers: [
    {
      user: { id: 'u1', displayName: 'Иван Петров', avatarUrl: null },
      roles: ['assignee', 'decider'],
      taskCount: 3,
    },
  ],
  willLoseAccess: [
    {
      user: { id: 'u2', displayName: 'Ольга Сидорова', avatarUrl: null },
      kind: 'observer',
      taskCount: 2,
    },
    {
      user: { id: 'u3', displayName: 'Пётр Внешний', avatarUrl: null },
      kind: 'joined',
      taskCount: 0,
    },
  ],
};

afterEach(cleanup);

describe('ProjectSecretPreviewBlock (#541)', () => {
  it('показывает, кто останется участником и кто потеряет доступ', () => {
    render(
      <ProjectSecretPreviewBlock
        preview={PREVIEW}
        loading={false}
        error={false}
        confirmed={false}
        onConfirmChange={() => {}}
      />,
    );

    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText(/ответственный, ждёт решения/)).toBeTruthy();
    expect(screen.getByText(/Задач: 3/)).toBeTruthy();
    expect(screen.getByText('Ольга Сидорова')).toBeTruthy();
    expect(screen.getByText(/наблюдатель задачи/)).toBeTruthy();
    expect(screen.getByText('Пётр Внешний')).toBeTruthy();
    expect(screen.getByText(/вступил сам/)).toBeTruthy();
  });

  it('подтверждение переключения — управляемый чекбокс', () => {
    const onConfirmChange = vi.fn();
    render(
      <ProjectSecretPreviewBlock
        preview={PREVIEW}
        loading={false}
        error={false}
        confirmed={false}
        onConfirmChange={onConfirmChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onConfirmChange).toHaveBeenCalledWith(true);
  });

  it('пустой состав — честная подсказка; ошибка — сообщение', () => {
    const { rerender } = render(
      <ProjectSecretPreviewBlock
        preview={{ willBecomeMembers: [], willLoseAccess: [] }}
        loading={false}
        error={false}
        confirmed={false}
        onConfirmChange={() => {}}
      />,
    );
    expect(screen.getByText(/состав не изменится/)).toBeTruthy();

    rerender(
      <ProjectSecretPreviewBlock
        preview={undefined}
        loading={false}
        error
        confirmed={false}
        onConfirmChange={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
