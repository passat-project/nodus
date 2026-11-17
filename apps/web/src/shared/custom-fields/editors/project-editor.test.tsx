// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const projects = vi.hoisted(() => ({
  available: true,
  list: [
    { id: 'p-1', name: 'Тендер УП', code: '2026-1', color: 'blue' },
    { id: 'p-2', name: 'Офис', code: '2026-2', color: 'green' },
  ],
}));

vi.mock('../../api/projects-available.js', () => ({
  projectsAvailable: () => projects.available,
}));
vi.mock('../../api/projects-list.js', () => ({
  useProjectsList: () => ({ data: { items: projects.list } }),
}));

import { ProjectEditor } from './project-editor.js';

const definition = {
  id: 'f-project',
  type: 'project',
  name: 'Проект',
} as CustomFieldDefinition;

afterEach(() => {
  cleanup();
  projects.available = true;
});

/** Пикер проекта (#843): программное закрытие после выбора не идёт через
 *  onOpenChange — поиск не должен переезжать в следующее открытие. */
describe('ProjectEditor: сброс поиска при выборе', () => {
  it('после выбора проекта следующий показ начинается с полного списка', () => {
    render(
      <ProjectEditor
        definition={definition}
        value={undefined}
        refs={[]}
        disabled={false}
        variant="inline"
        onCommit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Проект' }));
    fireEvent.change(screen.getByLabelText(ui.common.search), {
      target: { value: 'Офис' },
    });
    expect(screen.queryByText('Тендер УП')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Офис/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Проект' }));

    expect((screen.getByLabelText(ui.common.search) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Тендер УП')).toBeTruthy();
  });
});
