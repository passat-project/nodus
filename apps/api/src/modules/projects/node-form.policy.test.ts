import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ErrorCode, SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { NodeFormPolicy } from './node-form.policy.js';

/**
 * Политика формы вида папки (#556, Р6; #631 — слот и привязка одна сущность):
 * «Код» — посевной атрибут SYSTEM_FIELD_IDS.nodeCode в слоте формы (системного
 * слота code больше нет). Создание и пачка (обязательные слоты после
 * умолчаний), правка (очистка обязательного), смена вида (умолчания нового
 * вида, обязательные по next). Порт реестра — мок с грамматикой целевого
 * провайдера: скопинг `target {kind:'node_kind'}`, причины `unknown` /
 * `not_in_type`, очистка `null` разрешена всегда.
 */

const invalidValues = (issues: { fieldId: string; reason: string; message: string }[]) =>
  new DomainException(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Custom field value is invalid', {
    issues,
  });

/** «Код» — системный посевной атрибут (system-fields), не выдуманный id. */
const CODE_FIELD = SYSTEM_FIELD_IDS.nodeCode;
const MARK_FIELD = '35560000-0000-4000-8000-000000000002';
const OLD_FIELD = '35560000-0000-4000-8000-000000000003';
const ACTOR = { id: 'user-1', permissions: [] };

