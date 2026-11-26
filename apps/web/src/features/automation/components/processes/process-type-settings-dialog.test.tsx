// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

vi.mock('../editor/panel/type-settings-access.js', () => ({
  TypeAccessSection: (props: { type: ProcessType; readOnly: boolean }) => (
    <div data-testid="access-section" data-read-only={props.readOnly ? 'yes' : 'no'} />
  ),
}));
vi.mock('../editor/panel/type-settings-card.js', () => ({
  TypeBlocksSection: (props: { readOnly: boolean }) => (
    <div data-testid="blocks-section" data-read-only={props.readOnly ? 'yes' : 'no'} />
  ),
  TypeRoleLabelsSection: (props: { readOnly: boolean }) => (
    <div data-testid="roles-section" data-read-only={props.readOnly ? 'yes' : 'no'} />
  ),
}));

const api = vi.hoisted(() => ({
  update: vi.fn(),
  archive: vi.fn(),
  updateScope: vi.fn(),
}));
vi.mock('../../api/automation-api.js', () => ({
  useUpdateProcessType: vi.fn(),
  useArchiveProcessType: vi.fn(),
}));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));

import { useArchiveProcessType, useUpdateProcessType } from '../../api/automation-api.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { ProcessTypeSettingsDialog } from './process-type-settings-dialog.js';

const KIND = (id: string, name: string, archived = false) =>
  ({
    id,
    name,
    icon: 'folder',
    color: 'blue',
    archivedAt: archived ? '2026-11-01T00:00:00.000Z' : null,
    form: { fields: [] },
    capabilities: [],
  }) as unknown as NodeKind;

const TYPE = (patch: Partial<ProcessType> = {}) =>
  ({
    id: 't1',
    code: 't1',
    name: 'Задание смежнику',
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: 'Короткое описание',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: 'wf-1',
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: false },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

function setup(patch: Partial<ProcessType> = {}) {
  const onClose = vi.fn();
  render(<ProcessTypeSettingsDialog type={TYPE(patch)} onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  vi.mocked(useUpdateProcessType).mockReturnValue({ mutate: api.update } as never);
  vi.mocked(useArchiveProcessType).mockReturnValue({ mutate: api.archive } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate: api.updateScope } as never);
  vi.mocked(useNodeKinds).mockReturnValue({
    data: [KIND('k1', 'Комплект'), KIND('k2', 'Архивный', true)],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('окно настроек типа процесса (#857, вердикт 26.11.2026)', () => {
  it('имя, описание и идентичность правятся на месте: имя уходит по уходу фокуса', () => {
    setup();
    expect(screen.getByText(ui.automation.typeSettings.title)).toBeTruthy();

    const name = screen.getByLabelText(ui.automation.fieldName);
    fireEvent.change(name, { target: { value: 'Задание подрядчику' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({
      id: 't1',
      body: { name: 'Задание подрядчику' },
    });

    const description = screen.getByLabelText(ui.automation.fieldDescription);
    fireEvent.change(description, { target: { value: 'Новое описание' } });
    fireEvent.blur(description);
    expect(api.update).toHaveBeenCalledWith({
      id: 't1',
      body: { description: 'Новое описание' },
    });
  });

  it('значок: выбор другого ключа сохраняется, текущий повторно не пишется', () => {
    setup();
    // Текущий значок отмечен нажатым и повторный клик — не изменение.
    expect(screen.getByRole('button', { name: 'square-check' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'square-check' }));
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'zap' }));
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { icon: 'zap' } });
  });

  it('цвет-идентичность сохраняется; текущий тон повторно не пишется', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: ui.tasks.stageColors.neutral }));
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.tasks.stageColors.success }));
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { color: 'success' } });
  });

  it('«Где создаётся»: тумблер «Без проекта», тип папки «Где угодно» и живой вид папки', () => {
    setup();
    const withoutProject = screen.getByRole('switch', {
      name: ui.automation.creationScope.withoutProject,
    });
    expect(withoutProject.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(withoutProject);
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: true }),
    });

    // Архивный вид папки в выборе не участвует.
    expect(screen.queryByRole('button', { name: 'Архивный' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Комплект' }));
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: 'k1' }),
    });

    fireEvent.click(
      screen.getByRole('button', { name: ui.automation.creationScope.folderKindAny }),
    );
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: null }),
    });
  });

  it('разделы доступа, блоков и ролей — редактируемые у типа задачи', () => {
    setup();
    expect(screen.getByTestId('access-section').getAttribute('data-read-only')).toBe('no');
    expect(screen.getByTestId('blocks-section').getAttribute('data-read-only')).toBe('no');
    expect(screen.getByTestId('roles-section').getAttribute('data-read-only')).toBe('no');
    // У задачи нумерации нет — раздела нет.
    expect(screen.queryByText(ui.automation.typeSettings.sections.numbering)).toBeNull();
  });

  it('архивация закрывает окно через onSuccess (строка уходит из живых)', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.menuArchive }));
    expect(api.archive).toHaveBeenCalledWith('t1', expect.objectContaining({ onSuccess: onClose }));

    // Мутация дошла до сервера и вызвала onSuccess — окно крестика/архивации закрыто.
    const [, options] = api.archive.mock.calls[0] as [string, { onSuccess: () => void }];
    options.onSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('письмо: системный каталог — только чтение, нумерация показана, связки «где создаётся» нет', () => {
    setup({
      id: 'l1',
      name: 'Входящее письмо',
      category: 'letter',
      icon: 'file-text',
      numbering: { seriesId: '33333333-3333-4333-8333-333333333333', prefix: 'Вх', reset: 'year' },
    });

    expect(screen.getByLabelText(ui.automation.fieldName).hasAttribute('readonly')).toBe(true);
    expect(screen.getByRole('button', { name: 'zap' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('access-section').getAttribute('data-read-only')).toBe('yes');
    // Блоков и ролей у письма нет — только доступ и нумерация.
    expect(screen.queryByTestId('blocks-section')).toBeNull();
    expect(screen.queryByTestId('roles-section')).toBeNull();
    expect(screen.queryByText(ui.automation.creationScope.withoutProject)).toBeNull();
    // Формат серии писем — только чтение (#504).
    expect(screen.getByText('Вх-ГГГГ/N')).toBeTruthy();
    expect(screen.getByText(ui.automation.typeSettings.numbering.readOnly)).toBeTruthy();
  });

  it('«Закрыть» внизу окна вызывает onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
