// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowDetail } from '@nodus/contracts';

import { createRouteDocStore } from './route-doc-store.js';

/** #633: действия в сторе документа — добавление, правка, удаление, откат. */
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';

const detail = (): WorkflowDetail => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  typeIds: ['00000000-0000-4000-8000-0000000000bb'],
  version: 1,
  publishedAt: null,
  publishedBy: null,
  document: {
    stages: [
      {
        id: S1,
        code: 'new',
        name: 'Ожидает',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: S2,
        code: 'in_progress',
        name: 'В работе',
        color: 'success',
        systemState: 'active',
        outcome: null,
        isInitial: false,
        sortOrder: 1,
      },
    ],
    transitions: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        code: null,
        name: 'Взять в работу',
        fromStageId: S1,
        toStageId: S2,
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [],
          postFunctions: [],
        },
        form: { enabled: false, sections: [] },
      },
    ],
  },
  stageEntityCounts: {},
});

function freshStore() {
  const store = createRouteDocStore('pending');
  store.getState().load(detail());
  return store;
}

describe('route-doc-store: действия маршрута (#633)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('addAction: действие у статуса, выделение, dirty и откат', () => {
    const store = freshStore();
    const id = store.getState().addAction(S2);

    const action = store.getState().document.actions?.find((a) => a.id === id);
    expect(action).toMatchObject({ stageId: S2, name: 'Новое действие', display: 'button' });
    expect(action?.rules.conditions).toHaveLength(1);
    expect(action?.form.enabled).toBe(true);
    expect(store.getState().selection).toEqual({ kind: 'action', id });
    expect(store.getState().dirty).toBe(true);

    store.getState().undo();
    expect(store.getState().document.actions ?? []).toHaveLength(0);
    expect(store.getState().dirty).toBe(false);
  });

  it('addAction(null) — действие «в любом статусе»', () => {
    const store = freshStore();
    const id = store.getState().addAction(null);
    expect(store.getState().document.actions?.find((a) => a.id === id)?.stageId).toBeNull();
  });

  it('patchAction меняет поля и помечает черновик изменённым', () => {
    const store = freshStore();
    const id = store.getState().addAction(S2);
    store.getState().patchAction(id, { name: 'Добавить замечание', display: 'menu' });

    const action = store.getState().document.actions?.find((a) => a.id === id);
    expect(action?.name).toBe('Добавить замечание');
    expect(action?.display).toBe('menu');
  });

  it('removeAction убирает действие из документа', () => {
    const store = freshStore();
    const id = store.getState().addAction(S2);
    store.getState().removeAction(id);
    expect(store.getState().document.actions ?? []).toHaveLength(0);
  });

  it('moveAction переставляет порядок действий внутри статуса', () => {
    const store = freshStore();
    const first = store.getState().addAction(S2);
    const second = store.getState().addAction(S2);
    store.getState().moveAction(second, 0);

    const order = (store.getState().document.actions ?? [])
      .filter((a) => a.stageId === S2)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a) => a.id);
    expect(order).toEqual([second, first]);
  });

  it('setActionPrimary: прежнее главное действие статуса становится кнопкой', () => {
    const store = freshStore();
    const first = store.getState().addAction(S2);
    const other = store.getState().addAction(S1);
    store.getState().setActionPrimary(first);
    const second = store.getState().addAction(S2);
    store.getState().setActionPrimary(second);

    const byId = new Map((store.getState().document.actions ?? []).map((a) => [a.id, a]));
    expect(byId.get(second)?.display).toBe('primary');
    expect(byId.get(first)?.display).toBe('button');
    // У другого статуса главное действие не тронуто.
    expect(byId.get(other)?.display).toBe('button');
  });

  it('load сохраняет опубликованные действия в рабочей копии (#633)', () => {
    const store = createRouteDocStore('pending');
    const base = detail();
    const action = {
      id: '00000000-0000-4000-8000-0000000000cc',
      code: null,
      name: 'Запросить уточнение',
      stageId: S2,
      display: 'button' as const,
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in' as const, roles: ['assignee' as const] }],
        validators: [],
        postFunctions: [],
      },
      form: { enabled: true, sections: [] },
      steps: [],
    };
    store.getState().load({
      ...base,
      document: { ...base.document, actions: [action] },
    });

    const loaded = store.getState().document.actions ?? [];
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('Запросить уточнение');
    // Раздел документа, а не правка: загрузка не делает черновик грязным.
    expect(store.getState().dirty).toBe(false);
  });
});
