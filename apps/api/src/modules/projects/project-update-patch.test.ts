import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, SYSTEM_FIELD_IDS, type AuthUser } from '@nodus/contracts';

import { buildUpdatePatch } from './project-update-patch.js';
import type { ProjectFacts } from './project-access.js';
import type { ProjectRow } from './projects.repository.js';

/**
 * Сборка патча правки проекта (#52/#631 Р9): скалярные поля, портфель,
 * даты, помощники (дедупликация, исключение руководителя, лимит,
 * активность) и слияние legacy-полей шифра/заказчика с customFields в
 * один патч атрибутов. Секретность и обязательные слоты — в
 * projects-update.service.test.ts (через ProjectsService.update).
 */

const TYPE = '11111111-1111-4111-8111-111111111111';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const CODE = SYSTEM_FIELD_IDS.projectCode;
const CLIENT = SYSTEM_FIELD_IDS.projectClient;

const user = (id: string, permissions: string[] = []): AuthUser => ({
  id,
  email: 'u@nodus.by',
  displayName: 'u',
  permissions,
});

const facts: ProjectFacts = {
  managerId: MANAGER,
  assistantIds: [],
  visibility: 'open',
  status: 'active',
};

const row = {
  typeId: TYPE,
  name: 'Тендер УП',
  description: '',
  color: 'blue',
  portfolioId: null,
  visibility: 'open',
  startedAt: null,
  endsAt: null,
  assistantIds: [],
  customFields: {},
} as unknown as ProjectRow;

interface Ctx {
  groups: { findActive: ReturnType<typeof vi.fn> };
  profiles: { filterActiveUserIds: ReturnType<typeof vi.fn> };
  types: { findById: ReturnType<typeof vi.fn> };
  customFields: {
    definitions: ReturnType<typeof vi.fn>;
    prepareUpdate: ReturnType<typeof vi.fn>;
  };
  formulaCells: { lockedFieldIds: ReturnType<typeof vi.fn> };
}

function makeCtx(): Ctx {
  return {
    groups: { findActive: vi.fn(async () => ({ id: 'g-1' })) },
    profiles: { filterActiveUserIds: vi.fn(async (ids: string[]) => ids) },
    types: { findById: vi.fn(async () => ({ id: TYPE, name: 'Договор', form: { fields: [] } })) },
    customFields: {
      definitions: vi.fn(async () => [{ id: 'x' }]),
      prepareUpdate: vi.fn(async () => ({ next: { x: 1 }, changes: [] as { fieldId: string }[] })),
    },
    formulaCells: { lockedFieldIds: vi.fn(async () => new Set<string>()) },
  };
}

