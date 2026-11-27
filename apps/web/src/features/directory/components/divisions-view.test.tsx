// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DivisionsView } from './divisions-view.js';
import type { DepartmentCardStats } from '../lib/department-card-stats.js';

/** Канвас структуры (#768): аккордеон раскрытий по уровням (модель Битрикса),
 *  шеврон-сворачивание ветки, главная карточка по умолчанию раскрыта, клик по
 *  предку не закрывает глубокие уровни, контуры маршрута, след спуска и жесты
 *  полотна. */

vi.mock('../lib/use-tree-edges.js', () => ({
  useTreeEdges: () => ({
    segments: [],
    ports: [],
    routes: [
      { parent: 'main', child: 'bim', d: 'M0 0 V10', length: 10 },
      { parent: 'main', child: 'build', d: 'M20 0 V10', length: 10 },
      { parent: 'bim', child: 'lab', d: 'M0 10 V20', length: 10 },
      { parent: 'lab', child: 'deep', d: 'M0 20 V30', length: 10 },
      { parent: 'build', child: 'site', d: 'M20 10 V20', length: 10 },
    ],
    portRadius: 3,
  }),
}));

const node = (id: string, name: string, children: DepartmentNode[] = []): DepartmentNode => ({
  id,
  name,
  kind: 'management',
  parentId: null,
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 1,
  children,
});

const tree = (): DepartmentNode[] => [
  node('main', 'ПассатПроект', [
    node('bim', 'BIM-отдел', [node('lab', 'Лаборатория', [node('deep', 'Глубокий отдел')])]),
    node('build', 'Строительный блок', [node('site', 'Участок')]),
  ]),
];

const content = () => document.querySelector('[data-structure-canvas-content]') as HTMLElement;
const canvas = () => document.querySelector('[data-structure-canvas]') as HTMLElement;

