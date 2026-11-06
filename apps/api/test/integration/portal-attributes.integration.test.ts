import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  SYSTEM_FIELD_IDS,
  taskDetailSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { Permission } from '@nodus/contracts';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Атрибуты на весь портал (#631, §6-матрица): параллельные одноимённые
 * создания, ссылки на записи и их видимость двумя пользователями, глобальная
 * переменная (одна строка на компанию), обязательные слоты формы типа
 * проекта. Живой HTTP + PostgreSQL (integration, patterns.md).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'атрибуты портала: имена, ссылки-записи, глобальные (integration, #631)',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('параллельные одноимённые создания: один 201, второй 409 с suggestion', async () => {
      const name = `Параллель ${cf.fx.runId}`;
      const body = { type: 'text', name };
      const [first, second] = await Promise.all([
        cf.fx.api(cf.admin, 'POST', '/custom-fields/definitions', { body }),
        cf.fx.api(cf.admin, 'POST', '/custom-fields/definitions', { body }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = first.status === 409 ? first : second;
      const parsed = apiErrorResponseSchema.parse(await conflict.json());
      expect(parsed.code).toBe(ErrorCode.CUSTOM_FIELD_NAME_TAKEN);
      expect(parsed.details).toMatchObject({
        suggestion: { name },
      });
      expect(
        (parsed.details as { suggestion: { definitionId: string } }).suggestion.definitionId,
      ).toBeTruthy();
    });

    it('параллельные одноимённые правки: один 200, второй 409 с suggestion', async () => {
      const first = await cf.createField({ type: 'text', name: `Правка A ${cf.fx.runId}` });
      const second = await cf.createField({ type: 'text', name: `Правка B ${cf.fx.runId}` });
      const name = `Правка общая ${cf.fx.runId}`;
      const patch = (id: string) =>
        cf.fx.api(cf.admin, 'PATCH', `/custom-fields/definitions/${id}`, { body: { name } });
      const [one, two] = await Promise.all([patch(first.id), patch(second.id)]);
      expect([one.status, two.status].sort()).toEqual([200, 409]);
      const conflict = one.status === 409 ? one : two;
      const parsed = apiErrorResponseSchema.parse(await conflict.json());
      expect(parsed.code).toBe(ErrorCode.CUSTOM_FIELD_NAME_TAKEN);
      expect(parsed.details).toMatchObject({ suggestion: { name } });
    });

    it('ссылка на конфиденциальную задачу: участник ставит, не-участник — 422 not_found', async () => {
      const field = await cf.createField({ type: 'task', name: `Связанная задача ${cf.fx.runId}` });
      const task = await cf.createTask(`Конфиденциальная ${cf.fx.runId}`);
      await cf.fx.prisma.task.update({
        where: { id: task },
        data: { confidential: true },
      });

      // Admin — автор (участник): значение ставится.
      const asParticipant = await cf.fx.api(cf.admin, 'PATCH', `/tasks/${task}`, {
        body: { customFields: { [field.id]: task } },
      });
      expect(asParticipant.status).toBe(200);

      // Значение на месте, ссылка гидрируется именем для автора.
      const detail = taskDetailSchema.parse(
        await (await cf.fx.api(cf.admin, 'GET', `/tasks/${task}`)).json(),
      );
      expect(detail.customFields[field.id]).toBe(task);
      const ref = detail.customFieldRefs.find((entry) => entry.id === task);
      expect(ref).toMatchObject({ kind: 'task', name: expect.any(String) });

      // Bob (не-участник конфиденциальной) не может поставить такую ссылку.
      const asStranger = await cf.fx.api(cf.plain, 'PATCH', `/tasks/${task}`, {
        body: { customFields: { [field.id]: task } },
      });
      expect([403, 404]).toContain(asStranger.status);
      // 403/404 — саму задачу он не видит; проверка самой ссылки — через
      // свою задачу: bob создаёт задачу и пытается сослаться на скрытую.
      const own = await cf.fx.api(cf.plain, 'POST', '/tasks', {
        body: { title: `Задача боба ${cf.fx.runId}`, assigneeId: cf.plain.id },
      });
      expect(own.status).toBe(201);
      const ownId = ((await own.json()) as { id: string }).id;
      const withRef = await cf.fx.api(cf.plain, 'PATCH', `/tasks/${ownId}`, {
        body: { customFields: { [field.id]: task } },
      });
      expect(withRef.status).toBe(422);
      const error = apiErrorResponseSchema.parse(await withRef.json());
      expect(error.code).toBe(ErrorCode.CUSTOM_FIELD_VALUE_INVALID);
      expect(error.details).toMatchObject({
        issues: [{ fieldId: field.id, reason: 'not_found' }],
      });

      await cf.taskIds.push(ownId);
    });

    it('refs двумя пользователями: имя скрытой цели — null у не-участника', async () => {
      const field = await cf.createField({ type: 'task', name: `Ссылка-имя ${cf.fx.runId}` });
      const secret = await cf.createTask(`Скрытая от боба ${cf.fx.runId}`);
      await cf.fx.prisma.task.update({
        where: { id: secret },
        data: { confidential: true },
      });
      // Admin ставит значение-ссылку.
      await cf.fx.api(cf.admin, 'PATCH', `/tasks/${secret}`, {
        body: { customFields: { [field.id]: secret } },
      });

      // Admin (участник) видит имя; bob не видит — name null, id не скрыт.
      const adminDetail = taskDetailSchema.parse(
        await (await cf.fx.api(cf.admin, 'GET', `/tasks/${secret}`)).json(),
      );
      const adminRef = adminDetail.customFieldRefs.find((entry) => entry.id === secret);
      expect(adminRef?.name).toBeTruthy();

      const bobCanSee = await cf.fx.api(cf.plain, 'GET', `/tasks/${secret}`);
      expect(bobCanSee.status).toBe(404);
      // Полный сценарий §6-4: ссылка стоит в задаче, которую bob видит;
      // значение ставит admin, refs собираются глазами bob — имя скрыто,
      // id не скрывается (значение уже стоит у записи).
      const own = await cf.fx.api(cf.admin, 'POST', '/tasks', {
        body: { title: `Задача боба refs ${cf.fx.runId}`, assigneeId: cf.plain.id },
      });
      expect(own.status, await own.clone().text()).toBe(201);
      const ownId = ((await own.json()) as { id: string }).id;
      cf.taskIds.push(ownId);
      const setByAdmin = await cf.fx.api(cf.admin, 'PATCH', `/tasks/${ownId}`, {
        body: { customFields: { [field.id]: secret } },
      });
      expect(setByAdmin.status, await setByAdmin.clone().text()).toBe(200);
      const bobDetail = taskDetailSchema.parse(
        await (await cf.fx.api(cf.plain, 'GET', `/tasks/${ownId}`)).json(),
      );
      const bobRef = bobDetail.customFieldRefs.find((entry) => entry.id === secret);
      expect(bobRef).toMatchObject({ kind: 'task', name: null, archived: false });
    });

    it('глобальная переменная: PUT×2 — одна строка, чтение всем, не-глобальному 422', async () => {
      const global = await cf.createField({
        type: 'number',
        name: `Мобилизация ${cf.fx.runId}`,
        isCompany: true,
      });
      const put = (value: number) =>
        cf.fx.api(cf.admin, 'PUT', `/custom-fields/definitions/${global.id}/company-value`, {
          body: { value },
        });
      // Пустое глобальное значение — DTO null (Review Focus §9, формулы #632).
      const before = await cf.fx.api(cf.admin, 'GET', '/custom-fields/definitions?module=company');
      const beforeList = z
        .array(z.object({ id: z.uuid(), companyValue: z.number().nullable() }))
        .parse(await before.json());
      expect(beforeList.find((entry) => entry.id === global.id)?.companyValue).toBeNull();
      expect((await put(14)).status).toBe(200);
      expect((await put(21)).status).toBe(200);

      const rows = await cf.fx.prisma.companyValue.findMany({
        where: { definitionId: global.id },
      });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.value)).toBe(21);

      // Чтение — всем аутентифицированным (настройки компании, не секрет).
      const asPlain = await cf.fx.api(cf.plain, 'GET', '/custom-fields/definitions?module=company');
      expect(asPlain.status).toBe(200);
      const list = z
        .array(z.object({ id: z.uuid(), companyValue: z.number().nullable() }))
        .parse(await asPlain.json());
      expect(list.find((entry) => entry.id === global.id)?.companyValue).toBe(21);

      // Не-глобальному значение нельзя.
      const plain = await cf.createField({ type: 'number', name: `Обычная ${cf.fx.runId}` });
      const rejected = await cf.fx.api(
        cf.admin,
        'PUT',
        `/custom-fields/definitions/${plain.id}/company-value`,
        {
          body: { value: 1 },
        },
      );
      expect(rejected.status, await rejected.clone().text()).toBe(422);
      expect(apiErrorResponseSchema.parse(await rejected.json()).code).toBe(
        ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      );
    });

    it('обязательный слот формы типа: создание без значения и очистка — 422 PROJECT_FIELDS_REQUIRED', async () => {
      // Токен с проектными правами (фикстурный admin — только задачи).
      const tokens = cf.fx.app.get(TokenService);
      const pmToken = await tokens.signAccessToken(
        {
          id: cf.admin.id,
          email: cf.admin.email,
          displayName: cf.admin.displayName,
          permissions: [Permission.PROJECT_CREATE, Permission.CUSTOM_FIELD_MANAGE],
        },
        'integration-test-session',
      );
      const pm = { ...cf.admin, token: pmToken };
      const api = (
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: string,
        init?: Record<string, unknown>,
      ) => cf.fx.api(pm, method, url, init);

      // Тип с обязательным «Шифром» (слот системного атрибута).
      const type = await cf.fx.prisma.projectType.create({
        data: {
          name: `Тип-обязательный ${cf.fx.runId}`,
          form: {
            fields: [
              { fieldId: SYSTEM_FIELD_IDS.projectCode, state: 'required' },
              { fieldId: SYSTEM_FIELD_IDS.projectClient, state: 'optional' },
            ],
          },
        },
      });
      // Привязка системных полей к типу — слот и есть привязка (Р10).
      await cf.fx.prisma.fieldBinding.createMany({
        data: [
          {
            definitionId: SYSTEM_FIELD_IDS.projectCode,
            targetKind: 'project_type',
            targetId: type.id,
          },
          {
            definitionId: SYSTEM_FIELD_IDS.projectClient,
            targetKind: 'project_type',
            targetId: type.id,
          },
        ],
        skipDuplicates: true,
      });

      const manager = await cf.fx.prisma.user.findFirstOrThrow({
        where: { id: cf.admin.id },
        select: { id: true },
      });
      const base = {
        name: `Проект ${cf.fx.runId}`,
        typeId: type.id,
        managerId: manager.id,
      };

      // Создание без шифра — 422 create.
      const noCode = await api('POST', '/projects', { body: base });
      expect(noCode.status).toBe(422);
      const createError = apiErrorResponseSchema.parse(await noCode.json());
      expect(createError.code).toBe(ErrorCode.PROJECT_FIELDS_REQUIRED);
      expect(createError.details).toMatchObject({ reason: 'create' });

      // С шифром — 201; DTO несёт производные.
      const created = await api('POST', '/projects', {
        body: { ...base, customFields: { [SYSTEM_FIELD_IDS.projectCode]: 'ПР-1' } },
      });
      expect(created.status).toBe(201);
      const project = z
        .object({ id: z.uuid(), code: z.string().nullable() })
        .parse(await created.json());
      expect(project.code).toBe('ПР-1');

      // Очистка обязательного — 422 clear.
      const cleared = await api('PATCH', `/projects/${project.id}`, {
        body: { customFields: { [SYSTEM_FIELD_IDS.projectCode]: null } },
      });
      expect(cleared.status).toBe(422);
      const clearError = apiErrorResponseSchema.parse(await cleared.json());
      expect(clearError.details).toMatchObject({ reason: 'clear' });

      await cf.fx.prisma.project.deleteMany({ where: { id: project.id } });
      await cf.fx.prisma.projectType.deleteMany({ where: { id: type.id } });
    });
  },
);
