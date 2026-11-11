import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission, PROJECT_EVENTS } from '@nodus/contracts';

import {
  CLIENT,
  CODE,
  CREATOR,
  HELPER,
  HIP,
  ID,
  makeProjectsServiceKit,
  row,
  TYPE,
  typeRow,
  user,
} from './projects-service.test-kit.js';

/**
 * Сервис проектов (#52, #631 Р9/Р10): создание (наблюдатели, руководство,
 * legacy code/clientId → атрибуты, обязательные слоты), видимость и
 * настройки портала. Моки — projects-service.test-kit.ts; правка полей —
 * projects-update.service.test.ts.
 */

describe('ProjectsService (#52, #631 Р9/Р10)', () => {
  const kit = makeProjectsServiceKit();
  const { repo, types, participantsRepo, members, profiles, customFields, eventBus } = kit;

  beforeEach(() => kit.reset());

  describe('create', () => {
    it('дефолт видимости — настройка портала (нет строки → open); событие created', async () => {
      await kit.service.create(user(CREATOR), {
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
      await kit.service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ visibility: 'secret' }),
        {},
      );
    });

    it('явная visibility сильнее настройки портала', async () => {
      await kit.service.create(user(CREATOR), {
        name: 'x',
        typeId: TYPE,
        visibility: 'open',
      } as never);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'open' }), {});
    });

    it('скопинг реестра — target тип проекта; значения пишутся в customFields', async () => {
      await kit.service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
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
      await kit.service.create(user(CREATOR), {
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

      await kit.service.create(user(CREATOR), {
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
        kit.service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.PROJECT_FIELDS_REQUIRED,
        details: { typeId: TYPE, fields: [`cf.${CODE}`], reason: 'create' },
      });
      expect(repo.create).not.toHaveBeenCalled();

      // Значение (legacy или атрибут) закрывает обязательность.
      await kit.service.create(user(CREATOR), {
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
      await kit.service.create(user(CREATOR), {
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
      // Синк руководства на создании — без служебного события состава (#699).
      expect(members.syncManagement).toHaveBeenCalledWith(
        {},
        ID,
        { managerId: CREATOR, assistantIds: [HELPER] },
        { notify: false },
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.CREATED,
        expect.objectContaining({ observerIds: [HIP] }),
        expect.anything(),
      );
    });

    it('создатель-не-руководитель → наблюдатель-создатель; РП по умолчанию — создатель', async () => {
      await kit.service.create(user(CREATOR), {
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
      await kit.service.create(user(CREATOR), { name: 'x', typeId: TYPE } as never);
      expect(participantsRepo.add).not.toHaveBeenCalled();
    });

    it('помощник-руководитель вырезается; >10 → 422', async () => {
      await kit.service.create(user(CREATOR), {
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
        kit.service.create(user(CREATOR), {
          name: 'x',
          typeId: TYPE,
          assistantIds: eleven,
        } as never),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('неактивный руководитель/помощник → 422', async () => {
      profiles.filterActiveUserIds.mockResolvedValueOnce([]);
      await expect(
        kit.service.create(user(CREATOR), { name: 'x', typeId: TYPE, managerId: HIP } as never),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('assertVisible (Т1: 404 без оракула)', () => {
    it('открытый — всем; секретный — участию и view_secret, прочим 404', async () => {
      await expect(kit.service.assertVisible(user(HELPER), ID)).resolves.toBeTruthy();

      repo.findById.mockResolvedValue(row({ visibility: 'secret' }));
      participantsRepo.hasRow.mockResolvedValueOnce(false);
      await expect(kit.service.assertVisible(user(HELPER), ID)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      // 404, а не 403 — нет оракула существования секретного проекта
      participantsRepo.hasRow.mockResolvedValueOnce(true);
      await expect(
        kit.service.assertVisible(user(HELPER, ['project.view_secret']), ID),
      ).resolves.toBeTruthy();
    });
  });

  describe('настройки портала (Р7)', () => {
    it('чтение дефолта: секретная настройка читается, мусор → open', async () => {
      repo.settingValue.mockResolvedValueOnce('secret');
      await expect(kit.service.defaultVisibility()).resolves.toBe('secret');
      repo.settingValue.mockResolvedValueOnce('nonsense');
      await expect(kit.service.defaultVisibility()).resolves.toBe('open');
    });
  });

  describe('assertManageLocked (#705): гард по свежей строке под FOR UPDATE', () => {
    it('строки проекта нет под замком — 404', async () => {
      await expect(
        kit.service.assertManageLocked(user(CREATOR), ID, null, {} as never),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('архив: поля проекта — только project.manage, структура — запрещена даже ему', async () => {
      participantsRepo.rowsOfProject.mockResolvedValue([{ userId: CREATOR, source: 'manager' }]);

      await expect(
        kit.service.assertManageLocked(
          user(CREATOR),
          ID,
          { status: 'archived', visibility: 'open' },
          {} as never,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      await expect(
        kit.service.assertManageLocked(
          user(HELPER, [Permission.PROJECT_MANAGE]),
          ID,
          { status: 'archived', visibility: 'open' },
          {} as never,
        ),
      ).resolves.toBeUndefined();

      await expect(
        kit.service.assertManageLocked(
          user(HELPER, [Permission.PROJECT_MANAGE]),
          ID,
          { status: 'archived', visibility: 'open' },
          {} as never,
          { archived: 'forbid' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('сняли с роли под замком — 403; project.manage остаётся', async () => {
      participantsRepo.rowsOfProject.mockResolvedValue([{ userId: HELPER, source: 'assistant' }]);

      await expect(
        kit.service.assertManageLocked(
          user(CREATOR),
          ID,
          { status: 'active', visibility: 'open' },
          {} as never,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      await expect(
        kit.service.assertManageLocked(
          user(CREATOR, [Permission.PROJECT_MANAGE]),
          ID,
          { status: 'active', visibility: 'open' },
          {} as never,
        ),
      ).resolves.toBeUndefined();

      expect(participantsRepo.rowsOfProject).toHaveBeenCalledWith(ID, {});
    });

    it('перевод в секретность под замком: постороннему с project.manage — 404 (#705)', async () => {
      participantsRepo.rowsOfProject.mockResolvedValue([{ userId: HELPER, source: 'manager' }]);

      await expect(
        kit.service.assertManageLocked(
          user(CREATOR, [Permission.PROJECT_MANAGE]),
          ID,
          { status: 'active', visibility: 'secret' },
          {} as never,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      await expect(
        kit.service.assertManageLocked(
          user(CREATOR, [Permission.PROJECT_MANAGE, Permission.PROJECT_VIEW_SECRET]),
          ID,
          { status: 'active', visibility: 'secret' },
          {} as never,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
