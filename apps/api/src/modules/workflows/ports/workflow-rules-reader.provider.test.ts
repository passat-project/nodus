import { describe, expect, it, vi } from 'vitest';

import { WorkflowRulesReaderProvider } from './workflow-rules-reader.provider.js';

const row = (rules: unknown, intent = 'action') => ({
  workflowId: 'wf-1',
  transitionId: 'tr-1',
  fromStageId: null,
  toStageId: 'stage-1',
  toStageSystemState: 'closed',
  intent,
  rules,
});

const deciderRules = {
  conditions: [
    {
      kind: 'decider_in',
      source: { kind: 'employees', userIds: ['00000000-0000-4000-8000-0000000000a1'] },
    },
  ],
  validators: [],
  postFunctions: [],
};

describe('WorkflowRulesReaderProvider (#433)', () => {
  it('отдаёт переходы с decider_in, intent и целью', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [row(deciderRules)]) };
    const provider = new WorkflowRulesReaderProvider(prisma as never);
    await expect(provider.deciderTransitions('task')).resolves.toEqual([
      {
        workflowId: 'wf-1',
        transitionId: 'tr-1',
        fromStageId: null,
        toStageId: 'stage-1',
        toStageSystemState: 'closed',
        intent: 'action',
        sources: deciderRules.conditions.map((condition) => condition.source),
      },
    ]);
  });

  it('служебные кнопки помечаются service', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [row(deciderRules, 'service')]) };
    const provider = new WorkflowRulesReaderProvider(prisma as never);
    const [transition] = await provider.deciderTransitions('task');
    expect(transition?.intent).toBe('service');
  });

  it('битые правила пропускаются, чтение не падает', async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [row({ conditions: [{ kind: 'unknown' }] }), row(deciderRules)]),
    };
    const provider = new WorkflowRulesReaderProvider(prisma as never);
    const transitions = await provider.deciderTransitions('task');
    expect(transitions).toHaveLength(1);
  });
});
