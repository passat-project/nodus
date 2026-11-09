// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const fixtures = vi.hoisted(() => ({
  store: { patchTransition: vi.fn(), setCreationForm: vi.fn() },
  definitions: [] as unknown[],
}));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));
vi.mock('../../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => false,
}));
vi.mock('../../../model/route-doc-store.js', () => {
  const store = (selector: (value: typeof fixtures.store) => unknown) => selector(fixtures.store);
  store.getState = () => fixtures.store;
  return { useRouteDocStore: store };
});

import { WindowSection } from './window-section.js';

const b = ui.forms.builder;
const l = ui.forms.locks;
const w = ui.automation.window;

function transition(overrides: Partial<WorkflowDraftTransition['form']> = {}) {
  return {
    id: '90000000-0000-4000-8000-000000000010',
    code: null,
    name: 'Выдать в печать',
    fromStageId: null,
    toStageId: '90000000-0000-4000-8000-000000000002',
    display: 'button',
    intent: 'action',
    sortOrder: 0,
    rules: { conditions: [], validators: [], postFunctions: [] },
    form: {
      enabled: true,
      title: 'Выдача',
      locks: [{ key: 'description', editors: 'none' }],
      sections: [
        { kind: 'fields', fields: ['deadline'] },
        { kind: 'comment', label: 'Причина отказа', required: true },
      ],
      ...overrides,
    },
  } as WorkflowDraftTransition;
}

beforeEach(() => {
  fixtures.store.patchTransition.mockClear();
});

afterEach(cleanup);

function renderSection(draft = transition(), readOnly = false) {
  render(<WindowSection transition={draft} scope="task" typeId={undefined} readOnly={readOnly} />);
}

describe('раздел «Окно перехода» инспектора кнопки (#380, #496)', () => {
  it('тумблер, заголовок окна и сводка состава с входом в редактор', () => {
    renderSection();

    expect(screen.getByText(w.enable)).toBeTruthy();
    expect((screen.getByDisplayValue('Выдача') as HTMLInputElement).value).toBe('Выдача');
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${b.edit}.*${b.summary(1, 1)}.*Причина отказа`),
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.edit) }));
    expect(screen.getByText(`${b.titles.transition} «Выдать в печать»`)).toBeTruthy();
  });

  it('заголовок окна правится в черновике кнопки', () => {
    renderSection();

    fireEvent.change(screen.getByDisplayValue('Выдача'), { target: { value: 'Новая выдача' } });

    expect(fixtures.store.patchTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ form: expect.objectContaining({ title: 'Новая выдача' }) }),
    );
  });

  it('выключение окна с замками — с подтверждением', () => {
    renderSection();

    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.enable) }));
    expect(screen.getByText(l.disableTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(fixtures.store.patchTransition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.enable) }));
    fireEvent.click(screen.getByRole('button', { name: l.disableConfirm }));
    expect(fixtures.store.patchTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ form: expect.objectContaining({ enabled: false }) }),
    );
  });

  it('выключение окна без замков — сразу, без окна подтверждения', () => {
    renderSection(transition({ locks: [] }));

    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.enable) }));

    expect(screen.queryByText(l.disableTitle)).toBeNull();
    expect(fixtures.store.patchTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ form: expect.objectContaining({ enabled: false }) }),
    );
  });

  it('выключенное окно — только тумблер; без права — просмотр', () => {
    renderSection(transition({ enabled: false }), true);

    expect(screen.queryByDisplayValue('Выдача')).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(b.view) })).toBeNull();

    cleanup();
    renderSection(transition(), true);
    expect(screen.getByRole('button', { name: new RegExp(b.view) })).toBeTruthy();
  });
});
