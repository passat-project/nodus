// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  useUpdateProcessType: vi.fn(() => ({ mutate: api.update })),
  useArchiveProcessType: vi.fn(() => ({ mutate: api.archive })),
}));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useUpdateTypeCreation: vi.fn(() => ({ mutate: api.updateScope, isPending: false })),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
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

const SECTION = {
  main: ui.automation.entry.settingsSectionMain,
  placement: ui.automation.entry.settingsSectionPlacement,
  access: ui.automation.typeSettings.sections.access,
  card: ui.automation.entry.settingsSectionCard,
  roles: ui.automation.entry.settingsSectionRoles,
  numbering: ui.automation.typeSettings.sections.numbering,
} as const;

function setup(patch: Partial<ProcessType> = {}) {
  const onClose = vi.fn();
  const onArchived = vi.fn();
  render(
    <ProcessTypeSettingsDialog type={TYPE(patch)} onClose={onClose} onArchived={onArchived} />,
  );
  return { onClose, onArchived };
}

const SCOPE = ui.automation.creationScope;
const ICON = ui.automation.entry.iconNames;

/** Навигация разделов окна (вертикальный список под подписью «Разделы»). */
const nav = () => within(screen.getByRole('tablist', { name: ui.common.sections }));
const sectionLabels = () =>
  nav()
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
const selected = (label: string) =>
  nav().getByRole('tab', { name: label }).getAttribute('aria-selected');
const openSection = (label: string) => fireEvent.click(nav().getByRole('tab', { name: label }));
const colorGroup = () => screen.getByRole('radiogroup', { name: ui.automation.fieldColor });
const withoutProjectSwitch = () => screen.queryByRole('switch', { name: SCOPE.withoutProject });
/** Тумблер «Можно создавать без проекта» активного раздела — обязательно на экране. */
const requireWithoutProjectSwitch = () => {
  const toggle = withoutProjectSwitch();
  if (!toggle) throw new Error('нет тумблера «Можно создавать без проекта»');
  return toggle;
};

beforeEach(() => {
  vi.mocked(useNodeKinds).mockReturnValue({
    data: [KIND('k1', 'Комплект'), KIND('k2', 'Архивный', true)],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('окно настроек типа процесса — разделы (#857, ревизия UI v3)', () => {
  it('слева разделы по порядку, активен «Основное»; заголовок — «Настройки типа задачи · имя»', () => {
    setup();
    const heading = screen.getByRole('dialog').textContent ?? '';
    expect(heading).toContain(`${ui.common.typeSettings.title.task} · Задание смежнику`);
    expect(sectionLabels()).toEqual([
      SECTION.main,
      SECTION.placement,
      SECTION.access,
      SECTION.card,
      SECTION.roles,
    ]);
    expect(selected(SECTION.main)).toBe('true');
    // Смонтирован только активный раздел: «мелочь» не идёт простынёй.
    expect(screen.getByLabelText(ui.automation.fieldName)).toBeTruthy();
    expect(screen.queryByTestId('access-section')).toBeNull();
    expect(withoutProjectSwitch()).toBeNull();
  });

  it('переключение раздела меняет только правую колонку; назад — «Основное» снова', () => {
    setup();
    openSection(SECTION.placement);
    expect(selected(SECTION.placement)).toBe('true');
    expect(selected(SECTION.main)).toBe('false');
    expect(requireWithoutProjectSwitch()).toBeTruthy();
    expect(screen.queryByLabelText(ui.automation.fieldName)).toBeNull();

    openSection(SECTION.main);
    expect(screen.getByLabelText(ui.automation.fieldName)).toBeTruthy();
    expect(withoutProjectSwitch()).toBeNull();
  });

  it('доступ, блоки карточки и роли — редактируемые у типа задачи; нумерации у задачи нет', () => {
    setup();
    for (const [label, testId] of [
      [SECTION.access, 'access-section'],
      [SECTION.card, 'blocks-section'],
      [SECTION.roles, 'roles-section'],
    ] as const) {
      openSection(label);
      expect(screen.getByTestId(testId).dataset.readOnly).toBe('no');
    }
    expect(nav().queryByRole('tab', { name: SECTION.numbering })).toBeNull();
  });
});

describe('раздел «Основное» — сохранение немедленное (#857, ревизия UI v3)', () => {
  it('имя и описание уходят по уходу фокуса', () => {
    setup();
    const name = screen.getByLabelText(ui.automation.fieldName);
    fireEvent.change(name, { target: { value: 'Задание подрядчику' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { name: 'Задание подрядчику' } });

    const description = screen.getByLabelText(ui.automation.fieldDescription);
    fireEvent.change(description, { target: { value: 'Новое описание' } });
    fireEvent.blur(description);
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { description: 'Новое описание' } });
  });

  it('значок: сетка в поповере, текущий отмечен нажатым и повторно не пишется', async () => {
    setup();
    // Сетка не распирает окно: она раскрывается только по запросу.
    expect(screen.queryByRole('button', { name: ICON.zap })).toBeNull();
    const trigger = screen.getByRole('button', {
      name: `${ui.automation.fieldIcon}: ${ICON['square-check']}`,
    });
    fireEvent.click(trigger);

    const current = await screen.findByRole('button', { name: ICON['square-check'] });
    expect(current.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(current);
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: ICON.zap }));
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { icon: 'zap' } });
  });

  it('цвет-идентичность: ряд образцов, текущий тон повторно не пишется', () => {
    setup();
    const colors = within(colorGroup());
    fireEvent.click(colors.getByRole('radio', { name: ui.tasks.stageColors.neutral }));
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.click(colors.getByRole('radio', { name: ui.tasks.stageColors.success }));
    expect(api.update).toHaveBeenCalledWith({ id: 't1', body: { color: 'success' } });
  });
});

