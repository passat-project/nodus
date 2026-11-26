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
  it('постоянный узел «Создание проекта» открывает редактор окна создания', () => {
    const onOpenWindow = vi.fn();
    render(<ProjectSchemaCanvas type={TYPE} canSetup onOpenWindow={onOpenWindow} />);

    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.getAttribute('title')).toBe(ui.projects.schemasCreationNodeHint);
    fireEvent.click(node);
    expect(onOpenWindow).toHaveBeenCalledTimes(1);
    // Подсказка холста и имя типа для скринридера (карточка имени не дублирует).
    expect(screen.getByText(ui.projects.schemasCanvasHint)).toBeTruthy();
    expect(screen.getByText('Договор')).toBeTruthy();
  });

  it('без права настройки узел не выглядит кликабельным, но открывает окно на просмотр', () => {
    const onOpenWindow = vi.fn();
    render(<ProjectSchemaCanvas type={TYPE} canSetup={false} onOpenWindow={onOpenWindow} />);

    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.className).toContain('cursor-default');
    expect(node.className).not.toContain('hover:border-input');
    fireEvent.click(node);
    expect(onOpenWindow).toHaveBeenCalledTimes(1);
  });

  it('с правом настройки узел подсвечивается по наведению', () => {
    render(<ProjectSchemaCanvas type={TYPE} canSetup onOpenWindow={() => void 0} />);
    const node = screen.getByRole('button', { name: ui.projects.schemasCreationNode });
    expect(node.className).toContain('hover:border-input');
    expect(node.className).not.toContain('cursor-default');
  });
});
