import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { NodeFormPolicy } from './node-form.policy.js';

/**
 * Политика формы вида папки (#556, Р6): создание и пачка (обязательные после
 * умолчаний), правка (очистка обязательного), смена вида (умолчания нового
 * вида, обязательные по next, `null` очищает), шифр «скрыто» — 400, скрытое
 * определение в форме не требуется. Порт реестра — мок с той же грамматикой
 * `fieldIds`/`not_in_type`.
 */

const invalidValues = (issues: { fieldId: string; reason: string; message: string }[]) =>
  new DomainException(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Custom field value is invalid', {
    issues,
  });

const CODE_FIELD = '35560000-0000-4000-8000-000000000001';
const MARK_FIELD = '35560000-0000-4000-8000-000000000002';
const ACTOR = { id: 'user-1', permissions: [] };

const definition = (
  id: string,
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition =>
  ({
    id,
    scope: 'node',
    type: 'text',
    name: id,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    hidden: false,
    sortOrder: 0,
    typeIds: [],
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

const kind = (form: NodeKind['form'], overrides: Partial<NodeKind> = {}): NodeKind => ({
  id: 'kind-1',
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form,
  capabilities: [],
  ...overrides,
});

function makePolicy(definitions: CustomFieldDefinition[]) {
  const ids = new Set(definitions.map((entry) => entry.id));
  const defaultsOf = (fieldIds: readonly string[]) =>
    Object.fromEntries(
      definitions
        .filter((entry) => fieldIds.includes(entry.id) && entry.defaultValue?.kind === 'static')
        .map((entry) => [
          entry.id,
          (entry.defaultValue as { kind: 'static'; value: unknown }).value,
        ]),
    );
  const registry = {
    definitions: vi.fn(async () => definitions),
    prepareCreate: vi.fn(async (_scope: string, args: Record<string, unknown>) => {
      const fieldIds = (args.fieldIds as string[] | undefined) ?? [...ids];
      const allowed = new Set(fieldIds);
      const input = (args.input ?? {}) as Record<string, unknown>;
      const foreign = Object.keys(input).filter((fieldId) => !allowed.has(fieldId));
      if (foreign.length > 0) {
        throw invalidValues(
          foreign.map((fieldId) => ({
            fieldId,
            reason: 'not_in_type' as const,
            message: 'Field is not bound to this type',
          })),
        );
      }
      return { ...defaultsOf(fieldIds), ...input };
    }),
    prepareUpdate: vi.fn(async (_scope: string, args: Record<string, unknown>) => {
      const fieldIds = (args.fieldIds as string[] | undefined) ?? [...ids];
      const allowed = new Set(fieldIds);
      const current = { ...((args.current ?? {}) as Record<string, unknown>) };
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      const changes: { fieldId: string; from: unknown; to: unknown }[] = [];
      for (const [fieldId, value] of Object.entries(patch)) {
        if (value !== null && !allowed.has(fieldId)) {
          throw invalidValues([
            { fieldId, reason: 'not_in_type', message: 'Field is not bound to this type' },
          ]);
        }
        if (value === null) {
          if (fieldId in current) {
            changes.push({ fieldId, from: current[fieldId], to: null });
            delete current[fieldId];
          }
          continue;
        }
        if (current[fieldId] !== value) {
          changes.push({ fieldId, from: current[fieldId] ?? null, to: value });
          current[fieldId] = value;
        }
      }
      return { next: current, changes };
    }),
    refs: vi.fn(),
    refsMany: vi.fn(),
  };
  return { policy: new NodeFormPolicy(registry as never), registry };
}

describe('NodeFormPolicy.prepareCreate (#556, Р6)', () => {
  it('обязательные шифр и атрибут после умолчаний — 422 create', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)]);
    await expect(
      policy.prepareCreate(
        kind({ code: 'required', fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
        { code: null },
        ACTOR.id,
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_FIELDS_REQUIRED,
      details: {
        kindId: 'kind-1',
        fields: ['code', `cf.${MARK_FIELD}`],
        reason: 'create',
      },
    });
  });

  it('умолчание атрибута закрывает обязательность', async () => {
    const { policy } = makePolicy([
      definition(MARK_FIELD, { defaultValue: { kind: 'static', value: 'ОВ' } }),
    ]);
    const values = await policy.prepareCreate(
      kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
      { code: 'ОВ1.1' },
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({ [MARK_FIELD]: 'ОВ' });
  });

  it('шифр у вида «скрыто» — 400 VALIDATION_FAILED', async () => {
    const { policy } = makePolicy([]);
    await expect(
      policy.prepareCreate(kind({ code: 'hidden', fields: [] }), { code: 'X-1' }, ACTOR.id, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('атрибут вне формы вида — 422 not_in_type (порт)', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD), definition(CODE_FIELD)]);
    await expect(
      policy.prepareCreate(
        kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
        { customFields: { [CODE_FIELD]: 'чужое' } },
        ACTOR.id,
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: CODE_FIELD, reason: 'not_in_type' }] },
    });
  });

  it('скрытое в «Атрибутах» определение не требуется (C1)', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD, { hidden: true })]);
    const values = await policy.prepareCreate(
      kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
      {},
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({});
  });
});

describe('NodeFormPolicy.prepareUpdate (#556, Р6)', () => {
  it('очистка обязательного атрибута — 422 clear', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)]);
    await expect(
      policy.prepareUpdate(
        kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
        { code: null, customFields: { [MARK_FIELD]: 'ОВ' } },
        { customFields: { [MARK_FIELD]: null } },
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: false },
      ),
    ).rejects.toMatchObject({
      details: { fields: [`cf.${MARK_FIELD}`], reason: 'clear' },
    });
  });

  it('очистка шифра при обязательном шифре — 422 clear', async () => {
    const { policy } = makePolicy([]);
    await expect(
      policy.prepareUpdate(
        kind({ code: 'required', fields: [] }),
        { code: 'ОВ1.1', customFields: {} },
        { code: null },
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: false },
      ),
    ).rejects.toMatchObject({ details: { fields: ['code'], reason: 'clear' } });
  });

  it('смена вида: умолчания нового вида попадают в next', async () => {
    const { policy } = makePolicy([
      definition(MARK_FIELD, { defaultValue: { kind: 'static', value: 'ОВ' } }),
    ]);
    const result = await policy.prepareUpdate(
      kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
      { code: null, customFields: { [CODE_FIELD]: 'старое' } },
      {},
      { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
    );
    expect(result.values).toEqual({ [CODE_FIELD]: 'старое', [MARK_FIELD]: 'ОВ' });
    expect(result.changes).toEqual([{ fieldId: MARK_FIELD, from: null, to: 'ОВ' }]);
  });

  it('смена вида: обязательный шифр нового вида проверяется по next (null очищает)', async () => {
    const { policy } = makePolicy([]);
    await expect(
      policy.prepareUpdate(
        kind({ code: 'required', fields: [] }),
        { code: 'ОВ1.1', customFields: {} },
        { code: null },
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
      ),
    ).rejects.toMatchObject({
      details: { fields: ['code'], reason: 'kind_change' },
    });
  });

  it('смена вида: значения прежнего вида остаются в next', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)]);
    const result = await policy.prepareUpdate(
      kind({ code: 'optional', fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
      { code: null, customFields: { [CODE_FIELD]: 'старое' } },
      { customFields: { [MARK_FIELD]: 'ОВ' } },
      { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
    );
    expect(result.values).toEqual({ [CODE_FIELD]: 'старое', [MARK_FIELD]: 'ОВ' });
  });
});
