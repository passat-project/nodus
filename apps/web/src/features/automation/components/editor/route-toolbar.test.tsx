// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { RouteBarPortals, type RouteBarHosts } from './route-toolbar.js';

vi.mock('./problems-chip.js', () => ({
  ProblemsChip: ({ problems }: { problems: readonly WorkflowProblem[] }) => (
    <div data-testid="problems-chip" data-count={problems.length} />
  ),
}));

const PROBLEM: WorkflowProblem = { code: 'no_initial', severity: 'error' };

/** Рама выдаёт три пустых места — как `TypeCardFrame` в bar-режиме. */
function Hosts({ children }: { children: (hosts: RouteBarHosts) => React.ReactNode }) {
  const tools = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Сами ref в рендере не читаем: места готовы после монтирования.
  useEffect(() => setReady(true), []);
  return (
    <header>
      <nav aria-label="Вкладки рамы" />
      <div ref={tools} data-testid="host-tools" />
      <div ref={status} data-testid="host-status" />
      <div ref={primary} data-testid="host-primary" />
      {ready && tools.current && status.current && primary.current
        ? children({ tools: tools.current, status: status.current, primary: primary.current })
        : null}
    </header>
  );
}

const addTransition = (trigger: React.ReactNode) => trigger;

function setup(
  props: {
    canManage?: boolean;
    dirty?: boolean;
    problems?: WorkflowProblem[];
    /** `false` — рама не выделила места (вкладка не «Маршрут», рама приостановлена). */
    hosts?: boolean;
  } = {},
) {
  const onAddStage = vi.fn();
  const onProblemClick = vi.fn();
  const onPublish = vi.fn();
  const { hosts = true, canManage = true, dirty = false, problems = [] } = props;
  render(
    <Hosts>
      {(slots) => (
        <RouteBarPortals
          hosts={hosts ? slots : null}
          canManage={canManage}
          dirty={dirty}
          problems={problems}
          onAddStage={onAddStage}
          addTransition={addTransition}
          onProblemClick={onProblemClick}
          onPublish={onPublish}
        />
      )}
    </Hosts>,
  );
  return { onAddStage, onProblemClick, onPublish };
}

const host = (name: string) => screen.getByTestId(`host-${name}`);
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & 4);

afterEach(cleanup);

describe('бар рамы маршрута: «слева добавлять, справа завершать» (#857, ревизия UI v3)', () => {
  it('инструменты — сразу за вкладками, главная кнопка — крайняя справа, между ними состояние', () => {
    setup({ dirty: true, problems: [PROBLEM] });
    const tools = within(host('tools')).getAllByRole('button');
    expect(tools.map((button) => button.getAttribute('aria-label'))).toEqual([
      ui.automation.addStage,
      ui.automation.addTransitionLabel,
    ]);
    expect(within(host('status')).getByTestId('problems-chip').dataset.count).toBe('1');
    expect(within(host('primary')).getByRole('button').textContent).toBe(ui.automation.publish);
    // Порядок документа: вкладки → инструменты → состояние → главная кнопка.
    const tabs = screen.getByRole('navigation', { name: 'Вкладки рамы' });
    expect(precedes(tabs, host('tools'))).toBe(true);
    expect(precedes(host('tools'), host('status'))).toBe(true);
    expect(precedes(host('status'), host('primary'))).toBe(true);
  });

  it('инструменты бара — тихие кнопки: «Добавить этап» кликается, «Добавить переход» — та же кнопка под поповером', () => {
    const { onAddStage } = setup({ dirty: true });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.addStage }));
    expect(onAddStage).toHaveBeenCalledTimes(1);
    // Кнопку перехода редактор оборачивает своим поповером — бар рисует саму кнопку.
    const transition = screen.getByRole('button', { name: ui.automation.addTransitionLabel });
    expect(host('tools').contains(transition)).toBe(true);
  });

  it('две ступени: полная подпись от 1120px, ниже — знак действия; имя и title всегда полные', () => {
    setup({ dirty: true });
    const stage = screen.getByRole('button', { name: ui.automation.addStage });
    const transition = screen.getByRole('button', { name: ui.automation.addTransitionLabel });
    for (const [tool, full] of [
      [stage, ui.automation.addStage],
      [transition, ui.automation.addTransitionLabel],
    ] as const) {
      expect(tool.getAttribute('aria-label')).toBe(full);
      expect(tool.getAttribute('title')).toBe(full);
      // Подпись — только от 1120px: на рабочей ширине владельца (1536, рама
      // 766px) подпись со знаком отрезала третью вкладку.
      expect(
        [...tool.querySelectorAll('span')].map((span) => [span.textContent, span.className]),
      ).toEqual([[full, 'hidden @min-[1120px]:inline']]);
    }
    // Ниже полной ступени бар показывает знак действия: «+» — новый статус,
    // «⇄» — переход; на широкой — «+» рядом с полной подписью.
    expect([...stage.querySelectorAll('svg')].map((icon) => icon.getAttribute('class'))).toEqual([
      'lucide lucide-plus size-3.5 block @min-[1120px]:hidden',
      'lucide lucide-plus hidden @min-[1120px]:block',
    ]);
    expect(
      [...transition.querySelectorAll('svg')].map((icon) => icon.getAttribute('class')),
    ).toEqual([
      'lucide lucide-arrow-right-left size-3.5 block @min-[1120px]:hidden',
      'lucide lucide-plus hidden @min-[1120px]:block',
    ]);
  });

  it('«Сбросить» и «Упорядочить» в баре не живут — они на холсте', () => {
    setup({ dirty: true });
    expect(screen.queryByRole('button', { name: new RegExp(ui.automation.draftReset) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(ui.automation.tidyUp) })).toBeNull();
  });

  it('«Опубликовать»: без черновика и при ошибках недоступна, с черновиком без ошибок — публикует', () => {
    setup({ dirty: false });
    expect(within(host('primary')).getByRole('button')).toHaveProperty('disabled', true);
    cleanup();

    const broken = setup({ dirty: true, problems: [PROBLEM] });
    const blocked = within(host('primary')).getByRole('button');
    expect(blocked).toHaveProperty('disabled', true);
    // Причина блокировки — подсказкой у кнопки; чип проблем — рядом.
    expect(blocked.getAttribute('title')).toContain(`${ui.automation.problemsFixFirst} 1`);
    fireEvent.click(blocked);
    expect(broken.onPublish).not.toHaveBeenCalled();
    cleanup();

    const ready = setup({ dirty: true });
    expect(within(host('status')).queryByTestId('problems-chip')).toBeNull();
    fireEvent.click(within(host('primary')).getByRole('button'));
    expect(ready.onPublish).toHaveBeenCalledTimes(1);
  });

  it('просмотр без права: инструменты и публикация не предлагаются, чип проблем остаётся', () => {
    setup({ canManage: false, dirty: true, problems: [PROBLEM] });
    expect(host('tools').childElementCount).toBe(0);
    expect(host('primary').childElementCount).toBe(0);
    expect(within(host('status')).getByTestId('problems-chip')).toBeTruthy();
  });

  it('хостов нет (вкладка не «Маршрут» или рама приостановлена) — бар не трогается', () => {
    setup({ hosts: false, dirty: true, problems: [PROBLEM] });
    expect(host('tools').childElementCount).toBe(0);
    expect(host('status').childElementCount).toBe(0);
    expect(host('primary').childElementCount).toBe(0);
  });
});
