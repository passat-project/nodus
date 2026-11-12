// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import type { PortfolioFolder } from '../lib/portfolio-folders.js';
import { PortfolioArchiveDialog, PortfolioRenameDialog } from './portfolio-dialogs.js';

/** Окна портфеля-папки журнала (#559): переименование и архив. Окна —
 *  лёгкие действия колонки, поэтому проверяем черновик имени, блокировку
 *  пустого/того же имени и намеренную отмену. */
const FOLDER: PortfolioFolder = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  portfolioId: '42000000-0000-4000-8000-000000000001',
  counters: { active: 98, completed: 2, archived: 0 },
  archived: false,
};

afterEach(cleanup);

describe('PortfolioRenameDialog (#559)', () => {
  it('закрыт без папки — окна нет', () => {
    render(<PortfolioRenameDialog folder={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('поле заполнено текущим именем; сохранение зовёт onConfirm с новым', () => {
    const onConfirm = vi.fn();
    render(<PortfolioRenameDialog folder={FOLDER} onCancel={vi.fn()} onConfirm={onConfirm} />);

    const input = screen.getByRole('textbox', { name: ui.projects.fieldName }) as HTMLInputElement;
    expect(input.value).toBe(FOLDER.name);
    // Тот же текст — сохранять нечего, кнопка заблокирована.
    const save = screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  Нежин-Недра 2  ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(onConfirm).toHaveBeenCalledWith('Нежин-Недра 2');
  });

  it('пустое имя не сохраняется, «Отмена» закрывает окно', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<PortfolioRenameDialog folder={FOLDER} onCancel={onCancel} onConfirm={onConfirm} />);

    const input = screen.getByRole('textbox', { name: ui.projects.fieldName });
    fireEvent.change(input, { target: { value: '   ' } });
    const save = screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc закрывает окно так же, как «Отмена»', () => {
    const onCancel = vi.fn();
    render(<PortfolioRenameDialog folder={FOLDER} onCancel={onCancel} onConfirm={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('PortfolioArchiveDialog (#559)', () => {
  it('закрыт без папки — окна нет', () => {
    render(<PortfolioArchiveDialog folder={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('показывает последствия и имя папки; подтверждение архивирует', () => {
    const onConfirm = vi.fn();
    render(<PortfolioArchiveDialog folder={FOLDER} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText(ui.projects.portfolioArchiveConfirmTitle)).toBeTruthy();
    expect(screen.getByText(ui.projects.portfolioArchiveConfirmBody)).toBeTruthy();
    expect(screen.getByText(FOLDER.name)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.projects.portfolioArchive }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('«Отмена» — архива нет', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<PortfolioArchiveDialog folder={FOLDER} onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc закрывает окно архива', () => {
    const onCancel = vi.fn();
    render(<PortfolioArchiveDialog folder={FOLDER} onCancel={onCancel} onConfirm={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
