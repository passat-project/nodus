import { describe, expect, it } from 'vitest';
import type { WorkflowDraftDocument, WorkflowLayout } from '@nodus/contracts';

import { resolveRoute } from '../../../shared/flow/route-resolve.js';
import { labelBoxAt, labelCost, labelWidth } from '../../../shared/flow/route-labels.js';
import {
  adoptSavedLayout,
  freezeLayout,
  layoutFingerprint,
  persistedLayout,
  settleLabels,
  settleLoops,
} from './route-doc-layout.js';
import { setStagePosition } from './route-doc-ops.js';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const rules = { conditions: [], validators: [], postFunctions: [] };

const stage = (id: string, name: string, isInitial = false) => ({
  id,
  code: null,
  name,
  color: 'neutral' as const,
  systemState: 'active' as const,
  outcome: null,
  isInitial,
  sortOrder: 0,
});
const back = (id: string, from: string, sortOrder: number) => ({
  id,
  code: null,
  name: `Вернуть ${sortOrder}`,
  fromStageId: from,
  toStageId: A,
  display: 'button' as const,
  intent: 'action' as const,
  sortOrder,
  rules,
  form: { enabled: false, sections: [] },
});

/** A — B — C в ряд, две обратные стрелки в A понизу (U-обходы). */
const doc = (layout?: WorkflowLayout): WorkflowDraftDocument => ({
  stages: [stage(A, 'А', true), stage(B, 'Б'), stage(C, 'В')],
  transitions: [back('ba', B, 0), back('ca', C, 1)],
  ...(layout ? { layout } : {}),
});
const pinned: WorkflowLayout = {
  stages: { [A]: { x: 0, y: 0 }, [B]: { x: 400, y: 0 }, [C]: { x: 800, y: 0 } },
  transitions: {
    ba: { sourceHandle: 'b1', targetHandle: 'b1', offset: 24 },
    ca: { sourceHandle: 'b3', targetHandle: 'b3', offset: 40 },
  },
};

describe('route-doc-ops: «что видишь — то и стоит» (#378 ред. 2)', () => {
  it('первая правка фиксирует всю видимую картинку: позиции, точки, глубины', () => {
    const fresh = doc();
    const before = resolveRoute(fresh);
    const next = freezeLayout(fresh, setStagePosition(fresh, B, { x: 500, y: 300 }));
    const after = resolveRoute(next);
    expect(after.positions.get(B)).toEqual({ x: 500, y: 300 });
    expect(after.positions.get(A)).toEqual(before.positions.get(A));
    expect(after.positions.get(C)).toEqual(before.positions.get(C));
    for (const [id, h] of before.handles) expect(after.handles.get(id)).toEqual(h);
    for (const id of before.loops.keys()) {
      expect(next.layout?.transitions[id]?.offset).toBe(before.spread.get(id)!.offset);
    }
  });

  it('сдвинутый обход держит глубину, чужой обход не меняется никогда', () => {
    const prev = doc(pinned);
    const next = settleLoops(prev, setStagePosition(prev, C, { x: 800, y: 300 }));
    expect(next.layout?.transitions.ca?.offset).toBe(40);
    expect(next.layout?.transitions.ba).toEqual(pinned.transitions.ba);
  });

  it('сдвинутый обход при наложении уходит глубже — сосед остаётся на месте', () => {
    const prev = doc({
      ...pinned,
      transitions: { ...pinned.transitions, ca: { ...pinned.transitions.ca, offset: 56 } },
    });
    // C сдвинули так, что линия его обхода легла на линию обхода B → A.
    const next = settleLoops(prev, setStagePosition(prev, C, { x: 800, y: -32 }));
    expect(next.layout?.transitions.ba?.offset).toBe(24);
    const depth = resolveRoute(next);
    const ba = depth.loops.get('ba')!;
    const ca = depth.loops.get('ca')!;
    expect(Math.abs(ca.base + depth.spread.get('ca')!.offset - (ba.base + 24))).toBeGreaterThan(11);
  });
});

