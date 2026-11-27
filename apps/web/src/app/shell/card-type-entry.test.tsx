// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const typesState = vi.hoisted(() => ({ data: [] as unknown[] | undefined }));
const workflowState = vi.hoisted(() => ({ data: undefined as unknown }));
const projectsState = vi.hoisted(() => ({ data: [] as unknown[] }));
const routeState = vi.hoisted(() => ({ dirty: false }));
/** Панель отдаёт наружу страж закрытия; `closed` — сколько раз её позвали
 *  закрыться СВОЕЙ хореографией (после согласия «Отменить изменения»). */
const panel = vi.hoisted(() => ({
  closeGuard: null as null | (() => boolean),
  closed: 0,
}));

vi.mock('../../features/automation/api/automation-api.js', () => ({
  useProcessTypes: vi.fn(() => ({ data: typesState.data })),
}));
vi.mock('../../features/automation/model/route-doc-store.js', () => ({
  useRouteDocStore: (selector: (state: { dirty: boolean }) => unknown) =>
    selector({ dirty: routeState.dirty }),
}));
vi.mock('../../shared/workflow/workflow-api.js', () => ({
  useWorkflowDetail: vi.fn(() => ({ data: workflowState.data })),
}));
vi.mock('../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: projectsState.data, isLoading: false })),
}));
vi.mock('../../features/automation/components/processes/process-type-card.js', () => ({
  ProcessTypeCard: (props: { type: ProcessType; suspended?: boolean; idPrefix?: string }) => (
    <div
      data-testid="process-card"
      data-id={props.type.id}
      data-suspended={props.suspended ? 'yes' : 'no'}
      data-prefix={props.idPrefix}
    />
  ),
}));
vi.mock('../../features/automation/components/editor/editor-parts.js', () => ({
  UnsavedDialog: ({
    open,
    onCancel,
    onDiscard,
    confirmLabel,
  }: {
    open: boolean;
    onCancel: () => void;
    onDiscard: () => void;
    confirmLabel?: string;
  }) => (
    <div data-testid="unsaved-dialog" data-open={open ? 'yes' : 'no'} data-confirm={confirmLabel}>
      <button type="button" onClick={onCancel}>
        cancel
      </button>
      <button type="button" onClick={onDiscard}>
        discard
      </button>
    </div>
  ),
}));
// Хосты уровня app отдельно проверены (automation-hosts.test): здесь им достаточно
// подставить замоканные компоненты фич — проверяем, какие id и колбэки им передала запись.
vi.mock('../automation-hosts.js', () => ({
  renderProjectTypeCreate: () => null,
  ProjectTypeWorkspaceHost: ({ id }: { id: string }) => (
    <div data-testid="workspace" data-id={id} />
  ),
}));
vi.mock('./slider-panel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./slider-panel.js')>();
  const { useImperativeHandle } = await import('react');
  return {
    ...actual,
    // Геометрия слайдера не нужна: панель отдаёт наружу страж закрытия и ручку.
    SliderPanel: ({
      title,
      children,
      closeGuard,
      ref,
    }: {
      title?: React.ReactNode;
      children: React.ReactNode;
      closeGuard?: () => boolean;
      ref?: React.Ref<{ close: () => void }>;
    }) => {
      panel.closeGuard = closeGuard ?? null;
      useImperativeHandle(ref, () => ({ close: () => void panel.closed++ }), []);
      return (
        <section data-testid="card">
          <header data-testid="card-title">{title}</header>
          {children}
        </section>
      );
    },
  };
});

import type { TypeCardKind } from './card-type-entries.js';
import { TypeCardEntry } from './card-type-entry.js';

const ID = {
  process: '10000000-0000-4000-8000-000000000001',
  project: '10000000-0000-4000-8000-000000000002',
};

const entry = (kind: TypeCardKind, id: string, onClose: () => void = vi.fn(), top = true) => (
  <TypeCardEntry
    kind={kind}
    id={id}
    source={undefined}
    onClose={onClose}
    dormant={false}
    top={top}
  />
);
const processEntry = (onClose: () => void, top = true) =>
  entry('process-type', ID.process, onClose, top);

beforeEach(() => {
  typesState.data = [
    {
      id: ID.process,
      name: 'Комплект',
      category: 'task',
      icon: 'package',
      color: 'neutral',
      workflowId: 'wf-1',
      archivedAt: null,
    },
  ];
  workflowState.data = { id: 'wf-1', document: { stages: [] } };
  projectsState.data = [{ id: ID.project, name: 'Договор', color: 'blue', archivedAt: null }];
  routeState.dirty = false;
  panel.closeGuard = null;
  panel.closed = 0;
});

afterEach(cleanup);

