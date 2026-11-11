// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployeeCardWorkTabs, type EmployeeWorkTab } from './employee-card-work-tabs.js';

/** Правая рабочая зона карточки сотрудника (#750): вкладки «Чат/Задачи/
 *  Проекты», чат по умолчанию, контент вкладок живёт скрытым, тоггл панели —
 *  только у чата. Журналы в тесте заменены заглушками (их механика покрыта
 *  своими тестами shared/views). */

vi.mock('./employee-journal-tabs.js', () => ({
  EmployeeTasksTab: () => <div>журнал задач</div>,
  EmployeeProjectsTab: () => <div>журнал проектов</div>,
}));

beforeEach(() => {
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function Harness({
  isOwnCard = false,
  onPanelToggle = vi.fn(),
}: {
  isOwnCard?: boolean;
  onPanelToggle?: () => void;
}) {
  const [active, setActive] = useState<EmployeeWorkTab>('chat');
  const [visited, setVisited] = useState<readonly EmployeeWorkTab[]>(['chat']);
  return (
    <EmployeeCardWorkTabs
      active={active}
      visited={visited}
      onActivate={(tab) => {
        setActive(tab);
        setVisited((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
      }}
      isOwnCard={isOwnCard}
      chat={<div>лента диалога</div>}
      tasks={[]}
      tasksLoading={false}
      onCreateTask={vi.fn()}
      projects={[]}
      projectsLoading={false}
      panelOpen={false}
      onPanelToggle={onPanelToggle}
    />
  );
}

describe('EmployeeCardWorkTabs — рабочая зона карточки сотрудника (#750)', () => {
  it('чат открыт по умолчанию, журналы не смонтированы до первого показа', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Чат' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('лента диалога')).not.toBeNull();
    expect(screen.queryByText('журнал задач')).toBeNull();
    expect(screen.queryByText('журнал проектов')).toBeNull();
  });

  it('журнал монтируется по клику, а чат остаётся смонтированным скрытым', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: /Задачи/ }));
    expect(screen.getByText('журнал задач')).not.toBeNull();
    // Чат не размонтирован: живёт в скрытой панели (invisible + inert) —
    // скролл и черновик не теряются.
    const chatPanel = screen.getByText('лента диалога').closest('[role="tabpanel"]');
    expect(chatPanel).not.toBeNull();
    expect(chatPanel?.className).toContain('invisible');
    expect(chatPanel?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('tab', { name: /Задачи/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('тоггл панели беседы — только у чата; уход на журнал его убирает', () => {
    const onPanelToggle = vi.fn();
    render(<Harness onPanelToggle={onPanelToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Панель беседы' }));
    expect(onPanelToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: /Задачи/ }));
    expect(screen.queryByRole('button', { name: 'Панель беседы' })).toBeNull();
  });

  it('своя карточка: первый раздел — «Избранное», не «Чат»', () => {
    render(<Harness isOwnCard />);
    expect(screen.getByRole('tab', { name: 'Избранное' })).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Чат' })).toBeNull();
  });

  it('←/→ переключают вкладки по кругу', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Задачи/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Чат' }).getAttribute('aria-selected')).toBe('true');
  });

  it('счётчик активной вкладки скрыт, но место в подписи держится', () => {
    function CountedHarness() {
      const [active, setActive] = useState<EmployeeWorkTab>('chat');
      const [visited, setVisited] = useState<readonly EmployeeWorkTab[]>(['chat', 'tasks']);
      return (
        <EmployeeCardWorkTabs
          active={active}
          visited={visited}
          onActivate={(tab) => {
            setActive(tab);
            setVisited((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
          }}
          isOwnCard={false}
          chat={<div>лента</div>}
          tasks={[{ id: 't1' } as never, { id: 't2' } as never, { id: 't3' } as never]}
          tasksLoading={false}
          onCreateTask={vi.fn()}
          projects={[]}
          projectsLoading={false}
          panelOpen={false}
          onPanelToggle={vi.fn()}
        />
      );
    }
    render(<CountedHarness />);
    // Неактивная вкладка показывает число как данные журнала...
    const tasksTab = screen.getByRole('tab', { name: /Задачи/ });
    expect(tasksTab.querySelector('.tabular-nums')?.getAttribute('aria-hidden')).toBeNull();
    // ...у активной число скрывается, но место остаётся — подпись и соседи
    // не прыгают (канон движка вкладок, badgeAlways не нужен).
    fireEvent.click(tasksTab);
    expect(tasksTab.getAttribute('aria-selected')).toBe('true');
    const badge = tasksTab.querySelector('.tabular-nums');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.className).toContain('invisible');
  });
});