describe('route-doc-layout: подписи и автосохранение (#378 ред. 2)', () => {
  it('статус положили на подпись чужой стрелки — подпись уходит на свободное место своей стрелки', () => {
    const base = freezeLayout(doc(pinned), setStagePosition(doc(pinned), A, { x: 0, y: 0 }));
    const route = resolveRoute(base);
    const victim = base.transitions.find((t) => t.id === 'ca')!;
    const box = labelBoxAt(
      route.paths.get('ca')!,
      route.labels.get('ca')!,
      labelWidth(victim.name),
    );
    // B кладём ровно на подпись «ca».
    const moved = setStagePosition(base, B, { x: box.x, y: box.y - 15 });
    const next = settleLabels(base, moved);
    const after = resolveRoute(next);
    const nodes = after.nodeBoxes;
    const label = labelBoxAt(
      after.paths.get('ca')!,
      after.labels.get('ca')!,
      labelWidth(victim.name),
    );
    expect(labelCost(label, nodes)).toBe(0);
  });

  it('несдвинутые стрелки держат подписи на месте', () => {
    const base = freezeLayout(doc(pinned), setStagePosition(doc(pinned), A, { x: 0, y: 0 }));
    const next = settleLabels(base, setStagePosition(base, C, { x: 820, y: 0 }));
    expect(next.layout?.transitions.ba?.labelT).toBe(base.layout?.transitions.ba?.labelT);
  });

  it('после шага в документе — картинка без наездов (данные = холст)', () => {
    const base = freezeLayout(doc(pinned), setStagePosition(doc(pinned), A, { x: 0, y: 0 }));
    // C подвинули под стрелки соседей — подписи могли бы лечь друг на друга.
    const next = settleLabels(base, setStagePosition(base, C, { x: 420, y: 60 }));
    const route = resolveRoute(next);
    const boxes = next.transitions.map((t) =>
      labelBoxAt(
        route.paths.get(t.id)!,
        next.layout!.transitions[t.id]!.labelT!,
        labelWidth(t.name),
      ),
    );
    boxes.forEach((box, i) => {
      const others = boxes.filter((_, j) => j !== i);
      expect(labelCost(box, [...route.nodeBoxes, ...others])).toBe(0);
    });
  });

  it('автосохранение: места опубликованных элементов; новые — с публикацией', () => {
    const baseline = doc(pinned);
    const draft: WorkflowDraftDocument = {
      ...baseline,
      stages: [...baseline.stages, stage('new:x', 'Новый')],
      layout: {
        stages: { ...pinned.stages, [B]: { x: 444, y: 10 }, 'new:x': { x: 1, y: 1 } },
        transitions: pinned.transitions,
      },
    };
    const out = persistedLayout(draft, baseline);
    expect(out.stages[B]).toEqual({ x: 444, y: 10 });
    expect(out.stages['new:x']).toBeUndefined();
    expect(Object.keys(out.transitions)).toEqual(['ba', 'ca']);
  });

  it('чужая расстановка: записи сервера — кроме изменённых здесь и ещё не отправленных', () => {
    const prev: WorkflowLayout = {
      stages: { [A]: { x: 0, y: 0 }, [B]: { x: 400, y: 0 } },
      transitions: {},
    };
    const own: WorkflowLayout = {
      stages: { [A]: { x: 0, y: 0 }, [B]: { x: 444, y: 4 }, 'new:x': { x: 9, y: 9 } },
      transitions: {},
    };
    const server: WorkflowLayout = {
      stages: { [A]: { x: 50, y: 50 }, [B]: { x: 1, y: 1 }, [C]: { x: 800, y: 0 } },
      transitions: { t: { labelT: 0.3 } },
    };
    const out = adoptSavedLayout(own, prev, server);
    expect(out.stages[A]).toEqual({ x: 50, y: 50 });
    expect(out.stages[B]).toEqual({ x: 444, y: 4 });
    expect(out.stages[C]).toEqual({ x: 800, y: 0 });
    expect(out.stages['new:x']).toEqual({ x: 9, y: 9 });
    expect(out.transitions.t).toEqual({ labelT: 0.3 });
  });

  it('отпечаток раскладки не зависит от порядка ключей (jsonb их переставляет)', () => {
    const a: WorkflowLayout = {
      stages: { [A]: { x: 1, y: 2 } },
      transitions: { t: { labelT: 0.5, sourceHandle: 'r1' } },
    };
    const b: WorkflowLayout = {
      transitions: { t: { sourceHandle: 'r1', labelT: 0.5 } },
      stages: { [A]: { y: 2, x: 1 } },
    };
    expect(layoutFingerprint(a)).toBe(layoutFingerprint(b));
  });
});
