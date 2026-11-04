import { describe, expect, it, vi } from 'vitest';
import { Permission, type AuthUser } from '@nodus/contracts';

import { LettersRelationService } from './letters-relation.service.js';
import type { LetterDetailRow } from './letter-row.js';

const LETTER = '00000000-0000-4000-8000-000000000501';
const TARGET = '00000000-0000-4000-8000-000000000502';
const OTHER = '00000000-0000-4000-8000-000000000503';

const REGISTRAR = {
  id: '00000000-0000-4000-8000-000000000510',
  displayName: 'Канцелярия',
  permissions: [Permission.CORRESPONDENCE_REGISTER],
} as unknown as AuthUser;

const row = (id: string, overrides: Partial<LetterDetailRow> = {}): LetterDetailRow =>
  ({
    id,
    registeredAt: new Date('2026-10-01T08:00:00.000Z'),
    addresseeId: null,
    registrarId: 'u-registrar',
    confidential: false,
    deletedAt: null,
    ...overrides,
  }) as unknown as LetterDetailRow;

function setup(
  options: {
    target?: LetterDetailRow;
    existing?: { id: string; relatedLetterId: string } | null;
    parents?: Record<string, string[]>;
    rows?: Record<string, LetterDetailRow>;
  } = {},
) {
  const repo = {
    findDetailById: vi.fn(async (id: string) => {
      if (options.rows?.[id]) return options.rows[id];
      return id === LETTER ? row(LETTER) : (options.target ?? row(TARGET));
    }),
    participants: vi.fn(async () => []),
  };
  const relations = {
    lockLetters: vi.fn(async () => void 0),
    relationOf: vi.fn(async () => options.existing ?? null),
    relationById: vi.fn(
      async (): Promise<{ id: string; relatedLetterId: string; kind: string } | null> => null,
    ),
    linkRelation: vi.fn(async () => void 0),
    replaceRelation: vi.fn(async () => void 0),
    unlinkRelation: vi.fn(async () => void 0),
    parentLinks: vi.fn(async (ids: string[]) =>
      ids.flatMap((id) =>
        (options.parents?.[id] ?? []).map((parent) => ({
          letterId: id,
          relatedLetterId: parent,
          kind: 'reply_to',
        })),
      ),
    ),
  };
  const query = {
    visibleRow: vi.fn(async () => row(LETTER)),
    detail: vi.fn(async () => ({ id: LETTER })),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const service = new LettersRelationService(
    repo as never,
    relations as never,
    query as never,
    {} as never,
    { run: (fn: (tx: unknown) => unknown) => fn({}) } as never,
    eventBus as never,
  );
  return { service, repo, relations, query, eventBus };
}

const body = (kind: 'reply_to' | 'nested_in' = 'reply_to', replace = false) => ({
  relatedLetterId: TARGET,
  kind,
  replace,
});

describe('связи писем (#461, Р1/Р1а)', () => {
  it('новая связь: вставка + событие linked', async () => {
    const { service, relations, eventBus } = setup();
    await service.link(REGISTRAR, LETTER, body('nested_in'));
    expect(relations.linkRelation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ letterId: LETTER, relatedLetterId: TARGET, kind: 'nested_in' }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'correspondence.letter_relations_changed',
      { letterId: LETTER, relatedLetterId: TARGET, kind: 'nested_in', action: 'linked' },
      expect.anything(),
    );
  });

  it('повтор той же цели — идемпотентный успех без события', async () => {
    const { service, relations, eventBus } = setup({
      existing: { id: 'r1', relatedLetterId: TARGET },
    });
    await service.link(REGISTRAR, LETTER, body());
    expect(relations.linkRelation).not.toHaveBeenCalled();
    expect(relations.replaceRelation).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('существующая связь на невидимую цель — 422 not_found, без already_linked', async () => {
    const { service } = setup({
      existing: { id: 'r1', relatedLetterId: OTHER },
      rows: { [OTHER]: row(OTHER, { confidential: true }) },
    });
    await expect(service.link(REGISTRAR, LETTER, body())).rejects.toMatchObject({
      code: 'LETTER_RELATION_INVALID',
      details: { reason: 'not_found' },
    });
  });

  it('другая цель без replace — 422 already_linked', async () => {
    const { service } = setup({ existing: { id: 'r1', relatedLetterId: OTHER } });
    await expect(service.link(REGISTRAR, LETTER, body())).rejects.toMatchObject({
      code: 'LETTER_RELATION_INVALID',
      details: { reason: 'already_linked' },
    });
  });

  it('другая цель с replace — замена строки + событие replaced', async () => {
    const { service, relations, eventBus } = setup({
      existing: { id: 'r1', relatedLetterId: OTHER },
    });
    await service.link(REGISTRAR, LETTER, body('reply_to', true));
    expect(relations.replaceRelation).toHaveBeenCalledWith(expect.anything(), 'r1', TARGET);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'correspondence.letter_relations_changed',
      expect.objectContaining({ action: 'replaced' }),
      expect.anything(),
    );
  });

  it('цикл: цель уже в цепочке письма — 422 cycle', async () => {
    const { service, relations } = setup({
      parents: { [TARGET]: [OTHER], [OTHER]: [LETTER] },
    });
    await expect(service.link(REGISTRAR, LETTER, body())).rejects.toMatchObject({
      code: 'LETTER_RELATION_INVALID',
      details: { reason: 'cycle' },
    });
    expect(relations.linkRelation).not.toHaveBeenCalled();
  });

  it('самосвязь — 422 cycle', async () => {
    const { service } = setup({ target: row(LETTER) });
    await expect(
      service.link(REGISTRAR, LETTER, { relatedLetterId: LETTER, kind: 'nested_in' }),
    ).rejects.toMatchObject({ details: { reason: 'cycle' } });
  });

  it('цель незарегистрирована — 422 not_registered', async () => {
    const { service } = setup({ target: row(TARGET, { registeredAt: null }) });
    await expect(service.link(REGISTRAR, LETTER, body())).rejects.toMatchObject({
      details: { reason: 'not_registered' },
    });
  });

  it('цель-конфиденциальное вне участия — 422 not_found (без оракула)', async () => {
    const { service } = setup({ target: row(TARGET, { confidential: true }) });
    await expect(service.link(REGISTRAR, LETTER, body())).rejects.toMatchObject({
      details: { reason: 'not_found' },
    });
  });

  it('снятие: удаление + событие unlinked; отсутствующая связь — 204 без события', async () => {
    const { service, relations, eventBus } = setup();
    relations.relationById.mockResolvedValue({
      id: 'r1',
      relatedLetterId: TARGET,
      kind: 'reply_to',
    });
    await service.unlink(REGISTRAR, LETTER, 'r1');
    expect(relations.unlinkRelation).toHaveBeenCalledWith(expect.anything(), 'r1');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'correspondence.letter_relations_changed',
      { letterId: LETTER, relatedLetterId: TARGET, kind: 'reply_to', action: 'unlinked' },
      expect.anything(),
    );
    const second = setup();
    await second.service.unlink(REGISTRAR, LETTER, 'r-x');
    expect(second.relations.unlinkRelation).not.toHaveBeenCalled();
    expect(second.eventBus.emit).not.toHaveBeenCalled();
  });
});