describe('buildUpdatePatch (#52/#631)', () => {
  it('скалярные поля: description null → пустая строка, color и name — как есть', async () => {
    const ctx = makeCtx();
    const { patch, fields } = await buildUpdatePatch(
      ctx as never,
      user(MANAGER),
      { ...row, description: 'старое описание' } as ProjectRow,
      facts,
      {
        name: 'Тендер УП-2',
        description: null,
        color: 'red',
      } as never,
    );
    expect(patch).toEqual({ name: 'Тендер УП-2', description: '', color: 'red' });
    expect(fields).toEqual(['name', 'description', 'color']);
  });

  it('портфель: неизвестный → 422; null очищает; известный — пишется', async () => {
    const ctx = makeCtx();
    ctx.groups.findActive.mockResolvedValue(null);
    await expect(
      buildUpdatePatch(ctx as never, user(MANAGER), row, facts, { portfolioId: 'g-x' } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

    const cleared = await buildUpdatePatch(
      ctx as never,
      user(MANAGER),
      { ...row, portfolioId: 'g-1' } as ProjectRow,
      facts,
      {
        portfolioId: null,
      } as never,
    );
    expect(cleared.patch.portfolioId).toBeNull();

    ctx.groups.findActive.mockResolvedValue({ id: 'g-1' });
    const set = await buildUpdatePatch(ctx as never, user(MANAGER), row, facts, {
      portfolioId: 'g-1',
    } as never);
    expect(set.patch.portfolioId).toBe('g-1');
    expect(set.fields).toContain('portfolioId');
  });

  it('даты: ISO → Date, null очищает startedAt/endsAt', async () => {
    const dated = {
      ...row,
      startedAt: new Date('2026-10-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-15T00:00:00.000Z'),
    } as ProjectRow;
    const { patch, fields } = await buildUpdatePatch(
      makeCtx() as never,
      user(MANAGER),
      dated,
      facts,
      { startDate: '2026-11-01', endDate: null } as never,
    );
    expect(patch.startedAt).toEqual(new Date('2026-11-01'));
    expect(patch.endsAt).toBeNull();
    expect(fields).toEqual(['startDate', 'endDate']);
  });

  it('повтор тех же значений не попадает в fields (#699)', async () => {
    const current = {
      ...row,
      startedAt: new Date('2026-11-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-15T00:00:00.000Z'),
    } as ProjectRow;
    const { patch, fields } = await buildUpdatePatch(
      makeCtx() as never,
      user(MANAGER),
      current,
      { ...facts, assistantIds: ['a-1'] },
      {
        name: 'Тендер УП',
        description: null,
        color: 'blue',
        portfolioId: null,
        startDate: '2026-11-01',
        endDate: '2026-10-15',
        assistantIds: ['a-1'],
      } as never,
    );
    expect(fields).toEqual([]);
    expect(patch).toEqual({});
  });

  it('помощники: дедупликация, руководитель исключается, лимит 10 и активность', async () => {
    const ctx = makeCtx();
    const aids = ['a-1', 'a-2', 'a-1', MANAGER];
    const { patch, assistantIds } = await buildUpdatePatch(
      ctx as never,
      user(MANAGER),
      row,
      facts,
      { assistantIds: aids } as never,
    );
    expect(assistantIds).toEqual(['a-1', 'a-2']);
    expect(patch.assistantIds).toEqual(['a-1', 'a-2']);

    const eleven = Array.from({ length: 11 }, (_, i) => `a-${i}`);
    await expect(
      buildUpdatePatch(ctx as never, user(MANAGER), row, facts, { assistantIds: eleven } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(ctx.profiles.filterActiveUserIds).not.toHaveBeenCalledWith(eleven);

    ctx.profiles.filterActiveUserIds.mockResolvedValue(['a-1']);
    await expect(
      buildUpdatePatch(ctx as never, user(MANAGER), row, facts, {
        assistantIds: ['a-1', 'a-2'],
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('legacy шифр/заказчик без изменений реестра не попадают в fields (#699)', async () => {
    const ctx = makeCtx();
    const { patch, fields } = await buildUpdatePatch(ctx as never, user(MANAGER), row, facts, {
      code: 'ПР-1',
      clientId: 'cp-1',
    } as never);
    expect(ctx.customFields.prepareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        current: {},
        patch: { [CODE]: 'ПР-1', [CLIENT]: 'cp-1' },
        target: { kind: 'project_type', id: TYPE },
      }),
      undefined,
    );
    expect(patch.customFields).toEqual({ x: 1 });
    // Реестр не сообщил изменений — повтора значения в истории нет.
    expect(fields).toEqual([]);
  });

  it('изменения реестра домешиваются к legacy-полям без дублей', async () => {
    const ctx = makeCtx();
    ctx.customFields.prepareUpdate.mockResolvedValue({
      next: { [CODE]: 'ПР-2' },
      changes: [{ fieldId: CODE, from: 'ПР-1', to: 'ПР-2' }],
    });
    const { fields } = await buildUpdatePatch(ctx as never, user(MANAGER), row, facts, {
      code: 'ПР-2',
    } as never);
    // cf.<code> уже в changes — повторная запись из legacy-поля не нужна.
    expect(fields).toEqual([`cf.${CODE}`]);
  });
});

describe('buildUpdatePatch: формульная блокировка ячейки (#660)', () => {
  it('изменённый формульный ключ — 422 FORMULA_CELL_LOCKED', async () => {
    const ctx = makeCtx();
    ctx.customFields.prepareUpdate.mockResolvedValue({
      next: { x: 1 },
      changes: [{ fieldId: 'f-locked', from: null, to: 'руками' }],
    } as never);
    ctx.formulaCells.lockedFieldIds.mockResolvedValue(new Set(['f-locked']));
    await expect(
      buildUpdatePatch(
        ctx as never,
        user(MANAGER),
        row,
        facts,
        { customFields: { 'f-locked': 'руками' } } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'FORMULA_CELL_LOCKED' });
  });

  it('повтор того же значения блокировку не встречает', async () => {
    const ctx = makeCtx();
    await buildUpdatePatch(
      ctx as never,
      user(MANAGER),
      row,
      facts,
      { customFields: { x: 1 } } as never,
      {} as never,
    );
    expect(ctx.formulaCells.lockedFieldIds).not.toHaveBeenCalled();
  });
});
