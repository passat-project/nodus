// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';

vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));

import { WithoutProjectPage } from './without-project-page.js';

const TASK = (id: string, withoutProject: boolean): ProcessType =>
  ({
    id,
    code: id,
    name: 'Быстрая',
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: `wf-${id}`,
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
  }) as unknown as ProcessType;

function setup(tasks: ProcessType[], canManage = true) {
  const mutate = vi.fn();
  vi.mocked(useLiveProcessTypes).mockReturnValue({ data: tasks } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(<WithoutProjectPage canManage={canManage} />);
  return { mutate };
}

describe('страница «Без проекта» (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('тумблер шлёт useUpdateTypeCreation с правильным creation', () => {
    const { mutate } = setup([TASK('t1', true)]);
    expect(screen.getByRole('switch', { name: /Быстрая/ }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('включение возвращает withoutProject: true, не теряя прочие поля', () => {
    const { mutate } = setup([TASK('t2', false)]);
    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ withoutProject: true, folderKindId: null }),
    });
  });

  it('без workflow.manage — read-only с пояснением', () => {
    setup([TASK('t3', true)], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Быстрая/ })).toHaveProperty('disabled', true);
  });

  it('заголовок и пояснение деловым языком', () => {
    setup([TASK('t4', true)]);
    expect(screen.getByText(ui.automation.entry.noProjectTitle)).toBeTruthy();
    expect(screen.getByText(ui.automation.entry.noProjectHint)).toBeTruthy();
  });
});
