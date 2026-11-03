import { describe, expect, it } from 'vitest';
import type { WorkflowDocument } from '@nodus/contracts';

import { resolvePublishedDocument } from './publish-resolve.js';

const OLD = '00000000-0000-4000-8000-000000000001';

describe('resolvePublishedDocument — мок публикации как сервер (#378)', () => {
  it('new:* получают постоянные id; ссылки, route_if, раскладка и переносы переписаны', () => {
    const document: WorkflowDocument = {
      stages: [
        {
          id: OLD,
          code: null,
          name: 'В работе',
          color: 'success',
          systemState: 'active',
          outcome: null,
          isInitial: true,
          sortOrder: 0,
        },
        {
          id: 'new:a',
          code: null,
          name: 'Готово',
          color: 'info',
          systemState: 'closed',
          outcome: 'success',
          isInitial: false,
          sortOrder: 0,
        },
      ],
      transitions: [
        {
          id: 'new:t',
          code: null,
          name: 'Завершить',
          fromStageId: OLD,
          toStageId: 'new:a',
          display: 'primary',
          intent: 'action',
          sortOrder: 0,
          rules: {
            conditions: [],
            validators: [],
            postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: 'new:a' }],
          },
          form: { enabled: false, sections: [] },
        },
      ],
      layout: { stages: { 'new:a': { x: 10, y: 20 } }, transitions: { 'new:t': { labelT: 0.3 } } },
    };
    let seq = 0;
    const nextId = () => `40000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`;
    const { document: out, migrations } = resolvePublishedDocument(
      document,
      [{ fromStageId: OLD, toStageId: 'new:a' }],
      nextId,
    );
    const stageId = out.stages[1]!.id;
    const transition = out.transitions[0]!;
    expect(stageId.startsWith('new:')).toBe(false);
    expect(out.stages[0]!.id).toBe(OLD);
    expect(transition.toStageId).toBe(stageId);
    expect(transition.rules.postFunctions[0]).toMatchObject({ toStageId: stageId });
    expect(out.layout?.stages[stageId]).toEqual({ x: 10, y: 20 });
    expect(out.layout?.transitions[transition.id]).toEqual({ labelT: 0.3 });
    expect(migrations).toEqual([{ fromStageId: OLD, toStageId: stageId }]);
  });
});
