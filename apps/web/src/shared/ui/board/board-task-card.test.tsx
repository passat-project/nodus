// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TaskListItem } from '@nodus/contracts';

import { BoardTaskCard } from './board-task-card.js';

const task = {
  id: 't1',
  number: 1,
  title: 'Задача',
  source: 'manual',
  deadline: null,
  project: null,
  assignee: null,
  commentsCount: 0,
  spentMinutes: 0,
  type: {
    id: 'type',
    code: 'task',
    name: 'Стандартный',
    category: 'task',
    icon: 'square-check',
    color: 'info',
  },
  stage: { systemState: 'backlog' },
} as unknown as TaskListItem;

describe('BoardTaskCard type field (#403)', () => {
  afterEach(cleanup);

  it('показывает значок типа, когда поле включено', () => {
    render(<BoardTaskCard task={task} isVisible={(id) => id === 'type'} onOpen={() => void 0} />);
    expect(screen.getByLabelText('Стандартный')).toBeTruthy();
  });

  it('скрывает значок типа, когда поле выключено', () => {
    render(<BoardTaskCard task={task} isVisible={() => false} onOpen={() => void 0} />);
    expect(screen.queryByLabelText('Стандартный')).toBeNull();
  });
});
