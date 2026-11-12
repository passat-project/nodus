// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import {
  BOARD_COLUMN_CLASS,
  BOARD_COLUMN_MAX_CLASS,
  BOARD_COLUMN_MIN_CLASS,
} from '../../../shared/ui/board/board-metrics.js';
import { BoardColumn } from '../../../shared/ui/board/board-column.js';
import { TaskStageCreate } from './task-stage-create.js';

/**
 * «Добавить стадию» — ПОЛНОЦЕННАЯ плитка доски (уточнение владельца
 * 10.11.2026): та же ширина и высота, что у колонок стадий, содержимое по
 * центру. Она делит ряд с колонками: шестая плитка — «Добавить стадию»,
 * поэтому на опорном Full HD при 5 стадиях ряд заполнен ровно (#824).
 */
afterEach(cleanup);

describe('TaskStageCreate — плитка в ряду колонок (#730)', () => {
  it('закрытая плитка: общий класс колонки, полная высота, ширина из полосы', () => {
    const { container } = render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.tagName).toBe('BUTTON');
    expect(tile.className).toContain(BOARD_COLUMN_CLASS);
    expect(tile.className).toContain('h-full');
    expect(tile.className).toContain('outline-dashed');
    // Ширина — из общего класса метрик (полоса 240–360, #824), своей нет.
    expect(tile.className).toContain(BOARD_COLUMN_MIN_CLASS);
    expect(tile.className).toContain(BOARD_COLUMN_MAX_CLASS);
    expect(tile.className).not.toMatch(/(?:^|\s)w-\[/);
    expect(screen.getByRole('button', { name: ui.tasks.addStage })).toBe(tile);
  });

  it('плитка не несёт своих padding/border — отступы и контур живут внутри', () => {
    const { container } = render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    const tile = container.firstElementChild as HTMLElement;
    // Плитка — только общий класс метрик: отступы и пунктир не отнимают
    // ширину у содержимого (контур — outline, не в раскладке).
    expect(tile.className).not.toMatch(/(?:^|\s)(?:px|py|p|pt|pb|pl|pr)-/);
    expect(tile.className).not.toMatch(/(?:^|\s)border(?:-|$)/);
  });

  it('подпись не задаёт минимальную ширину плитки', () => {
    render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    const label = screen.getByText(ui.tasks.addStage);
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('truncate');
    expect(label.className).not.toMatch(/(?:^|\s)w-(?:\d|\[)/);
  });

  it('ширина плитки — ровно как у колонки стадии (тот же класс метрик)', () => {
    const column = render(
      <DndContext>
        <BoardColumn
          stage={{ id: 's1', name: 'Новые', color: 'neutral' }}
          count={0}
          cardIds={[]}
          hasNext={false}
          loadingMore={false}
          onLoadMore={() => undefined}
          emptyLabel="Нет задач"
          dropLabel="Отпустите здесь"
        >
          {null}
        </BoardColumn>
      </DndContext>,
    );
    const section = column.container.querySelector('section')!;
    cleanup();

    const tile = render(<TaskStageCreate creating={false} onCreate={vi.fn()} />).container
      .firstElementChild as HTMLElement;
    // Обе плитки одной полосы ширины (#824): 6 плиток на Full HD, 8 на 2560.
    for (const cls of [BOARD_COLUMN_MIN_CLASS, BOARD_COLUMN_MAX_CLASS, 'flex-1']) {
      expect(section.className).toContain(cls);
      expect(tile.className).toContain(cls);
    }
  });

  it('раскрытая форма живёт в той же плитке и создаёт колонку по Enter', () => {
    const onCreate = vi.fn();
    const { container } = render(<TaskStageCreate creating={false} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: ui.tasks.addStage }));

    const form = container.firstElementChild as HTMLElement;
    expect(form.className).toContain(BOARD_COLUMN_CLASS);
    expect(form.className).toContain('h-full');
    // Раскрытая форма — та же плитка: своих padding/border нет (см. тест выше),
    // отступы и палитра живут во внутреннем блоке.
    expect(form.className).not.toMatch(/(?:^|\s)(?:px|py|p|pt|pb|pl|pr)-/);
    expect(form.className).not.toMatch(/(?:^|\s)border(?:-|$)/);

    const input = screen.getByPlaceholderText(ui.tasks.stageNamePlaceholder);
    fireEvent.change(input, { target: { value: 'Согласование' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Согласование',
      color: 'neutral',
      systemState: 'active',
    });
  });

  it('Esc возвращает плитку «Добавить стадию»', () => {
    render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: ui.tasks.addStage }));
    fireEvent.keyDown(screen.getByPlaceholderText(ui.tasks.stageNamePlaceholder), {
      key: 'Escape',
    });
    expect(screen.getByRole('button', { name: ui.tasks.addStage })).toBeTruthy();
  });
});

