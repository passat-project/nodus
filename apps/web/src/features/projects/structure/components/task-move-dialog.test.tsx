// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { TaskMoveDialog } from './task-move-dialog.js';

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

function node(id: string, parentId: string | null, name: string): ProjectNode {
  return {
    id,
    parentId,
    kindId: '44000000-0000-4000-8000-000000000004',
    name,
    code: null,
    customFields: {},
    rollup: ZERO_ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const BUILDING = node(
  '43000000-0000-4000-8000-000000000001',
  null,
  'Здание 2 по генеральному плану — корпус Б, секция 3, этапы 1–4 (сети и слаботочка)',
);
const SECTION = node('43000000-0000-4000-8000-000000000002', BUILDING.id, 'Раздел АР');

describe('TaskMoveDialog: цель переноса и её подпись (A9-6)', () => {
  afterEach(cleanup);

  it('по умолчанию «Без папки»: подпись в контроле и в подсказке, а не пустой триггер', () => {
    render(
      <TaskMoveDialog count={2} nodes={[BUILDING, SECTION]} onPick={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText(ui.structure.moveTasksNoNode)).toBeTruthy();
    expect(screen.getByRole('combobox').getAttribute('title')).toBe(ui.structure.moveTasksNoNode);
  });

  it('длинное имя папки не режется одной строкой: контрол держит две с переносом', () => {
    render(<TaskMoveDialog count={1} nodes={[BUILDING]} onPick={vi.fn()} onClose={vi.fn()} />);

    // Подпись цели — две строки с переносом (`line-clamp-2`), без `truncate`:
    // «Здание 2 по ген…» не отвечает на вопрос, куда переносим задачу.
    const label = screen.getByText(ui.structure.moveTasksNoNode);
    expect(label.className).toContain('line-clamp-2');
    expect(label.className).not.toContain('truncate');
    expect(screen.getByRole('combobox').className).toContain('whitespace-normal');
  });

  it('«Переместить» без смены цели отдаёт null — задача уходит из структуры', () => {
    const onPick = vi.fn();
    render(<TaskMoveDialog count={1} nodes={[BUILDING]} onPick={onPick} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    expect(onPick).toHaveBeenCalledWith(null);
  });
});
