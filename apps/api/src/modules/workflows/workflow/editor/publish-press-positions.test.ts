import { describe, expect, it } from 'vitest';
import type { WorkflowDocument } from '@nodus/contracts';

import { collectPositionIds } from './publish-checks.js';

const POS_DECIDER = '00000000-0000-4000-8000-0000000000e1';
const POS_PRESS = '00000000-0000-4000-8000-0000000000e2';

function document(): WorkflowDocument {
  return {
    stages: [],
    transitions: [
      {
        id: 't1',
        code: null,
        name: 'Завершить',
        fromStageId: 's1',
        toStageId: 's2',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        form: { enabled: false, sections: [] },
        rules: {
          conditions: [
            {
              kind: 'decider_in',
              source: { kind: 'position', positionId: POS_DECIDER, positionKind: 'management' },
            },
          ],
          validators: [],
          postFunctions: [],
        },
        press: {
          sources: [{ kind: 'position', positionId: POS_PRESS, positionKind: 'management' }],
          quorum: { kind: 'all' },
          order: 'parallel',
          excludeAuthor: true,
        },
      },
    ],
  } as WorkflowDocument;
}

describe('collectPositionIds (#433/#434)', () => {
  it('собирает должности решающих и источников сбора без дублей', () => {
    const doc = document();
    doc.transitions[0]!.press!.sources.push({
      kind: 'position',
      positionId: POS_DECIDER,
      positionKind: 'management',
    });
    expect(collectPositionIds(doc)).toEqual([POS_DECIDER, POS_PRESS]);
  });
});