/**
 * Явные кнопки в раскрытой плите (#730, замечание владельца 12.11.2026):
 * создать/отмена видны мышью, а не только Enter/Esc. Кнопка создания ждёт
 * названия, обе — из i18n, строка «поле + кнопки» не переносится.
 */
describe('TaskStageCreate — кнопки «создать» и «отмена» (#730)', () => {
  const openForm = () => fireEvent.click(screen.getByRole('button', { name: ui.tasks.addStage }));
  const nameInput = () => screen.getByPlaceholderText(ui.tasks.stageNamePlaceholder);
  const createButton = () =>
    screen.getByRole('button', { name: ui.tasks.createStage }) as HTMLButtonElement;

  it('кнопка «создать» названа из i18n и ждёт непустого названия', () => {
    render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    openForm();

    expect(createButton().getAttribute('title')).toBe(ui.tasks.createStage);
    expect(createButton().disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect(createButton().disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: 'Согласование' } });
    expect(createButton().disabled).toBe(false);
  });

  it('клик по «создать» отправляет те же данные, что Enter, и схлопывает плитку', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<TaskStageCreate creating={false} onCreate={onCreate} />);
    openForm();

    fireEvent.change(nameInput(), { target: { value: 'Согласование' } });
    fireEvent.click(screen.getByRole('button', { name: ui.tasks.stageColors.info }));
    fireEvent.click(createButton());

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Согласование',
      color: 'info',
      systemState: 'active',
    });
    // Успех — плитка вернулась к «Добавить стадию».
    await screen.findByRole('button', { name: ui.tasks.addStage });
  });

  it('«отмена» возвращает плитку и очищает ввод', () => {
    render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    openForm();

    fireEvent.change(nameInput(), { target: { value: 'Черновик' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));

    expect(screen.getByRole('button', { name: ui.tasks.addStage })).toBeTruthy();
    openForm();
    expect((nameInput() as HTMLInputElement).value).toBe('');
  });

  it('отказ сервера: форма открыта, ввод не потерян', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));
    render(<TaskStageCreate creating={false} onCreate={onCreate} />);
    openForm();

    fireEvent.change(nameInput(), { target: { value: 'Согласование' } });
    fireEvent.click(createButton());

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect((nameInput() as HTMLInputElement).value).toBe('Согласование');
    expect(screen.queryByRole('button', { name: ui.tasks.addStage })).toBeNull();
  });

  it('строка «поле + кнопки» не переносится: поле сжимается, кнопки size-7 shrink-0', () => {
    render(<TaskStageCreate creating={false} onCreate={vi.fn()} />);
    openForm();

    const input = nameInput();
    expect(input.className).toContain('min-w-0');
    expect(input.className).toContain('flex-1');
    // Одна строка даже в узкой плитке (~165px): переноса нет, кнопки на месте.
    expect(input.parentElement!.className).not.toContain('flex-wrap');
    for (const button of [createButton(), screen.getByRole('button', { name: ui.common.cancel })]) {
      expect(button.className).toContain('size-7');
      expect(button.className).toContain('shrink-0');
    }
  });
});
