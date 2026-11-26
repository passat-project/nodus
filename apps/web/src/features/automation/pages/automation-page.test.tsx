// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const searchState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchState.value,
}));
vi.mock('../../../shared/access/module-access-matrix.js', () => ({
  ModuleAccessMatrix: () => <div data-testid="access-matrix" />,
}));
vi.mock('../components/fields/fields-tab.js', () => ({
  FieldsTab: () => <div data-testid="fields-tab" />,
}));
vi.mock('../components/registries/registries-tab.js', () => ({
  RegistriesTab: () => <div data-testid="registries-tab" />,
}));
vi.mock('../components/processes/processes-screen.js', () => ({
  ProcessesScreen: () => <div data-testid="processes-screen" />,
}));

import { AutomationPage } from './automation-page.js';

afterEach(cleanup);

describe('переключатель вкладок «Автоматизации» (#377, #857)', () => {
  it('?tab=access — матрица прав', () => {
    searchState.value = { tab: 'access' };
    render(<AutomationPage onArchiveProject={vi.fn()} onArchiveNodeKind={vi.fn()} />);
    expect(screen.getByTestId('access-matrix')).toBeTruthy();
  });

  it('?tab=registries — реестры', () => {
    searchState.value = { tab: 'registries' };
    render(<AutomationPage onArchiveProject={vi.fn()} onArchiveNodeKind={vi.fn()} />);
    expect(screen.getByTestId('registries-tab')).toBeTruthy();
  });

  it('?tab=fields — атрибуты; умолчание и tab=processes — единый вход', () => {
    searchState.value = { tab: 'fields' };
    render(<AutomationPage onArchiveProject={vi.fn()} onArchiveNodeKind={vi.fn()} />);
    expect(screen.getByTestId('fields-tab')).toBeTruthy();
    cleanup();
    searchState.value = {};
    render(<AutomationPage onArchiveProject={vi.fn()} onArchiveNodeKind={vi.fn()} />);
    expect(screen.getByTestId('processes-screen')).toBeTruthy();
    cleanup();
    searchState.value = { tab: 'processes', ptype: 'p1' };
    render(<AutomationPage onArchiveProject={vi.fn()} onArchiveNodeKind={vi.fn()} />);
    expect(screen.getByTestId('processes-screen')).toBeTruthy();
  });
});
