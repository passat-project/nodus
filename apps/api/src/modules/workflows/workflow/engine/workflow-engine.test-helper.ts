import { expect, vi } from 'vitest';

import type {
  WorkflowActorSubject,
  WorkflowEntityStage,
  WorkflowFormApplied,
} from '../../../../core/ports/workflow-entity.port.js';
import { WorkflowEngine } from './workflow-engine.js';
import type { TransitionDef } from '../transition-rules.js';
import { parseRules } from '../transition-rules.js';
import { parseForm } from '../transition-form.js';
import { gateFacts } from '../gate-facts.test-helper.js';

export const TX = { tx: true } as never;
export const ACTIVE = '00000000-0000-4000-8000-000000000001';
export const REVIEW = '00000000-0000-4000-8000-000000000002';
export const DONE = '00000000-0000-4000-8000-000000000003';
export const USER = { id: 'bob', permissions: [] as string[] };

export const stage = (id: string, name: string, systemState: string) => ({
  id,
  code: null,
  name,
  systemState,
  archivedAt: null,
  workflowId: 'wf',
  color: 'neutral',
  sortOrder: 0,
  isInitial: false,
  outcome: systemState === 'closed' ? 'success' : null,
});

export const facts = gateFacts({ assigneeId: 'bob' });

export function transition(partial: Partial<TransitionDef>): TransitionDef {
  return {
    id: 'tr',
    name: 'Завершить',
    fromStageId: ACTIVE,
    toStageId: DONE,
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['assignee'] }] }),
    form: parseForm({}),
    ...partial,
  };
}

export function setup(
  transitions: TransitionDef[],
  subjectFacts: () => typeof facts = () => facts,
) {
  const order: string[] = [];
  let applied = false;
  const workflow = {
    id: 'wf',
    stages: [
      stage(ACTIVE, 'В работе', 'active'),
      stage(REVIEW, 'На утверждении', 'done'),
      stage(DONE, 'Завершена', 'closed'),
    ],
    transitions,
  };
  const adapter = {
    lock: vi.fn(async () => void order.push('lock')),
    subject: vi.fn(async (): Promise<WorkflowActorSubject> => {
      order.push('subject');
      return {
        workflowId: 'wf',
        typeId: 'type',
        stageId: ACTIVE,
        roles: new Set(['assignee']),
        bypassConditions: false,
        canOverrideGates: false,
        actsWithoutConditions: true,
        facts: subjectFacts(),
      };
    }),
    applyForm: vi.fn(async (): Promise<WorkflowFormApplied> => {
      order.push('applyForm');
      applied = true;
      return {
        fields: { description: { from: '', to: 'заполнено' } },
        timeEntryId: null,
        result: null,
      };
    }),
    applyStage: vi.fn(async (_tx, _id, target: WorkflowEntityStage) => {
      order.push('applyStage');
      expect(target.id).toBe(DONE);
    }),
    applyLocks: vi.fn(async () => void 0),
  };
  const workflows = { load: vi.fn(async () => workflow) };
  const records = { insert: vi.fn(async () => void order.push('journal')) };
  const engine = new WorkflowEngine(
    workflows as never,
    { get: () => adapter } as never,
    records as never,
    { nextForType: vi.fn() } as never,
    { plan: vi.fn(async () => ({ ok: true, issue: async () => ({}) })) } as never,
  );
  return { engine, adapter, records, order, wasApplied: () => applied };
}