const definition = (
  id: string,
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition =>
  ({
    id,
    number: 1,
    type: 'text',
    name: id,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
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

/** Мок реестра: привязки вида — ids слотов формы (слот и есть привязка, Р3). */
function makePolicy(
  definitions: CustomFieldDefinition[],
  nodeKindBindings: Record<string, readonly string[]> = {},
) {
  const known = new Set(definitions.map((entry) => entry.id));
  const allowedOf = (target: unknown) =>
    new Set(nodeKindBindings[(target as { id: string } | undefined)?.id ?? 'kind-1'] ?? []);
  const defaultsOf = (fieldIds: ReadonlySet<string>) =>
    Object.fromEntries(
      definitions
        .filter((entry) => fieldIds.has(entry.id) && entry.defaultValue?.kind === 'static')
        .map((entry) => [
          entry.id,
          (entry.defaultValue as { kind: 'static'; value: unknown }).value,
        ]),
    );
  const registry = {
    definitions: vi.fn(async () => definitions),
    prepareCreate: vi.fn(async (args: Record<string, unknown>) => {
      const allowed = allowedOf(args.target);
      const input = (args.input ?? {}) as Record<string, unknown>;
      const issues = Object.keys(input)
        .filter((fieldId) => !allowed.has(fieldId))
        .map((fieldId) => ({
          fieldId,
          reason: (known.has(fieldId) ? 'not_in_type' : 'unknown') as string,
          message: known.has(fieldId) ? 'Field is not bound to this place' : 'Unknown custom field',
        }));
      if (issues.length > 0) throw invalidValues(issues);
      return { ...defaultsOf(allowed), ...input };
    }),
    prepareUpdate: vi.fn(async (args: Record<string, unknown>) => {
      const allowed = allowedOf(args.target);
      const current = { ...((args.current ?? {}) as Record<string, unknown>) };
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      // Проверяются только изменённые значения (грамматика провайдера):
      // `null` — очистка, разрешённая всегда, в том числе без привязки.
      const changed = Object.entries(patch).filter(
        ([fieldId, value]) => value !== null && current[fieldId] !== value,
      );
      const issues = changed
        .map(([fieldId]) => fieldId)
        .filter((fieldId) => !allowed.has(fieldId))
        .map((fieldId) => ({
          fieldId,
          reason: (known.has(fieldId) ? 'not_in_type' : 'unknown') as string,
          message: known.has(fieldId) ? 'Field is not bound to this place' : 'Unknown custom field',
        }));
      if (issues.length > 0) throw invalidValues(issues);
      const changes: { fieldId: string; from: unknown; to: unknown }[] = [];
      for (const [fieldId, value] of Object.entries(patch)) {
        if (value === null) {
          // Очистка разрешена всегда — даже для снятой привязки (Р8).
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
    syncPlaceBindings: vi.fn(),
  };
  return { policy: new NodeFormPolicy(registry as never), registry };
}

describe('NodeFormPolicy.prepareCreate (#556 Р6, #631)', () => {
  it('обязательные «Код» (слот атрибута) и атрибут после умолчаний — 422 create', async () => {
    const { policy } = makePolicy([definition(CODE_FIELD), definition(MARK_FIELD)], {
      'kind-1': [],
    });
    await expect(
      policy.prepareCreate(
        kind({
          fields: [
            { fieldId: CODE_FIELD, state: 'required' },
            { fieldId: MARK_FIELD, state: 'required' },
          ],
        }),
        {},
        ACTOR.id,
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_FIELDS_REQUIRED,
      details: {
        kindId: 'kind-1',
        fields: [`cf.${CODE_FIELD}`, `cf.${MARK_FIELD}`],
        reason: 'create',
      },
    });
  });

  it('умолчание атрибута закрывает обязательность', async () => {
    const { policy } = makePolicy(
      [definition(MARK_FIELD, { defaultValue: { kind: 'static', value: 'ОВ' } })],
      { 'kind-1': [MARK_FIELD] },
    );
    const values = await policy.prepareCreate(
      kind({ fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
      {},
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({ [MARK_FIELD]: 'ОВ' });
  });

  it('legacy code → значение атрибута «Код», если слот в форме вида', async () => {
    const { policy, registry } = makePolicy([definition(CODE_FIELD)], { 'kind-1': [CODE_FIELD] });
    const values = await policy.prepareCreate(
      kind({ fields: [{ fieldId: CODE_FIELD, state: 'optional' }] }),
      { code: 'ОВ1.1' },
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({ [CODE_FIELD]: 'ОВ1.1' });
    expect(registry.prepareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { [CODE_FIELD]: 'ОВ1.1' },
        target: { kind: 'node_kind', id: 'kind-1' },
      }),
      undefined,
    );
  });

  it('legacy code без слота «Код» игнорируется (не ошибка)', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)], { 'kind-1': [MARK_FIELD] });
    const values = await policy.prepareCreate(
      kind({ fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
      { code: 'X-1' },
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({});
  });

  it('явное customFields важнее legacy code', async () => {
    const { policy, registry } = makePolicy([definition(CODE_FIELD)], { 'kind-1': [CODE_FIELD] });
    const values = await policy.prepareCreate(
      kind({ fields: [{ fieldId: CODE_FIELD, state: 'optional' }] }),
      { code: 'legacy', customFields: { [CODE_FIELD]: 'явное' } },
      ACTOR.id,
      ACTOR,
    );
    expect(values).toEqual({ [CODE_FIELD]: 'явное' });
    expect(registry.prepareCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: { [CODE_FIELD]: 'явное' } }),
      undefined,
    );
  });

  it('атрибут вне привязки вида — 422 not_in_type (порт)', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD), definition(CODE_FIELD)], {
      'kind-1': [MARK_FIELD],
    });
    await expect(
      policy.prepareCreate(
        kind({ fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
        { customFields: { [CODE_FIELD]: 'чужое' } },
        ACTOR.id,
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: CODE_FIELD, reason: 'not_in_type' }] },
    });
  });
});

describe('NodeFormPolicy.prepareUpdate (#556 Р6, #631)', () => {
  it('очистка обязательного атрибута — 422 clear', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)], { 'kind-1': [MARK_FIELD] });
    await expect(
      policy.prepareUpdate(
        kind({ fields: [{ fieldId: MARK_FIELD, state: 'required' }] }),
        { customFields: { [MARK_FIELD]: 'ОВ' } },
        { customFields: { [MARK_FIELD]: null } },
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: false },
      ),
    ).rejects.toMatchObject({
      details: { fields: [`cf.${MARK_FIELD}`], reason: 'clear' },
    });
  });

  it('очистка «Кода» через legacy null — 422 clear с ключом cf.<nodeCode>', async () => {
    const { policy } = makePolicy([definition(CODE_FIELD)], { 'kind-1': [CODE_FIELD] });
    await expect(
      policy.prepareUpdate(
        kind({ fields: [{ fieldId: CODE_FIELD, state: 'required' }] }),
        { customFields: { [CODE_FIELD]: 'ОВ1.1' } },
        { code: null },
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: false },
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_FIELDS_REQUIRED,
      details: { fields: [`cf.${CODE_FIELD}`], reason: 'clear' },
    });
  });

  it('очистка значения снятой привязки разрешена (null не проверяется)', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)], { 'kind-1': [] });
    const result = await policy.prepareUpdate(
      kind({ fields: [] }),
      { customFields: { [OLD_FIELD]: 'было' } },
      { customFields: { [OLD_FIELD]: null } },
      { authorId: ACTOR.id, actor: ACTOR, kindChanged: false },
    );
    expect(result.values).toEqual({});
    expect(result.changes).toEqual([{ fieldId: OLD_FIELD, from: 'было', to: null }]);
  });

  it('смена вида: умолчания нового вида попадают в next', async () => {
    const { policy } = makePolicy(
      [definition(MARK_FIELD, { defaultValue: { kind: 'static', value: 'ОВ' } })],
      { 'kind-1': [MARK_FIELD] },
    );
    const result = await policy.prepareUpdate(
      kind({ fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
      { customFields: { [OLD_FIELD]: 'старое' } },
      {},
      { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
    );
    expect(result.values).toEqual({ [OLD_FIELD]: 'старое', [MARK_FIELD]: 'ОВ' });
    expect(result.changes).toEqual([{ fieldId: MARK_FIELD, from: null, to: 'ОВ' }]);
  });

  it('смена вида: обязательный «Код» нового вида проверяется по next', async () => {
    const { policy } = makePolicy([definition(CODE_FIELD)], { 'kind-1': [CODE_FIELD] });
    await expect(
      policy.prepareUpdate(
        kind({ fields: [{ fieldId: CODE_FIELD, state: 'required' }] }),
        { customFields: {} },
        {},
        { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
      ),
    ).rejects.toMatchObject({
      details: { fields: [`cf.${CODE_FIELD}`], reason: 'kind_change' },
    });
  });

  it('смена вида: значения прежнего вида остаются в next', async () => {
    const { policy } = makePolicy([definition(MARK_FIELD)], { 'kind-1': [MARK_FIELD] });
    const result = await policy.prepareUpdate(
      kind({ fields: [{ fieldId: MARK_FIELD, state: 'optional' }] }),
      { customFields: { [OLD_FIELD]: 'старое' } },
      { customFields: { [MARK_FIELD]: 'ОВ' } },
      { authorId: ACTOR.id, actor: ACTOR, kindChanged: true },
    );
    expect(result.values).toEqual({ [OLD_FIELD]: 'старое', [MARK_FIELD]: 'ОВ' });
  });
});
