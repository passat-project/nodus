import { vi, type Mock } from 'vitest';
import { SYSTEM_FIELD_IDS, type AuthUser } from '@nodus/contracts';

import type { ProjectRow } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

/**
 * Общий набор моков ProjectsService (#52, #631 Р9/Р10): строка проекта,
 * пользователь, форма типа и сервис на репозиториях-моках с дефолтами
 * beforeEach. Разнесён из projects.service.test.ts в локальный helper
 * ради лимита строк файла (I5); поведение моков прежнее.
 */

export const ID = '00000000-0000-4000-8000-000000000001';
export const TYPE = '11111111-1111-4111-8111-111111111111';
export const CREATOR = '00000000-0000-4000-8000-0000000000a1';
export const HIP = '00000000-0000-4000-8000-0000000000a2';
export const HELPER = '00000000-0000-4000-8000-0000000000a3';
export const CODE = SYSTEM_FIELD_IDS.projectCode;
export const CLIENT = SYSTEM_FIELD_IDS.projectClient;

export function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

export function typeRow(form: { fields: { fieldId: string; state: string }[] } = { fields: [] }) {
  return { id: TYPE, name: 'Договор', form };
}

export function row(overrides: Record<string, unknown> = {}): ProjectRow {
  return {
    id: ID,
    // Колонки code/clientId заморожены (Р9 #631): свежие строки — null,
    // шифр и заказчик живут в customFields.
    code: null,
    name: 'Тендер УП',
    description: '',
    color: 'blue',
    typeId: TYPE,
    portfolioId: null,
    clientId: null,
    managerId: CREATOR,
    assistantIds: [],
    visibility: 'open',
    status: 'active',
    completedAt: null,
    archivedAt: null,
    startedAt: null,
    endsAt: null,
    customFields: {},
    creatorId: CREATOR,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    type: typeRow(),
    portfolio: null,
    ...overrides,
  } as ProjectRow;
}

/** Мок-заглушки порта с фиксированными ключами: `Mock` из vitest —
 *  портабельный тип (иначе TS2742 на inferred-типе bare `vi.fn()`
 *  через @vitest/spy). */
type Mocks<K extends string> = Record<K, Mock>;

export function makeProjectsServiceKit() {
  const repo: Mocks<
    'findById' | 'lockForUpdate' | 'create' | 'update' | 'touch' | 'settingValue' | 'putSetting'
  > = {
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    touch: vi.fn(),
    settingValue: vi.fn(),
    putSetting: vi.fn(),
  };
  const types: Mocks<'findActive' | 'findById'> = { findActive: vi.fn(), findById: vi.fn() };
  const groups: Mocks<'findActive'> = { findActive: vi.fn() };
  const participantsRepo: Mocks<'rowsOfProject' | 'add' | 'hasRow'> = {
    rowsOfProject: vi.fn(),
    add: vi.fn(),
    hasRow: vi.fn(),
  };
  const members: Mocks<
    'syncManagement' | 'onVisibilityChanged' | 'recomputeTaskSource' | 'emitChanged'
  > = {
    syncManagement: vi.fn(),
    onVisibilityChanged: vi.fn(),
    recomputeTaskSource: vi.fn(),
    emitChanged: vi.fn(),
  };
  const queries: Mocks<'detail'> = { detail: vi.fn() };
  const profiles: Mocks<'filterActiveUserIds'> = { filterActiveUserIds: vi.fn() };
  const customFields: Mocks<'definitions' | 'prepareCreate' | 'prepareUpdate'> = {
    definitions: vi.fn(),
    prepareCreate: vi.fn(),
    prepareUpdate: vi.fn(),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus: Mocks<'emit'> = { emit: vi.fn() };
  // Снятие формулы ячейки при обычной записи значения (Р5 #632).
  const formulaCells: Mocks<'lockedFieldIds'> = {
    lockedFieldIds: vi.fn(async () => new Set<string>()),
  };
  // Синхронный пересчёт формул проекта в tx PATCH (#632).
  const formulaRecalc = { recalcProjectAfterValuesChange: vi.fn(async () => void 0) };
  const kit = {
    formulaRecalc,
    repo,
    types,
    groups,
    participantsRepo,
    members,
    queries,
    profiles,
    customFields,
    formulaCells,
    eventBus,
    service: undefined as unknown as ProjectsService,
    /** Аналог beforeEach исходного файла: чистка моков, дефолты, сервис. */
    reset() {
      vi.clearAllMocks();
      repo.settingValue.mockResolvedValue(null);
      repo.create.mockImplementation(async (data: Record<string, unknown>) => row(data));
      // `update` возвращает строку (как Prisma): аудитория `project.updated`
      // считается по состоянию ПОСЛЕ правки (#646).
      repo.update.mockImplementation(
        async (_tx: unknown, _id: string, data: Record<string, unknown>) => row(data),
      );
      repo.findById.mockResolvedValue(row());
      repo.lockForUpdate.mockResolvedValue({ id: ID, visibility: 'open', status: 'active' });
      types.findActive.mockResolvedValue(typeRow());
      types.findById.mockResolvedValue(typeRow());
      groups.findActive.mockResolvedValue({ id: 'g-1' });
      participantsRepo.rowsOfProject.mockResolvedValue([]);
      profiles.filterActiveUserIds.mockImplementation(async (ids: string[]) => ids);
      // Слоты формы типа по умолчанию — системные «Шифр»/«Заказчик»:
      // эффективная форма должна знать эти определения.
      customFields.definitions.mockResolvedValue([{ id: CODE }, { id: CLIENT }]);
      customFields.prepareCreate.mockImplementation(
        async (args: { input: Record<string, unknown> }) => ({ ...args.input }),
      );
      customFields.prepareUpdate.mockResolvedValue({ next: {}, changes: [] });
      members.syncManagement.mockResolvedValue(undefined);
      queries.detail.mockResolvedValue({ id: ID });
      kit.service = new ProjectsService(
        txRunner as never,
        eventBus as never,
        repo as never,
        types as never,
        groups as never,
        participantsRepo as never,
        members as never,
        queries as never,
        profiles as never,
        customFields as never,
        formulaCells as never,
        kit.formulaRecalc as never,
        { planOnCreate: async () => ({ ok: true, issue: async () => ({}) }) } as never,
      );
    },
  };
  kit.reset();
  return kit;
}
