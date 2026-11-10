// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProcessType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { RouteToolbar } from './route-toolbar.js';

afterEach(cleanup);

const type = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'standard',
  name: 'Стандартный',
  category: 'task',
  icon: 'square-check',
  isSystem: true,
} as ProcessType;

function renderToolbar(overrides: Partial<ComponentProps<typeof RouteToolbar>> = {}) {
  return render(
    <RouteToolbar
      type={type}
      canManage
      dirty={false}
      publishedAt={null}
      publishedBy={null}
      problems={[]}
      publishBlocked
      addTransition={(trigger) => trigger}
      onAddStage={vi.fn()}
      onTidy={vi.fn()}
      onProblemClick={vi.fn()}
      onDiscard={vi.fn()}
      onPublish={vi.fn()}
      {...overrides}
    />,
  );
}

/** #497: при открытой правой панели холст сужается до ~440px и подписи
 * действий скрываются контейнерными брейкпоинтами. Значит, действия обязаны
 * различаться иконкой и иметь доступное имя (aria-label): иначе два «+»
 * («статус» и «переход») неразличимы. */
describe('RouteToolbar — действия в узком холсте (#497)', () => {
  it('каждое действие несёт aria-label из i18n (подпись может быть скрыта)', () => {
    renderToolbar({ dirty: true });

    // jsdom не применяет container queries и не прячет подписи, поэтому
    // проверяем именно атрибут, а не вычисленное имя кнопки.
    expect(
      screen.getByRole('button', { name: ui.automation.addStage }).getAttribute('aria-label'),
    ).toBe(ui.automation.addStage);
    expect(
      screen
        .getByRole('button', { name: ui.automation.addTransitionLabel })
        .getAttribute('aria-label'),
    ).toBe(ui.automation.addTransitionLabel);
    expect(
      screen.getByRole('button', { name: ui.automation.tidyUp }).getAttribute('aria-label'),
    ).toBe(ui.automation.tidyUp);
    expect(
      screen.getByRole('button', { name: ui.automation.discardShort }).getAttribute('aria-label'),
    ).toBe(ui.automation.discardShort);
  });

  it('«статус» и «переход» различаются иконкой, а не только подписью', () => {
    renderToolbar();

    const addStage = screen.getByRole('button', { name: ui.automation.addStage });
    const addTransition = screen.getByRole('button', { name: ui.automation.addTransitionLabel });

    expect(addStage.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus');
    expect(addTransition.querySelector('svg')?.getAttribute('class')).toContain(
      'lucide-arrow-right-left',
    );
    expect(addStage.querySelector('svg')?.getAttribute('class')).not.toBe(
      addTransition.querySelector('svg')?.getAttribute('class'),
    );
  });

  it('имя типа остаётся в дереве доступности, даже когда текст и глиф скрыты', () => {
    // При проблемах на узком холсте уходит и глиф — sr-only-копия обязана жить.
    renderToolbar({ problems: [{ code: 'dead_end_stage', severity: 'error' }] });

    expect(document.querySelector('header .sr-only')?.textContent).toBe(type.name);
    expect(document.querySelector('header span[title]')?.getAttribute('title')).toBe(type.name);
  });

  it('чип проблем остаётся в строке (не прячется) и имеет доступное имя со счётчиком', () => {
    renderToolbar({
      problems: [{ code: 'dead_end_stage', severity: 'error' }],
    });

    const chip = screen.getByRole('button', { name: `${ui.automation.problemsChip} · 1` });
    expect(chip.getAttribute('title')).toBe(`${ui.automation.problemsChip} · 1`);
    expect(chip.textContent).toContain('1');
  });
});
