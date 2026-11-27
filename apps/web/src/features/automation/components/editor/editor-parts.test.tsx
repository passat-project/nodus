// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

/** Последние аргументы `useBlocker`: блокер проверяем на его же функции. */
const blocker = vi.hoisted(() => ({
  shouldBlockFn: null as null | ((args: { current: unknown; next: unknown }) => boolean),
  status: 'idle' as 'idle' | 'blocked',
  reset: vi.fn(),
  proceed: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (options: { shouldBlockFn: typeof blocker.shouldBlockFn }) => {
    blocker.shouldBlockFn = options.shouldBlockFn;
    return { status: blocker.status, reset: blocker.reset, proceed: blocker.proceed };
  },
}));

import { isCardsOnlyChange, NavigationGuard, UnsavedDialog } from './editor-parts.js';

type Location = { pathname: string; search: Record<string, unknown> };

const PAGE: Location = { pathname: '/automation', search: { tab: 'processes', type: 't1' } };
const withCards = (cards: string | undefined): Location => ({
  ...PAGE,
  search: { ...PAGE.search, cards },
});

afterEach(() => {
  cleanup();
  blocker.status = 'idle';
  blocker.shouldBlockFn = null;
});

describe('isCardsOnlyChange — та же страница, меняется только стек карточек (#857)', () => {
  it('открытие и закрытие карточки поверх — только стек', () => {
    expect(isCardsOnlyChange(PAGE, withCards('task:t9'))).toBe(true);
    expect(isCardsOnlyChange(withCards('task:t9'), withCards('task:t9,project-type:p1'))).toBe(
      true,
    );
    expect(isCardsOnlyChange(withCards('task:t9,project-type:p1'), withCards('task:t9'))).toBe(
      true,
    );
    expect(isCardsOnlyChange(withCards('task:t9'), PAGE)).toBe(true);
  });

  it('не только стек: другой параметр страницы, другая страница, ничего не изменилось', () => {
    expect(
      isCardsOnlyChange(PAGE, {
        pathname: '/automation',
        search: { ...PAGE.search, type: 't2', cards: 'task:t9' },
      }),
    ).toBe(false);
    expect(isCardsOnlyChange(PAGE, { pathname: '/projects', search: PAGE.search })).toBe(false);
    expect(isCardsOnlyChange(PAGE, PAGE)).toBe(false);
    expect(isCardsOnlyChange(withCards('task:t9'), withCards('task:t9'))).toBe(false);
  });

  it('порядок ключей поиска не в счёт: сравнение по значениям', () => {
    expect(
      isCardsOnlyChange(
        { pathname: '/automation', search: { tab: 'processes', type: 't1' } },
        { pathname: '/automation', search: { cards: 'task:t9', type: 't1', tab: 'processes' } },
      ),
    ).toBe(true);
  });

  it('поиск не объект — не решаем «только стек»', () => {
    expect(
      isCardsOnlyChange({ pathname: '/automation', search: undefined }, withCards('a:b')),
    ).toBe(false);
    expect(isCardsOnlyChange(PAGE, { pathname: '/automation', search: null })).toBe(false);
  });
});

describe('блокер ухода с черновиком: карточки поверх — не уход (#857, ревизия UI v3)', () => {
  function shouldBlock(current: unknown, next: unknown): boolean {
    if (!blocker.shouldBlockFn) throw new Error('useBlocker не вызван');
    return blocker.shouldBlockFn({ current, next });
  }

  it('без черновика ничего не блокирует', () => {
    render(<NavigationGuard dirty={false} />);
    expect(shouldBlock(PAGE, { pathname: '/projects', search: {} })).toBe(false);
    expect(shouldBlock(PAGE, withCards('task:t9'))).toBe(false);
  });

  it('рама с черновиком: уход блокируется, открытие/закрытие карточек поверх — нет', () => {
    render(<NavigationGuard dirty />);
    expect(shouldBlock(PAGE, { pathname: '/projects', search: {} })).toBe(true);
    expect(shouldBlock(PAGE, { ...PAGE, search: { ...PAGE.search, type: 't2' } })).toBe(true);
    expect(shouldBlock(PAGE, withCards('task:t9'))).toBe(false);
    expect(shouldBlock(withCards('task:t9'), PAGE)).toBe(false);
  });

  it('заблокированный уход показывает вопрос «Уйти без публикации?» с двумя действиями', () => {
    blocker.status = 'blocked';
    render(<NavigationGuard dirty />);
    expect(screen.getByRole('dialog').textContent).toContain(ui.automation.unsavedTitle);
    expect(screen.getByRole('button', { name: ui.common.cancel })).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.automation.discard })).toBeTruthy();
  });

  it('вопрос показывается только в заблокированном состоянии', () => {
    render(<NavigationGuard dirty />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('UnsavedDialog — один вопрос у блока ухода и у закрытия карточки с черновиком (#857)', () => {
  it('закрыт — окна нет; открыт — «Отмена» остаётся, «Уйти» уходит', () => {
    const onCancel = vi.fn();
    const onDiscard = vi.fn();
    const view = render(<UnsavedDialog open={false} onCancel={onCancel} onDiscard={onDiscard} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<UnsavedDialog open onCancel={onCancel} onDiscard={onDiscard} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(ui.automation.unsavedTitle);
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.discard }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('подпись подтверждающей кнопки задаёт вызывающий: закрытие карточки с черновиком — «Закрыть»', () => {
    render(
      <UnsavedDialog open onCancel={vi.fn()} onDiscard={vi.fn()} confirmLabel={ui.common.close} />,
    );
    expect(screen.getByRole('button', { name: ui.common.close })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.automation.discard })).toBeNull();
  });

  it('Esc и клик мимо — это «Отмена» (вопрос не молчит, решение за человеком)', () => {
    const onCancel = vi.fn();
    render(<UnsavedDialog open onCancel={onCancel} onDiscard={vi.fn()} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
