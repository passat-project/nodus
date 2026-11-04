// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@nodus/contracts';

import { TaskCardDataPanel } from './task-card-data-panel.js';

vi.mock('./task-description.js', () => ({ TaskDescription: () => <div>описание</div> }));
vi.mock('./task-fields.js', () => ({ TaskFields: () => <div>поля</div> }));
vi.mock('./task-custom-fields.js', () => ({ TaskCustomFields: () => <div>атрибуты</div> }));
vi.mock('./task-checklist.js', () => ({ TaskChecklist: () => <div>чек-лист</div> }));
vi.mock('./task-subtasks.js', () => ({ TaskSubtasks: () => <div>подзадачи</div> }));
vi.mock('./task-result.js', () => ({ TaskResultSection: () => <div>результат</div> }));
vi.mock('./task-stage-controls.js', () => ({ TaskActionBar: () => <div>бар</div> }));

const task = { id: 'task-1' } as unknown as TaskDetail;
const layout = {
  blockVisible: () => true,
  isRequired: () => false,
  roleLabel: (key: string) => key,
};

afterEach(cleanup);

describe('левая панель данных задачи', () => {
  it('рисует данные и кнопку ветки в фиксированном отступе', () => {
    const onToggleBranch = vi.fn();
    render(
      <TaskCardDataPanel
        task={task}
        layout={layout}
        onOpenSubtask={vi.fn()}
        showBranch
        branchOpen={false}
        onToggleBranch={onToggleBranch}
      />,
    );
    expect(screen.getByText('описание')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ветка задачи' }));
    expect(onToggleBranch).toHaveBeenCalledTimes(1);
  });
});
