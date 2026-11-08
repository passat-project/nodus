import { describe, expect, it, vi } from 'vitest';

import { LetterWorkflowAdapter } from './letter-workflow.adapter.js';

const LETTER = '00000000-0000-4000-8000-000000000401';
const ACTOR = '00000000-0000-4000-8000-000000000402';
const TYPE = '00000000-0000-4000-8000-000000000403';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: LETTER,
    typeId: TYPE,
    workflowId: 'wf-letter',
    stageId: 'stage-new',
    systemState: 'backlog',
    direction: 'incoming',
    registeredAt: null,
    regNumber: null,
    addresseeId: null,
    registrarId: null,
    createdBy: 'someone',
    customFields: {},
    ...overrides,
  };
}

function setup(overrides: Record<string, unknown> = {}, participants: { userId: string }[] = []) {
  const letters = {
    findDetailById: vi.fn(async () => row(overrides)),
    participants: vi.fn(async () => participants),
    countByStages: vi.fn(async () => ({ 'stage-new': 2 })),
    restateStage: vi.fn(async () => 1),
    byStagePage: vi.fn(async () => []),
  };
  const adapter = new LetterWorkflowAdapter(
    letters as never,
    { apply: vi.fn() } as never,
    { apply: vi.fn() } as never,
    { run: vi.fn() } as never,
    { definitions: vi.fn(async () => [{ id: 'cf-1' }]) } as never,
    undefined as never,
    undefined as never,
  );
  return { adapter, letters };
}

const actor = { id: ACTOR, permissions: [] };

describe('адаптер письма (#55, Р6)', () => {
  it('роли: регистратор, адресат, участник; автор — только у исходящего', async () => {
    const incoming = setup(
      { registrarId: ACTOR, addresseeId: ACTOR, direction: 'incoming', createdBy: ACTOR },
      [{ userId: ACTOR }],
    );
    const subject = await incoming.adapter.subject({} as never, LETTER, actor);
    expect([...subject.roles].sort()).toEqual(['addressee', 'participant', 'registrar']);
    expect(subject).toMatchObject({
      workflowId: 'wf-letter',
      typeId: TYPE,
      stageId: 'stage-new',
      bypassConditions: false,
      canOverrideGates: false,
      actsWithoutConditions: false,
    });
    expect([...subject.facts.activeCustomFieldIds]).toEqual(['cf-1']);

    const outgoing = setup({ direction: 'outgoing', createdBy: ACTOR });
    const outSubject = await outgoing.adapter.subject({} as never, LETTER, actor);
    expect(outSubject.roles.has('author')).toBe(true);
    expect(outSubject.roles.has('registrar')).toBe(false);
  });

  it('факты нейтральные: гейтов у писем нет', async () => {
    const { adapter } = setup();
    const subject = await adapter.subject({} as never, LETTER, actor);
    expect(subject.facts).toMatchObject({
      openSubtasks: 0,
      checklistDone: 0,
      spentMinutes: 0,
      hasResult: false,
      resultFileCount: 0,
    });
  });

  it('чужие роли не появляются', async () => {
    const { adapter } = setup();
    const subject = await adapter.subject({} as never, LETTER, actor);
    expect(subject.roles.size).toBe(0);
  });

  it('счётчики стадий и пересчёт группы — через репозиторий', async () => {
    const { adapter, letters } = setup();
    expect(await adapter.countByStages(['stage-new'])).toEqual({ 'stage-new': 2 });
    expect(await adapter.restateStage('stage-new', 'active')).toBe(1);
    expect(letters.restateStage).toHaveBeenCalledWith('stage-new', 'active');
  });
});
