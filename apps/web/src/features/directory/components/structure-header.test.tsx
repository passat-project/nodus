// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';
import { TooltipProvider } from '@nodus/ui/components/tooltip';

import { StructureHeader } from './structure-header.js';

/** Шапка структуры (#768): «Пригласить» только админу, на узкой ширине
 *  инструменты сжимаются в иконки, «Список должностей» — иконка с подсказкой. */

afterEach(() => {
  cleanup();
});

const baseProps = {
  staffCount: 9,
  canManage: true,
  positionsOpen: false,
  roots: [],
  users: [],
  onInvite: vi.fn(),
  onTogglePositions: vi.fn(),
  onPickDepartment: vi.fn(),
  onPickEmployee: vi.fn(),
};

function renderHeader(props: Partial<Parameters<typeof StructureHeader>[0]> = {}) {
  return render(
    <TooltipProvider>
      <StructureHeader {...baseProps} rowWidth={1200} {...props} />
    </TooltipProvider>,
  );
}

describe('StructureHeader (#768)', () => {
  it('широкая шапка: «Пригласить» текстом, «Список должностей» — иконкой, поиск полем', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: ui.employees.invite })).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.employees.positionsList })).toBeTruthy();
    expect(screen.queryByText(ui.employees.positionsList)).toBeNull();
    expect(screen.getByPlaceholderText(ui.employees.structureSearch)).toBeTruthy();
  });

  it('узкая шапка: приглашение иконкой, поиск в иконке', () => {
    renderHeader({ rowWidth: 300 });
    expect(screen.queryByText(ui.employees.invite)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invite }));
    expect(baseProps.onInvite).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.positionsList }));
    expect(baseProps.onTogglePositions).toHaveBeenCalled();
  });

  it('без права управления приглашения нет', () => {
    renderHeader({ canManage: false });
    expect(screen.queryByRole('button', { name: ui.employees.invite })).toBeNull();
    expect(screen.getByRole('button', { name: ui.employees.positionsList })).toBeTruthy();
  });

  it('«Список должностей» — обычное действие без заливки: фон только по наведению', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: ui.employees.positionsList });
    expect(button.dataset.variant).toBe('ghost');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('панель постоянна: шапка всегда резервирует её ширину, инструменты не двигаются', () => {
    renderHeader({ rowWidth: 1100 });
    const header = screen.getByRole('heading', { level: 1 }).parentElement!;
    expect(header.style.paddingRight).toBe('320px');
    expect(header.className).not.toContain('transition-[padding]');
  });
});
