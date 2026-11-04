import { describe, expect, it } from 'vitest';
import type { WorkflowDraftDocument } from '@nodus/contracts';

import { START_EDGE_ID, START_NODE_ID, anyNodeId, buildRouteGraph } from './route-graph.js';
import { ROUTE_GEOMETRY } from './route-layout.js';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';

const rules = { conditions: [], validators: [], postFunctions: [] };

const doc = (layout?: WorkflowDraftDocument['layout']): WorkflowDraftDocument => ({
  stages: [
    {
      id: A,
      code: null,
      name: 'Ожидает',
      color: 'neutral',
      systemState: 'backlog',
      outcome: null,
      isInitial: true,
      sortOrder: 0,
    },
    {
      id: B,
      code: null,
      name: 'В работе',
      color: 'success',
      systemState: 'active',
      outcome: null,
      isInitial: false,
      sortOrder: 0,
    },
    {
      id: C,
      code: null,
      name: 'Отменена',
      color: 'danger',
      systemState: 'closed',
      outcome: 'cancelled',
      isInitial: false,
      sortOrder: 0,
    },
  ],
  transitions: [
    {
      id: 't-start',
      code: null,
      name: 'Взять в работу',
      fromStageId: A,
      toStageId: B,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules,
      form: { enabled: false, sections: [] },
    },
    {
      id: 't-cancel',
      code: null,
      name: 'Отменить',
      fromStageId: null,
      toStageId: C,
      display: 'menu',
      intent: 'action',
      sortOrder: 1,
      rules,
      form: { enabled: false, sections: [] },
    },
  ],
  ...(layout ? { layout } : {}),
});

describe('route-graph: холст из документа (#378 ред. 2)', () => {
  it('старт «Создание задачи» — на линии центра начального статуса, стрелка в l2', () => {
    const { nodes, edges } = buildRouteGraph(
      doc({ stages: { [A]: { x: 300, y: 200 } }, transitions: {} }),
      { readOnly: false },
    );
    const start = nodes.find((n) => n.id === START_NODE_ID)!;
    const initial = nodes.find((n) => n.id === A)!;
    expect(start.position.y + ROUTE_GEOMETRY.startHeight / 2).toBe(
      initial.position.y + ROUTE_GEOMETRY.stageHeight / 2,
    );
    expect(edges.find((e) => e.id === START_EDGE_ID)).toMatchObject({
      targetHandle: 'l2',
      target: A,
    });
  });

  it('сохранённые позиции и точки — закон; подпись — в своей доле стрелки', () => {
    const { nodes, edges } = buildRouteGraph(
      doc({
        stages: { [A]: { x: 10, y: 20 }, [B]: { x: 600, y: 20 }, [C]: { x: 10, y: 500 } },
        transitions: { 't-start': { sourceHandle: 'b3', targetHandle: 't1', labelT: 0.3 } },
      }),
      { readOnly: false },
    );
    expect(nodes.find((n) => n.id === B)!.position).toEqual({ x: 600, y: 20 });
    expect(edges.find((e) => e.id === 't-start')).toMatchObject({
      sourceHandle: 'b3',
      targetHandle: 't1',
      data: { labelT: 0.3 },
    });
  });

  it('сохранённое место подписи занято статусом — подпись на ближайшем свободном месте своей стрелки', () => {
    // C стоит ровно там, где на стрелке «Взять в работу» сохранена подпись (0.3).
    const { edges } = buildRouteGraph(
      doc({
        stages: { [A]: { x: 10, y: 20 }, [B]: { x: 600, y: 20 }, [C]: { x: 250, y: 60 } },
        transitions: { 't-start': { sourceHandle: 'b3', targetHandle: 't1', labelT: 0.3 } },
      }),
      { readOnly: false },
    );
    const labelT = (edges.find((e) => e.id === 't-start')!.data as { labelT: number }).labelT;
    expect(labelT).not.toBe(0.3);
  });

  it('кнопка из любого статуса — метка «Любой статус» со стрелкой; у неё меняется только цель', () => {
    const { nodes, edges } = buildRouteGraph(doc(), { readOnly: false });
    expect(nodes.find((n) => n.id === anyNodeId('t-cancel'))).toMatchObject({ type: 'any' });
    expect(edges.find((e) => e.id === 't-cancel')).toMatchObject({
      source: anyNodeId('t-cancel'),
      target: C,
      reconnectable: 'target',
    });
  });

  it('выделенная кнопка — стрелка и метка подсвечены; просмотр — всё статично', () => {
    const selected = buildRouteGraph(doc(), {
      readOnly: false,
      selection: { kind: 'transition', id: 't-cancel' },
    });
    expect(selected.edges.find((e) => e.id === 't-cancel')).toMatchObject({ selected: true });
    expect(selected.nodes.find((n) => n.id === anyNodeId('t-cancel'))).toMatchObject({
      selected: true,
    });

    expect(selected.nodes.find((n) => n.id === anyNodeId('t-cancel'))!.data).toMatchObject({
      portSelected: true,
    });
    const target = selected.nodes.find((n) => n.id === C)!.data as { selectedPorts: string[] };
    expect(target.selectedPorts).toEqual([
      selected.edges.find((e) => e.id === 't-cancel')!.targetHandle,
    ]);
    expect(selected.nodes.find((n) => n.id === A)!.data).toMatchObject({ selectedPorts: [] });

    const view = buildRouteGraph(doc(), { readOnly: true });
    expect(view.nodes.every((n) => n.draggable === false)).toBe(true);
    expect(view.edges.every((e) => e.reconnectable === false)).toBe(true);
  });
});