describe('раздел «Место создания» (#857, ревизия UI v3)', () => {
  it('тумблер «Можно создавать без проекта» сохраняет связку', () => {
    setup();
    openSection(SECTION.placement);
    const withoutProject = requireWithoutProjectSwitch();
    expect(withoutProject.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(withoutProject);
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: true }),
    });
  });

  it('ограничение по папке — список в поповере: архивного вида нет, выбор сохраняется, «Не ограничивать» обнуляет', async () => {
    setup();
    openSection(SECTION.placement);
    const trigger = screen.getByRole('button', {
      name: `${SCOPE.folderKind}: ${SCOPE.folderKindAny}`,
    });
    // Список видов раскрыт только по запросу.
    expect(screen.queryByRole('button', { name: 'Комплект' })).toBeNull();
    fireEvent.click(trigger);
    // Архивный вид папки в выборе не участвует.
    expect(screen.queryByRole('button', { name: 'Архивный' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Комплект' }));
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: 'k1' }),
    });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: SCOPE.folderKindAny }));
    expect(api.updateScope).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: null }),
    });
  });
});

describe('окно настроек типа процесса — жизненный цикл', () => {
  it('архивация закрывает окно и просит хост снять карточку типа', () => {
    const { onClose, onArchived } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.typeSettings.archive }));
    const [id, options] = api.archive.mock.calls[0] as [string, { onSuccess: () => void }];
    expect(id).toBe('t1');
    // Мутация дошла до сервера и вызвала onSuccess.
    act(() => options.onSuccess());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onArchived).toHaveBeenCalledTimes(1);
  });

  it('«Закрыть» внизу окна вызывает onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('письмо: разделы «Основное / Доступ / Нумерация», поля недоступны, связки «где создаётся» нет', () => {
    setup({
      id: 'l1',
      name: 'Входящее письмо',
      category: 'letter',
      icon: 'file-text',
      numbering: { seriesId: '33333333-3333-4333-8333-333333333333', prefix: 'Вх', reset: 'year' },
    });
    expect(screen.getByRole('dialog').textContent).toContain(ui.common.typeSettings.title.letter);
    expect(sectionLabels()).toEqual([SECTION.main, SECTION.access, SECTION.numbering]);
    // Системный каталог (#55): имя и описание только читаются, значок и цвет —
    // как обычные поля, без выбора.
    expect(screen.getByLabelText(ui.automation.fieldName).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText(ui.automation.fieldDescription).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen.getByRole('img', { name: `${ui.automation.fieldIcon}: ${ICON['file-text']}` }),
    ).toBeTruthy();
    expect(
      within(colorGroup())
        .getAllByRole('radio')
        .every((radio) => radio.hasAttribute('disabled')),
    ).toBe(true);

    openSection(SECTION.access);
    expect(screen.getByTestId('access-section').dataset.readOnly).toBe('yes');
    // Блоков и ролей у письма нет — разделов тоже.
    expect(nav().queryByRole('tab', { name: SECTION.card })).toBeNull();
    expect(nav().queryByRole('tab', { name: SECTION.roles })).toBeNull();

    // Формат серии писем — только чтение (#504).
    openSection(SECTION.numbering);
    expect(screen.getByText('Вх-ГГГГ/N')).toBeTruthy();
    expect(screen.getByText(ui.automation.typeSettings.numbering.readOnly)).toBeTruthy();
  });
});
