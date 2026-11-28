// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useUiPrefsStore } from '../../preferences/ui-prefs-store.js';
import { mergeAllGroups, splitActiveTab } from './card-tabs-actions.js';
import { useCardTabs } from './use-card-tabs.js';

const STABLE = ['structure', 'tasks', 'about'] as const;

function Harness({
  kind = 'project' as const,
  defaultActive = 'structure',
  requestedActive,
  defaultGroups,
  stableTabs = STABLE,
}: {
  kind?: 'project' | 'letter';
  defaultActive?: string;
  requestedActive?: string;
  defaultGroups?: readonly (readonly string[])[];
  stableTabs?: readonly string[];
}) {
  const tabs = useCardTabs({
    kind,
    stableTabs,
    defaultActive,
    requestedActive,
    defaultGroups,
  });
  return (
    <>
      <span data-testid="groups">{tabs.state.groups.map((g) => g.tabs.join('+')).join('|')}</span>
      <button type="button" onClick={() => tabs.splitIntoTwo(splitActiveTab(tabs.state), 800)}>
        split
      </button>
      <button type="button" onClick={() => tabs.setState(mergeAllGroups(tabs.state))}>
        merge
      </button>
      <button type="button" onClick={() => tabs.activate('structure')}>
        host-activate
      </button>
      <span data-testid="widths">{tabs.widths.groups?.join('+') ?? ''}</span>
      <span data-testid="actives">{tabs.state.groups.map((g) => g.active).join('|')}</span>
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

  it('открывает сохранённую активную вкладку, а не системный дефолт', async () => {
    await act(async () =>
      useUiPrefsStore.setState({
        personal: {
          cardTabs: {
            project: {
              version: 1,
              groups: [{ tabs: ['tasks', 'about', 'structure'], active: 'about' }],
            },
          },
        },
      }),
    );
    render(<Harness />);
    expect(screen.getByTestId('actives').textContent).toBe('about');
  });

  it('стартовый requestedActive хоста не перебивает сохранённую активную', async () => {
    await act(async () =>
      useUiPrefsStore.setState({
        personal: {
          cardTabs: {
            letter: {
              version: 1,
              groups: [{ tabs: ['about', 'structure', 'tasks'], active: 'about' }],
            },
          },
        },
      }),
    );
    render(<Harness kind="letter" defaultActive="structure" requestedActive="structure" />);
    expect(screen.getByTestId('actives').textContent).toBe('about');
  });

  it('системная раскладка defaultGroups: about слева, остальные справа', () => {
    render(<Harness defaultGroups={[['about'], ['structure', 'tasks']]} />);
    expect(screen.getByTestId('groups').textContent).toBe('about|structure+tasks');
    expect(screen.getByTestId('actives').textContent).toBe('about|structure');
  });

  it('без личных prefs открывает системный дефолт', () => {
    render(<Harness />);
    expect(screen.getByTestId('actives').textContent).toBe('structure');
  });

  it('активация стабильной вкладки хостом работает поверх восстановленной из prefs', async () => {
    await act(async () =>
      useUiPrefsStore.setState({
        personal: {
          cardTabs: {
            project: {
              version: 1,
              groups: [{ tabs: ['about', 'structure', 'tasks'], active: 'about' }],
            },
          },
        },
      }),
    );
    render(<Harness />);
    expect(screen.getByTestId('actives').textContent).toBe('about');
    await act(async () => {
      screen.getByRole('button', { name: 'host-activate' }).click();
    });
    expect(screen.getByTestId('actives').textContent).toBe('structure');
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

/** Вкладки-списки проекта (#435) приходят запросом ПОЗЖЕ маунта карточки:
 *  опоздавший стабильный состав обязан попасть в полосу — до фикса группы
 *  строились один раз и вкладка «появлялась» только после ручного
 *  выключения/включения видимости (волна владельца 28.11). */
describe('useCardTabs: опоздавший стабильный состав (#435)', () => {
  afterEach(async () => {
    cleanup();
    await act(async () => useUiPrefsStore.setState({ personal: {}, company: {} }));
  });

  it('вкладка, пришедшая после маунта, появляется в полосе без переключений', async () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByTestId('groups').textContent).toBe('structure+tasks+about');

    await act(async () => {
      rerender(<Harness stableTabs={['structure', 'tasks', 'about', 'view:v-1']} />);
    });
    expect(screen.getByTestId('groups').textContent).toBe('structure+tasks+about+view:v-1');
  });

  it('сохранённый порядок и активная вкладка переживают пересборку', async () => {
    const { rerender } = render(<Harness defaultActive="tasks" />);
    await act(async () => {
      screen.getByRole('button', { name: 'host-activate' }).click();
    });
    await act(async () => {
      // Тот же состав другим массивом — эффект не должен сбрасывать состояние.
      rerender(<Harness defaultActive="tasks" stableTabs={[...STABLE]} />);
    });
    expect(screen.getByTestId('actives').textContent).toBe('structure');
  });
});
