import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, PROJECT_EVENTS } from '@nodus/contracts';

import {
  CLIENT,
  CODE,
  CREATOR,
  HELPER,
  ID,
  makeProjectsServiceKit,
  row,
  TYPE,
  typeRow,
  user,
} from './projects-service.test-kit.js';

/**
 * Правка полей проекта (#52, #631 Р9/Р10): секретность (только
 * действующий руководитель), права project.manage, обязательные слоты
 * (очистка «Шифра») и событие UPDATED с производным заказчиком.
 * Моки — projects-service.test-kit.ts; создание и настройки —
 * projects.service.test.ts.
 */

describe('ProjectsService (#52, #631 Р9/Р10)', () => {
  const kit = makeProjectsServiceKit();
  const { repo, types, participantsRepo, members, customFields, eventBus } = kit;

  beforeEach(() => kit.reset());

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
        kit.service.update(user(HELPER), ID, { visibility: 'secret' } as never),
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
      await kit.service.update(user(HELPER), ID, { visibility: 'open' } as never);
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
        kit.service.update(user(HELPER), ID, { name: 'новое' } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      await kit.service.update(user(HELPER, ['project.manage']), ID, { name: 'новое' } as never);
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
        kit.service.update(user(CREATOR), ID, { code: null } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.PROJECT_FIELDS_REQUIRED,
        details: { typeId: TYPE, fields: [`cf.${CODE}`], reason: 'clear' },
      });
      // Патч реестра собран из legacy-поля до проверки очистки.
      expect(customFields.prepareUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          current: { [CODE]: '2026-01' },
          patch: { [CODE]: null },
          target: { kind: 'project_type', id: TYPE },
        }),
        expect.anything(),
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

      await kit.service.update(user(CREATOR), ID, { clientId: 'cp-2' } as never);
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

    it('project.updated: снятый помощник не получает имя/шифр секретного проекта (#646)', async () => {
      repo.findById.mockResolvedValue(
        row({
          visibility: 'secret',
          assistantIds: [HELPER],
          customFields: { [CODE]: '22-01' },
        }),
      );
      types.findById.mockResolvedValue(typeRow({ fields: [{ fieldId: CODE, state: 'optional' }] }));
      // После syncManagement в составе остался только руководитель:
      // аудитория считается по состоянию ПОСЛЕ правки.
      participantsRepo.rowsOfProject.mockResolvedValue([
        {
          projectId: ID,
          userId: CREATOR,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      customFields.prepareUpdate.mockResolvedValue({ next: {}, changes: [] });

      await kit.service.update(user(CREATOR), ID, { assistantIds: [] } as never);

      const call = eventBus.emit.mock.calls.find(([, type]) => type === PROJECT_EVENTS.UPDATED);
      expect(call).toBeTruthy();
      const payload = call![2] as { audience: string[] };
      expect(payload.audience).toContain(CREATOR);
      expect(payload.audience).not.toContain(HELPER);
    });
  });
});
