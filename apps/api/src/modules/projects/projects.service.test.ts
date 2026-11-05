import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PROJECT_EVENTS, SYSTEM_FIELD_IDS, type AuthUser } from '@nodus/contracts';

import type { ProjectRow } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const TYPE = '11111111-1111-4111-8111-111111111111';
const CREATOR = '00000000-0000-4000-8000-0000000000a1';
const HIP = '00000000-0000-4000-8000-0000000000a2';
const HELPER = '00000000-0000-4000-8000-0000000000a3';
const CODE = SYSTEM_FIELD_IDS.projectCode;
const CLIENT = SYSTEM_FIELD_IDS.projectClient;

function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

function typeRow(form: { fields: { fieldId: string; state: string }[] } = { fields: [] }) {
  return { id: TYPE, name: 'Договор', form };
}

function row(overrides: Record<string, unknown> = {}): ProjectRow {
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

describe('ProjectsService (#52, #631 Р9/Р10)', () => {
  const repo = {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    touch: vi.fn(),
    settingValue: vi.fn(),
    putSetting: vi.fn(),
  };
  const types = { findActive: vi.fn(), findById: vi.fn() };
  const groups = { findActive: vi.fn() };
  const participantsRepo = { rowsOfProject: vi.fn(), add: vi.fn(), hasRow: vi.fn() };
  const members = {
    syncManagement: vi.fn(),
    onVisibilityChanged: vi.fn(),
    recomputeTaskSource: vi.fn(),
    emitChanged: vi.fn(),
  };
  const queries = { detail: vi.fn() };
  const profiles = { filterActiveUserIds: vi.fn() };
  const customFields = { prepareCreate: vi.fn(), prepareUpdate: vi.fn() };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn() };
  let service: ProjectsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo.settingValue.mockResolvedValue(null);
    repo.create.mockImplementation(async (data: Record<string, unknown>) => row(data));
    repo.findById.mockResolvedValue(row());
    types.findActive.mockResolvedValue(typeRow());
    types.findById.mockResolvedValue(typeRow());
    groups.findActive.mockResolvedValue({ id: 'g-1' });
    profiles.filterActiveUserIds.mockImplementation(async (ids: string[]) => ids);
    customFields.prepareCreate.mockImplementation(
      async (args: { input: Record<string, unknown> }) => ({ ...args.input }),
    );
    customFields.prepareUpdate.mockResolvedValue({ next: {}, changes: [] });
    members.syncManagement.mockResolvedValue(undefined);
    queries.detail.mockResolvedValue({ id: ID });
    service = new ProjectsService(
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
    );
  });

  describe('create', () => {
    it('дефолт видимости — настройка портала (нет строки → open); событие created', async () => {
      await service.create(user(CREATOR), {
        name: 'Тендер УП',
        typeId: TYPE,
      } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'open', managerId: CREATOR }),
        {},
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.CREATED,
        expect.objectContaining({ projectId: ID, visibility: 'open' }),
        expect.objectContaining({ aggregateType: 'project' }),
      );

      repo.settingValue.mockResolvedValue('secret');
      await service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ visibility: 'secret' }),
        {},
      );
    });

    it('явная visibility сильнее настройки портала', async () => {
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        visibility: 'open',
      } as never);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'open' }), {});
    });

    it('скопинг реестра — target тип проекта; значения пишутся в customFields', async () => {
      await service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
      expect(customFields.prepareCreate).toHaveBeenCalledWith(
        {
          input: {},
          authorId: CREATOR,
          actor: expect.objectContaining({ id: CREATOR }),
          target: { kind: 'project_type', id: TYPE },
        },
        {},
      );
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ customFields: {} }), {});
    });

    it('legacy code/clientId тела → значения системных атрибутов; явное customFields важнее', async () => {
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        code: '2026-02',
        clientId: 'cp-1',
      } as never);
      expect(customFields.prepareCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { [CODE]: '2026-02', [CLIENT]: 'cp-1' },
        }),
        {},
      );

      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        code: 'legacy',
        customFields: { [CODE]: 'явное' },
      } as never);
      expect(customFields.prepareCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ input: { [CODE]: 'явное' } }),
        {},
      );
    });

    it('обязательный слот «Шифр» формы типа: нет значения → 422 PROJECT_FIELDS_REQUIRED', async () => {
      types.findActive.mockResolvedValue(
        typeRow({ fields: [{ fieldId: CODE, state: 'required' }] }),
      );
      await expect(
        service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.PROJECT_FIELDS_REQUIRED,
        details: { typeId: TYPE, fields: [CODE], reason: 'create' },
      });
      expect(repo.create).not.toHaveBeenCalled();

      // Значение (legacy или атрибут) закрывает обязательность.
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        code: '2026-02',
      } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFields: { [CODE]: '2026-02' } }),
        {},
      );
    });

    it('наблюдатели задаются при создании; руководство наблюдателем не становится', async () => {
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        managerId: CREATOR,
        assistantIds: [HELPER],
        observers: [HIP, CREATOR, HELPER],
      } as never);
      // HIP — наблюдатель; создатель-РП и помощник отфильтрованы.
      expect(participantsRepo.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: HIP, source: 'observer', observerKind: 'invited' },
      ]);
      expect(members.emitChanged).toHaveBeenCalledWith({}, ID, [HIP]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.CREATED,
        expect.objectContaining({ observerIds: [HIP] }),
        expect.anything(),
      );
    });

    it('создатель-не-руководитель → наблюдатель-создатель; РП по умолчанию — создатель', async () => {
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        managerId: HIP,
      } as never);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ managerId: HIP }), {});
      expect(participantsRepo.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: CREATOR, source: 'observer', observerKind: 'creator' },
      ]);
      // создатель-руководитель — строки observer нет
      participantsRepo.add.mockClear();
      await service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
      expect(participantsRepo.add).not.toHaveBeenCalled();
    });

    it('помощник-руководитель вырезается; >10 → 422', async () => {
      await service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        managerId: HIP,
        assistantIds: [HIP, HELPER, HELPER],
      } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ assistantIds: [HELPER] }),
        {},
      );

      const eleven = Array.from(
        { length: 11 },
        (_, i) => `00000000-0000-4000-8000-0000000000${String(10 + i).padStart(2, '0')}`,
      );
      await expect(
        service.create(user(CREATOR), { name: 'x', typeId: TYPE, assistantIds: eleven } as never),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('неактивный руководитель/помощник → 422', async () => {
      profiles.filterActiveUserIds.mockResolvedValueOnce([]);
      await expect(
        service.create(user(CREATOR), { name: 'x', typeId: TYPE, managerId: HIP } as never),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('update', () => {
    it('смена на секретный — только действующий руководитель (помощник → 403)', async () => {
      participantsRepo.rowsOfProject.mockResolvedValue([
        {
          projectId: ID,
          userId: HELPER,
          source: 'assistant',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      await expect(
        service.update(user(HELPER), ID, { visibility: 'secret' } as never),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('раскрыть секретный (secret→open) может и помощник: пересчёт из задач', async () => {
      repo.findById.mockResolvedValue(row({ visibility: 'secret' }));
      participantsRepo.rowsOfProject.mockResolvedValue([
        {
          projectId: ID,
          userId: HELPER,
          source: 'assistant',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      participantsRepo.hasRow.mockResolvedValue(true);
      await service.update(user(HELPER), ID, { visibility: 'open' } as never);
      expect(repo.update).toHaveBeenCalledWith(
        {},
        ID,
        expect.objectContaining({ visibility: 'open' }),
      );
      expect(members.recomputeTaskSource).toHaveBeenCalledWith(ID);
    });

    it('не-руководство без project.manage → 403; project.manage достаточен', async () => {
      participantsRepo.rowsOfProject.mockResolvedValue([]);
      await expect(
        service.update(user(HELPER), ID, { name: 'новое' } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      await service.update(user(HELPER, ['project.manage']), ID, { name: 'новое' } as never);
      expect(repo.update).toHaveBeenCalledWith({}, ID, { name: 'новое' });
    });

    it('очистка обязательного «Шифра» (legacy null) → 422 PROJECT_FIELDS_REQUIRED clear', async () => {
      repo.findById.mockResolvedValue(row({ customFields: { [CODE]: '2026-01' } }));
      types.findById.mockResolvedValue(typeRow({ fields: [{ fieldId: CODE, state: 'required' }] }));
      participantsRepo.rowsOfProject.mockResolvedValue([
        {
          projectId: ID,
          userId: CREATOR,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      await expect(
        service.update(user(CREATOR), ID, { code: null } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.PROJECT_FIELDS_REQUIRED,
        details: { typeId: TYPE, fields: [CODE], reason: 'clear' },
      });
      // Патч реестра собран из legacy-поля до проверки очистки.
      expect(customFields.prepareUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          current: { [CODE]: '2026-01' },
          patch: { [CODE]: null },
          target: { kind: 'project_type', id: TYPE },
        }),
      );
    });

    it('событие UPDATED несёт производный заказчика из customFields', async () => {
      repo.findById.mockResolvedValue(row({ customFields: { [CLIENT]: 'cp-1' } }));
      types.findById.mockResolvedValue(
        typeRow({ fields: [{ fieldId: CLIENT, state: 'optional' }] }),
      );
      participantsRepo.rowsOfProject.mockResolvedValue([
        {
          projectId: ID,
          userId: CREATOR,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      customFields.prepareUpdate.mockResolvedValue({
        next: { [CLIENT]: 'cp-2' },
        changes: [{ fieldId: CLIENT, from: 'cp-1', to: 'cp-2' }],
      });

      await service.update(user(CREATOR), ID, { clientId: 'cp-2' } as never);
      expect(repo.update).toHaveBeenCalledWith(
        {},
        ID,
        expect.objectContaining({ customFields: { [CLIENT]: 'cp-2' } }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.UPDATED,
        expect.objectContaining({
          projectId: ID,
          fields: [`cf.${CLIENT}`],
          clientId: 'cp-2',
          previousClientId: 'cp-1',
        }),
        expect.anything(),
      );
    });
  });

  describe('assertVisible (Т1: 404 без оракула)', () => {
    it('открытый — всем; секретный — участию и view_secret, прочим 404', async () => {
      await expect(service.assertVisible(user(HELPER), ID)).resolves.toBeTruthy();

      repo.findById.mockResolvedValue(row({ visibility: 'secret' }));
      participantsRepo.hasRow.mockResolvedValueOnce(false);
      await expect(service.assertVisible(user(HELPER), ID)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      // 404, а не 403 — нет оракула существования секретного проекта
      participantsRepo.hasRow.mockResolvedValueOnce(true);
      await expect(
        service.assertVisible(user(HELPER, ['project.view_secret']), ID),
      ).resolves.toBeTruthy();
    });
  });

  describe('настройки портала (Р7)', () => {
    it('чтение дефолта: секретная настройка читается, мусор → open', async () => {
      repo.settingValue.mockResolvedValueOnce('secret');
      await expect(service.defaultVisibility()).resolves.toBe('secret');
      repo.settingValue.mockResolvedValueOnce('nonsense');
      await expect(service.defaultVisibility()).resolves.toBe('open');
    });
  });
});
