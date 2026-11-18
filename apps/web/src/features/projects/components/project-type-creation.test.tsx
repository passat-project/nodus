// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { ProjectTypeCreationSection } from './project-type-creation.js';

vi.mock('../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));

const PROJECT_TYPE_ID = '11111111-1111-4111-8111-111111111111';

const projectType = {
  id: PROJECT_TYPE_ID,
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  form: { fields: [] },
  kindIds: null,
  archivedAt: null,
} as unknown as ProjectType;

function processType(patch: {
  id: string;
  name: string;
  category: 'task' | 'letter';
  excluded?: string[];
}): ProcessType {
  return {
    id: patch.id,
    code: patch.id,
    name: patch.name,
    category: patch.category,
    direction: patch.category === 'letter' ? 'incoming' : null,
    icon: 'file-text',
    color: 'info',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: '22222222-2222-4222-8222-222222222222',
    config: normalizeTypeConfig({
      creation: {
        excludedProjectTypeIds: patch.excluded ?? [],
        folderKindId: null,
        withoutProject: true,
      },
    }),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  } as ProcessType;
}

const TASK = processType({ id: 't1', name: 'Комплект', category: 'task' });
const LETTER = processType({
  id: 'l1',
  name: 'Входящее письмо',
  category: 'letter',
  excluded: [PROJECT_TYPE_ID],
});

function setup(
  canSetup = true,
  tasks: ProcessType[] = [TASK],
  letters: ProcessType[] = [LETTER],
  manage = true,
) {
  const mutate = vi.fn();
  vi.mocked(useCanManageWorkflows).mockReturnValue(manage);
  vi.mocked(useLiveProcessTypes).mockImplementation(
    (category) =>
      ({
        data: category === 'task' ? tasks : letters,
      }) as never,
  );
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(<ProjectTypeCreationSection type={projectType} canSetup={canSetup} />);
  return { mutate };
}

describe('«Типы задач и писем» (#665)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('показывает задачи и письма; выключение пишет исключение в настройку типа', () => {
    const { mutate } = setup();
    expect(screen.getByText('Комплект')).toBeTruthy();
    expect(screen.getByText('Входящее письмо')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: /Комплект/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: TASK.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [PROJECT_TYPE_ID] }),
    });
  });

  it('включение снимает исключение — та же связь с другой стороны', () => {
    const { mutate } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /Входящее письмо/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: LETTER.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('без права настройки тумблеры недоступны', () => {
    setup(false);
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
  });

  it('без права процессов — пояснение вместо 403', () => {
    setup(true, [TASK], [LETTER], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
  });

  it('пустые группы — спокойная подсказка', () => {
    setup(true, [], []);
    expect(screen.getAllByText(ui.automation.creationScope.empty).length).toBeGreaterThan(0);
  });

  it('снятие работы, привязанной к виду, — предупреждение', () => {
    const bound = {
      ...TASK,
      config: normalizeTypeConfig({
        creation: {
          excludedProjectTypeIds: [],
          folderKindId: '33333333-3333-4333-8333-333333333333',
          withoutProject: false,
        },
      }),
    } as ProcessType;
    setup(true, [bound]);
    fireEvent.click(screen.getByRole('switch', { name: /Комплект/ }));
    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      ui.automation.creationScope.unbindWarning,
    );
  });
});