function mount(overrides: Partial<Parameters<typeof DivisionsView>[0]> = {}) {
  const props = {
    roots: tree(),
    selectedId: 'main' as string | null,
    mainId: 'main',
    myDepartmentId: null as string | null,
    focus: null,
    canManage: false,
    statsById: new Map<string, DepartmentCardStats>(),
    onSelect: vi.fn(),
    onCreateChild: vi.fn(),
    onInvite: vi.fn(),
    onEdit: vi.fn(),
    onTransfer: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const view = render(<DivisionsView {...props} />);
  return { props, ...view };
}

afterEach(() => {
  cleanup();
});

describe('DivisionsView (#768)', () => {
  it('главная карточка помечена, клик по подразделению выбирает его', () => {
    const { props } = mount({ selectedId: 'main' });
    expect(screen.getByText(ui.employees.mainCompanyShort)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /BIM-отдел/ }));
    expect(props.onSelect).toHaveBeenCalledWith('bim');
  });

  it('выбранная главная карточка подсвечивается (стиль выбора поверх стиля главной)', () => {
    mount({ selectedId: 'main' });
    const card = screen
      .getByText(ui.employees.mainCompanyShort)
      .closest('[data-tree-node]') as HTMLElement;
    expect(card.querySelector('[data-card-tint]')?.className).toContain('bg-accent/40');
  });

  it('аккордеон: у выбранного раскрыты подразделы, соседи видны свёрнутыми', () => {
    mount({ selectedId: 'bim' });
    expect(screen.getByText('ПассатПроект')).toBeTruthy();
    expect(screen.getByText('BIM-отдел')).toBeTruthy();
    expect(screen.getByText('Строительный блок')).toBeTruthy();
    expect(screen.getByText('Лаборатория')).toBeTruthy();
    // Соседняя ветка главной карточки видна, но её дети — нет.
    expect(screen.queryByText('Участок')).toBeNull();
    expect(screen.queryByText('Глубокий отдел')).toBeNull();
  });

  it('клик по соседу закрывает прежнюю ветку, соседи остаются видны', () => {
    const { props, rerender } = mount({ selectedId: 'lab' });
    expect(screen.getByText('Глубокий отдел')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Строительный блок/ }));
    expect(props.onSelect).toHaveBeenCalledWith('build');
    rerender(<DivisionsView {...props} selectedId="build" />);

    expect(screen.getByText('BIM-отдел')).toBeTruthy();
    expect(screen.queryByText('Лаборатория')).toBeNull();
    expect(screen.queryByText('Глубокий отдел')).toBeNull();
    expect(screen.getByText('Участок')).toBeTruthy();
  });

  it('клик по предку глубокие уровни не закрывает (модель Битрикса)', () => {
    const { props, rerender } = mount({ selectedId: 'deep' });
    expect(screen.getByText('Глубокий отдел')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /BIM-отдел/ }));
    expect(props.onSelect).toHaveBeenCalledWith('bim');
    rerender(<DivisionsView {...props} selectedId="bim" />);

    expect(screen.getByText('Лаборатория')).toBeTruthy();
    expect(screen.getByText('Глубокий отдел')).toBeTruthy();
  });

  it('повторный клик по выбранной карточке — no-op', () => {
    const { props } = mount({ selectedId: 'bim' });
    expect(screen.getByText('Лаборатория')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /BIM-отдел/ }));

    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Лаборатория')).toBeTruthy();
  });

  it('шеврон: сворачивает ветку целиком и переносит выбор на карточку шеврона', () => {
    const { props } = mount({ selectedId: 'deep' });
    expect(screen.getByText('Глубокий отдел')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-structure-toggle="bim"]') as HTMLElement);

    expect(screen.queryByText('Лаборатория')).toBeNull();
    expect(screen.queryByText('Глубокий отдел')).toBeNull();
    expect(props.onSelect).toHaveBeenCalledWith('bim');
  });

  it('повторное раскрытие шеврона открывает один уровень', () => {
    mount({ selectedId: 'deep' });
    const toggle = () => document.querySelector('[data-structure-toggle="bim"]') as HTMLElement;
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.getByText('Лаборатория')).toBeTruthy();
    expect(screen.queryByText('Глубокий отдел')).toBeNull();
  });

  it('главную карточку тоже можно свернуть шевроном', () => {
    mount({ selectedId: 'main' });
    expect(screen.getByText('BIM-отдел')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-structure-toggle="main"]') as HTMLElement);
    expect(screen.queryByText('BIM-отдел')).toBeNull();
    expect(screen.queryByText('Строительный блок')).toBeNull();
  });

  it('у листовой карточки шеврона нет', () => {
    mount({ selectedId: 'deep' });
    expect(document.querySelector('[data-structure-toggle="deep"]')).toBeNull();
  });

  it('клик по телу выбранной свёрнутой карточки раскрывает её', () => {
    const { props } = mount({ selectedId: 'bim' });
    fireEvent.click(document.querySelector('[data-structure-toggle="bim"]') as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: /BIM-отдел/ }));

    expect(screen.getByText('Лаборатория')).toBeTruthy();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('контуры: предки маршрута активны, выбранная выделена, сосед обычный', () => {
    mount({ selectedId: 'lab' });
    const mainCard = screen.getByText('ПассатПроект').closest('[data-tree-node]') as HTMLElement;
    const bim = screen.getByText('BIM-отдел').closest('[data-tree-node]') as HTMLElement;
    const lab = screen.getByText('Лаборатория').closest('[data-tree-node]') as HTMLElement;
    const build = screen.getByText('Строительный блок').closest('[data-tree-node]') as HTMLElement;

    expect(mainCard.className).toContain('border-foreground');
    expect(bim.className).toContain('border-foreground');
    expect(lab.className).toContain('shadow-');
    expect(build.className).not.toContain('border-foreground');
    expect(build.className).not.toContain('shadow-');
  });

  it('шеврон не двигает полотно', () => {
    mount({ selectedId: 'deep' });
    const before = content().style.transform;
    fireEvent.click(document.querySelector('[data-structure-toggle="bim"]') as HTMLElement);
    expect(content().style.transform).toBe(before);
  });

  it('плюсик под выбранной карточкой — только администратору, создаёт подразделение', () => {
    const { props } = mount({ selectedId: 'bim', canManage: true });
    const plus = screen.getByRole('button', { name: ui.employees.addSubdepartment });
    fireEvent.click(plus);
    expect(props.onCreateChild).toHaveBeenCalledWith('bim');
  });

  it('без права управления плюсика нет', () => {
    mount({ selectedId: 'bim', canManage: false });
    expect(screen.queryByRole('button', { name: ui.employees.addSubdepartment })).toBeNull();
  });

  it('след спуска: закрашены рёбра всего маршрута, SMIL-точки нет', () => {
    mount({ selectedId: 'deep' });
    const trace = document.querySelector('[data-structure-trace]');
    expect(trace).toBeTruthy();
    const edges = Array.from(document.querySelectorAll('[data-trace-edge]')).map((element) =>
      element.getAttribute('data-trace-edge'),
    );
    expect(edges).toEqual(['main:bim', 'bim:lab', 'lab:deep']);
    expect(document.querySelector('[data-trace-dot]')).toBeTruthy();
    expect(document.querySelector('animateMotion')).toBeNull();
  });

  it('у главной карточки следа нет — спускаться некуда', () => {
    mount({ selectedId: 'main' });
    expect(document.querySelector('[data-structure-trace]')).toBeNull();
  });

  it('клик по карточке не двигает полотно — экран стоит на месте', () => {
    mount({ selectedId: 'bim' });
    const before = content().style.transform;
    fireEvent.click(screen.getByRole('button', { name: /Строительный блок/ }));
    expect(content().style.transform).toBe(before);
  });

  it('под постоянную панель место зарезервировано всегда — канвас не дёргается', () => {
    mount({ selectedId: 'main' });
    const root = document.querySelector('[data-structure-root]') as HTMLElement;
    expect(root.style.paddingRight).toBe('320px');
  });

  it('Ctrl+колесо меняет масштаб, колесо без Ctrl — панорама', () => {
    mount({ selectedId: 'main' });
    expect(content().style.transform).toContain('scale(1)');

    fireEvent.wheel(canvas(), { deltaY: -300, ctrlKey: true });
    expect(content().style.transform).toMatch(/scale\(1\.\d+\)/);

    fireEvent.wheel(canvas(), { deltaY: 40, deltaX: 10 });
    expect(content().style.transform).toMatch(/translate3d\(-10px, -40px, 0\)/);
  });

  it('зажатая ЛКМ по пустому месту перемещает полотно', () => {
    mount({ selectedId: 'main' });
    const area = canvas();
    fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 140, clientY: 130 });
    expect(content().style.transform).toContain('translate3d(40px, 30px, 0)');
  });

  it('точечный фон едет и масштабируется вместе с полотном', () => {
    mount({ selectedId: 'main' });
    const dots = document.querySelector('[data-structure-dots]') as HTMLElement;
    expect(dots).toBeTruthy();
    expect(dots.getAttribute('aria-hidden')).toBe('true');
    const size = dots.style.backgroundSize;
    const position = dots.style.backgroundPosition;

    fireEvent.wheel(canvas(), { deltaY: -300, ctrlKey: true });
    expect(dots.style.backgroundSize).not.toBe(size);

    fireEvent.wheel(canvas(), { deltaY: 40, deltaX: 10 });
    expect(dots.style.backgroundPosition).not.toBe(position);
  });

  it('«Найти меня» — слева от масштаба, только при наличии обработчика', () => {
    const onLocateMe = vi.fn();
    const { unmount } = mount({ selectedId: 'main', onLocateMe });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.locateMe }));
    expect(onLocateMe).toHaveBeenCalled();
    unmount();

    mount({ selectedId: 'main' });
    expect(screen.queryByRole('button', { name: ui.employees.locateMe })).toBeNull();
  });

  it('индикатор масштаба сбрасывает вид на 100%', () => {
    mount({ selectedId: 'main' });
    fireEvent.wheel(canvas(), { deltaY: -300, ctrlKey: true });
    expect(screen.getByRole('button', { name: ui.employees.zoomReset }).textContent).not.toBe(
      '100%',
    );

    fireEvent.click(screen.getByRole('button', { name: ui.employees.zoomReset }));
    expect(screen.getByRole('button', { name: ui.employees.zoomReset }).textContent).toBe('100%');
  });
});
