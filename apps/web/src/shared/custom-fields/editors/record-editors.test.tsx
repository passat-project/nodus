// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const projects = vi.hoisted(() => ({
  available: true,
  list: [{ id: 'p-1', name: 'Тендер УП', code: '2026-1' }],
  nodes: [{ id: 'n-1', name: 'Папка 1' }],
}));

vi.mock('../../api/projects-available.js', () => ({
  projectsAvailable: () => projects.available,
}));
vi.mock('../../api/projects-list.js', () => ({
  useProjectsList: () => ({ data: { items: projects.list } }),
}));
vi.mock('../../api/project-structure.js', () => ({
  useProjectStructure: (projectId: string | null) => ({
    data: projectId ? { nodes: projects.nodes } : undefined,
  }),
}));

import { NodeEditor } from './record-editors.js';

/**
 * Пикер ссылки «Папка» (#631, Р5; блокер #646): двухшаговый выбор
 * «проект → узел». Клик по проекту НЕ коммитит projectId как значение
 * папки — иначе сервер отвечает not_found и тип «Папка» нельзя поставить
 * нигде в интерфейсе.
 */
const definition = {
  id: 'f-node',
  number: 1,
  type: 'node',
  name: 'Папка',
  hint: null,
  settings: {},
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  companyValue: null,
  companyRefs: [],
  reportIndexed: false,
  isCompany: false,
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as CustomFieldDefinition;

function renderEditor(onCommit = vi.fn()) {
  render(
    <NodeEditor
      definition={definition}
      value={undefined}
      refs={[]}
      disabled={false}
      variant="form"
      onCommit={onCommit}
    />,
  );
  return onCommit;
}

describe('NodeEditor (#631, Р5)', () => {
  afterEach(() => {
    cleanup();
    projects.available = true;
  });

  it('проект → узел: проект открывает структуру, значение коммитит узел', async () => {
    const onCommit = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Папка' }));
    fireEvent.click(await screen.findByText('Тендер УП'));
    // Клик по проекту — шаг навигации, а не значение ссылки.
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText('Папка 1'));
    expect(onCommit).toHaveBeenCalledWith('n-1', [
      expect.objectContaining({ kind: 'node', id: 'n-1', name: 'Папка 1' }),
    ]);
  });

  it('модуль проектов выключен — редактор недоступен, значение не теряется', () => {
    projects.available = false;
    const onCommit = renderEditor();
    const trigger = screen.getByRole('button', { name: 'Папка' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
