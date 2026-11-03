// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowDetail } from '@nodus/contracts';

import { createRouteDocStore } from './route-doc-store.js';
import { draftKey } from './route-draft-storage.js';
import { isLayoutComplete, resolveRoute } from '../../../shared/flow/route-resolve.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';

const stage = (
  n: number,
  code: string,
  name: string,
  color: 'neutral' | 'success' | 'info',
  systemState: 'backlog' | 'active' | 'closed',
) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  code,
  name,
  color,
  systemState,
  outcome: systemState === 'closed' ? ('success' as const) : null,
  isInitial: n === 1,
  sortOrder: 0,
});

const detail = (): WorkflowDetail => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  typeIds: ['00000000-0000-4000-8000-0000000000bb'],
  version: 3,
  publishedAt: '2026-10-18T14:05:00Z',
  publishedBy: null,
  document: {
    stages: [
      stage(1, 'new', 'Ожидает', 'neutral', 'backlog'),
      stage(2, 'in_progress', 'В работе', 'success', 'active'),
      stage(3, 'done', 'Завершена', 'info', 'closed'),
    ],
    transitions: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        code: 'start',
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

/** Тот же маршрут, но с ГЛОБАЛЬНОЙ нумерацией сортировки — так отдаёт
 *  сервер (system-catalog: sortOrder = index по всем статусам). Клиент после
 *  правок нумерует группы заново — источник ложного dirty (#409). */
function detailWithGlobalOrder(): WorkflowDetail {
  const base = detail();
  return {
    ...base,
    document: {
      ...base.document,
      stages: base.document.stages.map((s, index) => ({ ...s, sortOrder: index })),
      transitions: [
        { ...base.document.transitions[0]!, sortOrder: 0 },
        {
          ...base.document.transitions[0]!,
          id: '00000000-0000-4000-8000-000000000012',
          code: null,
          name: 'Отклонить',
          fromStageId: S2,
          toStageId: S3,
          display: 'button',
          intent: 'action',
          sortOrder: 2,
        },
      ],
    },
  };
}

function saveDraft(detailValue: WorkflowDetail, sortOrderOf: (index: number) => number): void {
  localStorage.setItem(
    draftKey(detailValue.id),
    JSON.stringify({
      document: {
        ...detailValue.document,
        stages: detailValue.document.stages.map((s, i) => ({ ...s, sortOrder: sortOrderOf(i) })),
        transitions: detailValue.document.transitions.map((t, i) => ({
          ...t,
          sortOrder: sortOrderOf(i),
        })),
      },
      baseVersion: detailValue.version,
      savedAt: new Date().toISOString(),
    }),
  );
}

function freshStore() {
  const store = createRouteDocStore('pending');
  store.getState().load(detail());
  return store;
}

describe('route-doc-store: рабочая копия маршрута (#378)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('добавление статуса и undo/redo', () => {
    const store = freshStore();
    const id = store.getState().addStage('paused');
    expect(store.getState().document.stages.some((s) => s.id === id)).toBe(true);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().selection).toEqual({ kind: 'stage', id });

    store.getState().undo();
    expect(store.getState().document.stages.length).toBe(3);
    expect(store.getState().dirty).toBe(false);

    store.getState().redo();
    expect(store.getState().document.stages.length).toBe(4);
  });

  it('соединение портов создаёт кнопку; петля в свой статус отвергается', () => {
    const store = freshStore();
    const created = store.getState().addTransition(S2, S3);
    expect(created).not.toBeNull();
    expect(store.getState().document.transitions.length).toBe(2);

    const loop = store.getState().addTransition(S2, S2);
    expect(loop).toBeNull();
  });

  it('удаление статуса сносит его кнопки', () => {
    const store = freshStore();
    store.getState().removeStage(S1);
    expect(store.getState().document.transitions.length).toBe(0);
  });

  it('включение начального переносит флаг с прежнего', () => {
    const store = freshStore();
    store.getState().patchStage(S2, { isInitial: true });
    const initials = store.getState().document.stages.filter((s) => s.isInitial);
    expect(initials.map((s) => s.id)).toEqual([S2]);
  });

  it('setTransitionPrimary: прежняя главная статуса становится «Видна»', () => {
    const store = freshStore();
    store.getState().addTransition(S1, S3);
    const doc = store.getState().document;
    const newId = doc.transitions[1]!.id;
    store.getState().setTransitionPrimary(newId);
    const after = store.getState().document.transitions;
    expect(after.find((t) => t.id === newId)!.display).toBe('primary');
    expect(after.find((t) => t.code === 'start')!.display).toBe('button');
  });

  it('черновик переживает перезагрузку той же версии и сбрасывается discard', () => {
    const store = freshStore();
    store.getState().addStage('paused');
    const reloaded = createRouteDocStore('pending');
    reloaded.getState().load(detail());
    expect(reloaded.getState().document.stages.length).toBe(4);
    expect(reloaded.getState().dirty).toBe(true);

    reloaded.getState().discard();
    expect(reloaded.getState().document.stages.length).toBe(3);
    expect(reloaded.getState().dirty).toBe(false);
  });

  it('две публикации подряд: после первой документ перечитывается с сервера, new:* не повторяются', () => {
    const store = freshStore();
    const added = store.getState().addStage('paused');
    expect(added.startsWith('new:')).toBe(true);

    store.getState().markPublished();
    expect(store.getState()).toMatchObject({ pendingReload: true, dirty: false, baseVersion: 3 });
    expect(localStorage.length).toBe(0);
    // Ответ той же версии (рефетч ещё не догнал) — документ не трогаем.
    store.getState().sync(detail());
    expect(store.getState().pendingReload).toBe(true);

    // Свежая версия сервера: постоянные id вместо new:*, правки снова открыты.
    const fresh = detail();
    fresh.version = 4;
    fresh.document.stages.push({
      ...fresh.document.stages[1]!,
      id: '00000000-0000-4000-8000-000000000004',
      code: null,
      name: 'Новый статус',
      systemState: 'paused',
      color: 'neutral',
    });
    store.getState().sync(fresh);
    const state = store.getState();
    expect(state).toMatchObject({ pendingReload: false, dirty: false, baseVersion: 4 });
    expect(state.document.stages.some((s) => s.id.startsWith('new:'))).toBe(false);
    expect(state.staleDraftAt).toBeNull();

    // Вторая правка и публикация уходят от версии 4 с id сервера.
    store.getState().patchStage('00000000-0000-4000-8000-000000000004', { name: 'Ждёт ответа' });
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().baseVersion).toBe(4);
  });

  it('холст: соединение точек, перенос конца, подпись и позиция — шагами истории', () => {
    const store = freshStore();
    const id = store
      .getState()
      .connect({ source: S2, target: S3, sourceHandle: 'r1', targetHandle: 'l3' })!;
    // Точки — те, к которым подключили; подпись встала на свободное место.
    expect(store.getState().document.layout?.transitions[id]).toMatchObject({
      sourceHandle: 'r1',
      targetHandle: 'l3',
    });
    expect(store.getState().document.layout?.transitions[id]?.labelT).toBeTypeOf('number');
    expect(store.getState().connect({ source: S2, target: S2 })).toBeNull();

    store
      .getState()
      .reconnect(id, { source: S1, target: S3, sourceHandle: 'b2', targetHandle: 'b1' });
    const moved = store.getState().document.transitions.find((t) => t.id === id)!;
    expect(moved.fromStageId).toBe(S1);
    expect(store.getState().document.layout?.transitions[id]).toMatchObject({ sourceHandle: 'b2' });

    store.getState().setLabelT(id, 0.25);
    store.getState().setStagePosition(S3, { x: 640.4, y: 120.6 });
    expect(store.getState().document.layout?.stages[S3]).toEqual({ x: 640, y: 121 });
    expect(store.getState().document.layout?.transitions[id]?.labelT).toBe(0.25);

    store.getState().undo();
    expect(store.getState().document.layout?.stages[S3]).not.toEqual({ x: 640, y: 121 });
    expect(store.getState().dirty).toBe(true);
  });

  it('перетаскивание одного статуса не двигает остальные и не перестраивает стрелки', () => {
    const store = freshStore();
    const before = resolveRoute(store.getState().document);
    store.getState().setStagePosition(S2, { x: 900, y: 500 });
    const after = resolveRoute(store.getState().document);
    expect(after.positions.get(S2)).toEqual({ x: 900, y: 500 });
    // Остальные статусы стоят, где стояли (видимая авторасстановка зафиксирована).
    expect(after.positions.get(S1)).toEqual(before.positions.get(S1));
    // Точки всех стрелок — те же, что были до перетаскивания.
    for (const [id, handles] of before.handles) expect(after.handles.get(id)).toEqual(handles);
    expect(isLayoutComplete(store.getState().document)).toBe(true);

    // «Упорядочить» — единственный путь обратно к авторасстановке.
    store.getState().arrange();
    expect(store.getState().document.layout?.transitions).toEqual({});
    expect(resolveRoute(store.getState().document).positions.get(S2)).toEqual(
      before.positions.get(S2),
    );
  });

  it('участок стрелки отодвинули (#395): сдвиг — в раскладке и пути, отмена; перенос конца сбрасывает', () => {
    const store = freshStore();
    const id = '00000000-0000-4000-8000-000000000011';
    store.getState().setEdgeBend(id, 'shift', 30.4);
    expect(resolveRoute(store.getState().document).spread.get(id)?.shift).toBe(30);

    store.getState().setEdgeBend(id, 'shift', null);
    expect(store.getState().document.layout?.transitions[id]?.shift).toBeUndefined();
    store.getState().undo();
    expect(store.getState().document.layout?.transitions[id]?.shift).toBe(30);

    store
      .getState()
      .reconnect(id, { source: S1, target: S3, sourceHandle: 'b2', targetHandle: 't2' });
    expect(store.getState().document.layout?.transitions[id]?.shift).toBeUndefined();
  });

  it('ввод названия подряд — один шаг отмены, а не «по букве»', () => {
    const store = freshStore();
    const before = store.getState().past.length;
    for (const name of ['В', 'В р', 'В раб', 'В работе!'])
      store.getState().patchStage(S2, { name });
    expect(store.getState().past.length).toBe(before + 1);
    store.getState().undo();
    expect(store.getState().document.stages.find((s) => s.id === S2)?.name).toBe('В работе');
  });

  it('«из любого статуса»: переключатель статуса, у кнопки меняется только цель', () => {
    const store = freshStore();
    store.getState().toggleAny(S3, true);
    const any = store.getState().document.transitions.find((t) => t.fromStageId === null)!;
    expect(any).toMatchObject({ toStageId: S3, name: 'Завершена' });
    store.getState().setAnyAnchor(any.id, { x: 100, y: 40 });

    store.getState().reconnect(any.id, { source: `any:${any.id}`, target: S2, targetHandle: 't2' });
    const moved = store.getState().document.transitions.find((t) => t.id === any.id)!;
    expect(moved).toMatchObject({ fromStageId: null, toStageId: S2 });

    store.getState().toggleAny(S2, false);
    expect(store.getState().document.transitions.some((t) => t.fromStageId === null)).toBe(false);
    expect(store.getState().document.layout?.transitions[any.id]).toBeUndefined();
  });

  it('удаление статуса сносит его кнопки и их раскладку; «Упорядочить» пишет позиции всех', () => {
    const store = freshStore();
    store.getState().setLabelT('00000000-0000-4000-8000-000000000011', 0.8);
    store.getState().removeElements([S1], []);
    expect(store.getState().document.transitions).toHaveLength(0);
    expect(store.getState().document.layout?.transitions).toEqual({});

    store.getState().arrange();
    expect(Object.keys(store.getState().document.layout?.stages ?? {})).toContain(S2);
  });

  it('черновик v1 с ручными позициями переносится в раскладку документа', () => {
    const first = detail();
    localStorage.setItem(
      `nodus-workflow-draft-v1:${first.id}`,
      JSON.stringify({
        document: first.document,
        baseVersion: first.version,
        savedAt: '2026-10-20T10:00:00Z',
        positions: { [S2]: { x: 333, y: 44 } },
      }),
    );
    const store = createRouteDocStore('pending');
    store.getState().load(first);
    expect(store.getState().document.layout?.stages[S2]).toEqual({
      x: 333,
      y: 44,
    });
    // Только расстановка — не правка маршрута: публиковать нечего, её
    // отправит автосохранение.
    expect(store.getState().dirty).toBe(false);
  });

  it('расстановка — не черновик маршрута: перетаскивание не делает dirty, правка — делает', () => {
    const store = freshStore();
    store.getState().setStagePosition(S2, { x: 500, y: 90 });
    expect(store.getState().dirty).toBe(false);
    store.getState().patchStage(S2, { name: 'Иначе' });
    expect(store.getState().dirty).toBe(true);
    // Отмена правки имени — снова не dirty, хотя расстановка осталась новой.
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().document.layout?.stages[S2]).toEqual({ x: 500, y: 90 });
  });

  it('чужая сохранённая расстановка (та же версия) приходит в открытый редактор, свои неотправленные места остаются', () => {
    const store = freshStore();
    const mine = S2;
    // Первая правка зафиксировала картинку и ушла автосохранением…
    store.getState().setStagePosition(mine, { x: 300, y: 90 });
    store.getState().markLayoutSaved(store.getState().document.layout!);
    // …следующее перемещение ещё не отправлено.
    store.getState().setStagePosition(mine, { x: 500, y: 90 });
    const own = store.getState().document.layout!;
    // Сервер: кто-то другой переставил остальные статусы (своё место ещё не ушло).
    const server = {
      stages: Object.fromEntries(
        Object.keys(own.stages).map((id) => [id, id === mine ? { x: 1, y: 1 } : { x: 7, y: 7 }]),
      ),
      transitions: {},
    };
    const base = detail();
    store.getState().sync({ ...base, document: { ...base.document, layout: server } });
    const layout = store.getState().document.layout!;
    expect(layout.stages[mine]).toEqual({ x: 500, y: 90 });
    for (const id of Object.keys(own.stages)) {
      if (id !== mine) expect(layout.stages[id]).toEqual({ x: 7, y: 7 });
    }
    expect(store.getState().baseline.layout).toEqual(server);
    expect(store.getState().dirty).toBe(false);
  });

  it('сохранённая расстановка — новая точка «Сбросить»', () => {
    const store = freshStore();
    const id = S2;
    store.getState().setStagePosition(id, { x: 500, y: 90 });
    store.getState().markLayoutSaved(store.getState().document.layout!);
    store.getState().patchStage(id, { name: 'Иначе' });
    store.getState().discard();
    expect(store.getState().document.layout?.stages[id]).toEqual({ x: 500, y: 90 });
    expect(store.getState().document.stages.find((s) => s.id === id)?.name).not.toBe('Иначе');
  });

  it('устаревший черновик (версия ушла) не подхватывается', () => {
    const store = freshStore();
    store.getState().addStage('paused');
    const next = { ...detail(), version: 4 };
    const reloaded = createRouteDocStore('pending');
    reloaded.getState().load(next);
    expect(reloaded.getState().document.stages.length).toBe(3);
    expect(reloaded.getState().dirty).toBe(false);
  });

  it('серверный глобальный sortOrder + групповой черновик — НЕ dirty при входе (#409)', () => {
    const base = detailWithGlobalOrder();
    // Черновик клиента: та же структура, но нумерация групповая (0,0,0) —
    // визуально ничего не изменилось, и «есть изменения» показывать нельзя.
    saveDraft(base, () => 0);

    const store = createRouteDocStore('pending');
    store.getState().load(base);

    expect(store.getState().dirty).toBe(false);
    expect(store.getState().document.stages.map((s) => s.sortOrder)).toEqual([0, 0, 0]);
  });

  it('правка имени и возврат к исходному — НЕ dirty (канонизация stage/button)', () => {
    const store = createRouteDocStore('pending');
    store.getState().load(detailWithGlobalOrder());

    store.getState().patchStage(S2, { name: 'Иначе' });
    expect(store.getState().dirty).toBe(true);

    store.getState().patchStage(S2, { name: 'В работе' });
    expect(store.getState().dirty).toBe(false);
  });

  it('реальная структурная правка остаётся dirty после канонизации', () => {
    const store = createRouteDocStore('pending');
    store.getState().load(detailWithGlobalOrder());
    store.getState().addStage('paused');
    expect(store.getState().dirty).toBe(true);
  });
});
