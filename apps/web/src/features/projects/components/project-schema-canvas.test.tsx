// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ProjectSchemaCanvas } from './project-schema-canvas.js';

const TYPE = {
  id: 'p1',
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  form: { fields: [] },
  kindIds: null,
  archivedAt: null,
} as unknown as ProjectType;

afterEach(cleanup);

describe('канвас вкладки «Схема» типа проекта (#556, каркас #38)', () => {
  it('постоянный узел «Создание проекта» включает вкладку «Форма создания» (#857)', () => {
    const onOpenForm = vi.fn();
    render(<ProjectSchemaCanvas type={TYPE} canSetup onOpenForm={onOpenForm} />);

    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.getAttribute('title')).toBe(ui.projects.schemasCreationNodeHint);
    fireEvent.click(node);
    expect(onOpenForm).toHaveBeenCalledTimes(1);
    // Подсказка холста и имя типа для скринридера (карточка имени не дублирует).
    expect(screen.getByText(ui.projects.schemasCanvasHint)).toBeTruthy();
    expect(screen.getByText('Договор')).toBeTruthy();
  });

  it('тихое действие под пояснением ведёт туда же, что узел: «Форма создания»', () => {
    const onOpenForm = vi.fn();
    render(<ProjectSchemaCanvas type={TYPE} canSetup onOpenForm={onOpenForm} />);

    const action = screen.getByRole('button', { name: ui.projects.schemasOpenForm });
    expect(action.textContent).toBe('Настроить форму создания');
    fireEvent.click(action);
    expect(onOpenForm).toHaveBeenCalledTimes(1);
  });

  it('без права настройки узел не выглядит кликабельным, но открывает форму на просмотр', () => {
    const onOpenForm = vi.fn();
    render(<ProjectSchemaCanvas type={TYPE} canSetup={false} onOpenForm={onOpenForm} />);

    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.className).toContain('cursor-default');
    expect(node.className).not.toContain('hover:border-input');
    fireEvent.click(node);
    expect(onOpenForm).toHaveBeenCalledTimes(1);
  });

  it('с правом настройки узел подсвечивается по наведению', () => {
    render(<ProjectSchemaCanvas type={TYPE} canSetup onOpenForm={() => void 0} />);
    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.className).toContain('hover:border-input');
    expect(node.className).not.toContain('cursor-default');
  });
});