describe('карточки типов «Процессов» в общем стеке: каркас и ленивые тела (#857)', () => {
  // Первым в файле: кусок тел грузится один раз на модуль, скелет виден только
  // пока кода на руках нет.
  it('пока кусок не загружен — каркас: панель, скелет заголовка и скелет тела, как при загрузке данных', async () => {
    render(
      <>
        {entry('project-type', ID.project)}
        {processEntry(vi.fn())}
      </>,
    );
    const [projectCard, processCard] = screen.getAllByTestId('card') as [HTMLElement, HTMLElement];
    // Тип проекта: три строки-скелета рабочей области, пока кода тела нет.
    expect(screen.getByLabelText(ui.projects.schemasTabsAria)).toBeTruthy();
    const body = projectCard.children.item(1);
    expect(body?.getAttribute('aria-hidden')).toBe('true');
    expect(body?.childElementCount).toBe(3);
    // Типу задачи до готовности маршрута тело пусто.
    expect(screen.getByLabelText(ui.automation.typeSettings.title)).toBeTruthy();
    expect(processCard.childElementCount).toBe(1);
    expect(screen.queryByTestId('workspace')).toBeNull();
    expect(screen.queryByTestId('process-card')).toBeNull();
    // Страж закрытия принадлежит телу: пока его нет, панель закрывается без вопроса.
    routeState.dirty = true;
    let allowed = true;
    act(() => {
      allowed = panel.closeGuard!();
    });
    expect(allowed).toBe(true);
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    // Кусок пришёл — заголовки и тела настоящие.
    expect((await screen.findByTestId('workspace')).dataset.id).toBe(ID.project);
    expect(screen.getByTestId('process-card').dataset.id).toBe(ID.process);
    expect(screen.getAllByTestId('card-title')[0]!.textContent).toContain('Договор');
  });

  it('тип процесса: значок и имя в заголовке, тело — карточка с редактором', async () => {
    render(processEntry(vi.fn()));
    const card = await screen.findByTestId('process-card');
    expect(screen.getByTestId('card-title').textContent).toContain('Комплект');
    expect(card.dataset.id).toBe(ID.process);
    expect(card.dataset.suspended).toBe('no');
    // Свой префикс вкладок: карточка поверх рамы ТОГО ЖЕ типа не дублирует id.
    expect(card.dataset.prefix).toBe(`process-type-card-${ID.process}`);
  });

  it('правило одного редактора: не верхняя в стеке карточка не монтирует редактор', async () => {
    const view = render(processEntry(vi.fn()));
    expect((await screen.findByTestId('process-card')).dataset.suspended).toBe('no');
    // Поверх легла другая карточка — эта перестала быть верхней.
    act(() => view.rerender(processEntry(vi.fn(), false)));
    expect(screen.getByTestId('process-card').dataset.suspended).toBe('yes');
  });

  it('тип процесса ещё грузится — тело пустое, в заголовке скелет', async () => {
    typesState.data = undefined;
    workflowState.data = undefined;
    render(processEntry(vi.fn()));
    await screen.findByTestId('unsaved-dialog');
    expect(screen.queryByTestId('process-card')).toBeNull();
    expect(screen.getByLabelText(ui.automation.typeSettings.title)).toBeTruthy();
  });

  it('тип проекта: тело — общая рабочая область; типа больше нет — карточка закрывается', async () => {
    const onClose = vi.fn();
    const view = render(entry('project-type', ID.project, onClose));
    expect((await screen.findByTestId('workspace')).dataset.id).toBe(ID.project);
    expect(screen.getByTestId('card-title').textContent).toContain('Договор');
    expect(onClose).not.toHaveBeenCalled();
    projectsState.data = [];
    act(() => view.rerender(entry('project-type', ID.project, onClose, false)));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('закрытие карточки с черновиком: «Уйти без публикации?» ДО схлопывания (#857)', () => {
  /** Запрос закрытия панели (X, Esc, клик мимо) — страж решает: `false` — спросить. */
  const guard = () => {
    if (!panel.closeGuard) throw new Error('панель не получила стража закрытия');
    let allowed = true;
    act(() => {
      allowed = panel.closeGuard!();
    });
    return allowed;
  };

  it('без черновика страж пропускает — вопроса нет', async () => {
    render(processEntry(vi.fn()));
    await screen.findByTestId('process-card');
    expect(guard()).toBe(true);
    expect(screen.getByTestId('unsaved-dialog').dataset.open).toBe('no');
  });

  it('с черновиком страж отклоняет закрытие и спрашивает; «Отмена» — карточка на месте, вопрос можно задать снова', async () => {
    routeState.dirty = true;
    render(processEntry(vi.fn()));
    await screen.findByTestId('process-card');
    expect(guard()).toBe(false);
    expect(screen.getByTestId('unsaved-dialog').dataset.open).toBe('yes');
    // X, Esc и клик мимо — тот же страж: пока вопрос открыт, закрытие не начинается.
    expect(guard()).toBe(false);
    act(() => screen.getByText('cancel').click());
    expect(screen.getByTestId('unsaved-dialog').dataset.open).toBe('no');
    expect(screen.getByTestId('card')).toBeTruthy();
    // После «Отмена» карточка не зависла: повторный запрос снова спрашивает.
    expect(guard()).toBe(false);
  });

  it('«Закрыть» (согласие уйти): панель закрывается СВОЕЙ хореографией — страж пропускает', async () => {
    routeState.dirty = true;
    render(processEntry(vi.fn()));
    await screen.findByTestId('process-card');
    expect(guard()).toBe(false);
    // Черновик остаётся на месте — кнопка обещает закрыть, а не «отменить изменения».
    expect(screen.getByTestId('unsaved-dialog').dataset.confirm).toBe(ui.common.close);
    expect(panel.closed).toBe(0);
    act(() => screen.getByText('discard').click());
    expect(screen.getByTestId('unsaved-dialog').dataset.open).toBe('no');
    // Не «вырвана из стека», а закрыта панелью: FLIP-схлопывание, затем onClose.
    expect(panel.closed).toBe(1);
    expect(guard()).toBe(true);
  });

  it('не верхняя карточка спит — редактора в ней нет, страж не спрашивает', async () => {
    routeState.dirty = true;
    render(processEntry(vi.fn(), false));
    expect((await screen.findByTestId('process-card')).dataset.suspended).toBe('yes');
    expect(guard()).toBe(true);
    expect(screen.getByTestId('unsaved-dialog').dataset.open).toBe('no');
  });
});
