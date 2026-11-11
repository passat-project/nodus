// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useUiPrefsStore } from '../../preferences/ui-prefs-store.js';
import { mergeAllGroups, splitActiveTab } from './card-tabs-actions.js';
import { useCardTabs } from './use-card-tabs.js';

const STABLE = ['structure', 'tasks', 'about'] as const;

function Harness({ kind = 'project' as const }) {
  const tabs = useCardTabs({ kind, stableTabs: STABLE, defaultActive: 'structure' });
  return (
    <>
      <span data-testid="groups">{tabs.state.groups.map((g) => g.tabs.join('+')).join('|')}</span>
      <button type="button" onClick={() => tabs.splitIntoTwo(splitActiveTab(tabs.state), 800)}>
        split
      </button>
      <button type="button" onClick={() => tabs.setState(mergeAllGroups(tabs.state))}>
        merge
      </button>
      <span data-testid="widths">{tabs.widths.groups?.join('+') ?? ''}</span>
    </>
  );
}

/** Серверный GET prefs приходит ПОЗЖЕ маунта карточки: раскладка должна
 *  примениться без переоткрытия (регрессия: состояние собиралось один раз). */
describe('useCardTabs: внешнее обновление prefs', () => {
  afterEach(async () => {
    cleanup();
    await act(async () => useUiPrefsStore.setState({ personal: {}, company: {} }));
  });

  it('применяет пришедшие позже области и порядок', async () => {
    render(<Harness />);
    expect(screen.getByTestId('groups').textContent).toBe('structure+tasks+about');

    await act(async () =>
      useUiPrefsStore.setState({
        personal: {
          cardTabs: {
            project: {
              version: 1,
              groups: [{ tabs: ['tasks', 'about'], active: 'tasks' }, { tabs: ['structure'] }],
            },
          },
        },
      }),
    );

    expect(screen.getByTestId('groups').textContent).toBe('tasks+about|structure');
  });

  it('применяет новый порядок целиком', async () => {
    render(<Harness />);
    await act(async () =>
      useUiPrefsStore.setState({
        personal: {
          cardTabs: {
            project: { version: 1, groups: [{ tabs: ['about', 'structure', 'tasks'] }] },
          },
        },
      }),
    );
    expect(screen.getByTestId('groups').textContent).toBe('about+structure+tasks');
  });

  it('сплит коммитит 50/50, merge сбрасывает ширины областей', async () => {
    render(<Harness />);
    await act(async () => {
      screen.getByRole('button', { name: 'split' }).click();
    });
    expect(screen.getByTestId('groups').textContent).toBe('tasks+about|structure');
    expect(screen.getByTestId('widths').textContent).toBe('400+400');
    expect(useUiPrefsStore.getState().personal.cardTabs?.project?.widths?.groups).toEqual([
      400, 400,
    ]);

    await act(async () => {
      screen.getByRole('button', { name: 'merge' }).click();
    });
    expect(screen.getByTestId('groups').textContent).toBe('tasks+about+structure');
    expect(screen.getByTestId('widths').textContent).toBe('');
    expect(useUiPrefsStore.getState().personal.cardTabs?.project?.widths?.groups).toBeUndefined();
  });
});
