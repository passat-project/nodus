import { expect } from 'vitest';
import {
  Permission,
  customFieldDefinitionSchema,
  taskListItemSchema,
  workflowTransitionSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Фикстура интеграционных тестов кастомных атрибутов (#431): живое
 * приложение, флаги модулей, два токена одного сотрудника — с правами
 * управления реестром и без. Снимок системной кнопки «Завершить» и её
 * публикация снимаются ДО тестов и возвращаются в уборке: наборы делят
 * `nodus_test`, а каталог маршрутов «засевается один раз» и не перетирает
 * изменённый маршрут (gotcha «тест, меняющий системный маршрут»).
 */
export interface CustomFieldsFixture {
  fx: ChatTestFixture<'alice' | 'bob'>;
  admin: ChatUser;
  plain: ChatUser;
  /** `custom_field.manage` БЕЗ `dictionary.manage` (#604): сервер обязан
   *  отказать в словарных операциях, даже если UI их блокирует (I8). */
  fieldAdmin: ChatUser;
  dispatcher: EventDispatcher;
  /** id определений и задач прогона — уборка и проверки. */
  definitionIds: string[];
  taskIds: string[];
  dictionaryIds: string[];
  departmentIds: string[];
  /** Контрагенты прогона (#646): значения атрибутов в custom_fields. */
  counterpartyIds: string[];
  /** Создать определение (создаёт и запоминает id). */
  createField(body: Record<string, unknown>): Promise<z.infer<typeof customFieldDefinitionSchema>>;
  /** Создать задачу прогона (создаёт и запоминает id). */
  createTask(title?: string): Promise<string>;
  /** «Взять в работу»: кнопка «Завершить» доступна только из работы. */
  startTask(taskId: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function setupCustomFieldsFixture(): Promise<CustomFieldsFixture> {
  const fx = await setupChatFixture(['alice', 'bob']);
  for (const key of ['tasks', 'chat', 'projects']) {
    await fx.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled: true },
      create: { key, enabled: true },
    });
  }
  const tokens = fx.app.get(TokenService);
  const sign = async (user: ChatUser, permissions: string[]): Promise<ChatUser> => ({
    ...user,
    token: await tokens.signAccessToken(
      { id: user.id, email: user.email, displayName: user.displayName, permissions },
      'integration-test-session',
    ),
  });
  const admin = await sign(fx.users.alice, [
    Permission.TASK_CREATE,
    Permission.TASK_MANAGE_ANY,
    Permission.CUSTOM_FIELD_MANAGE,
    Permission.DICTIONARY_MANAGE,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_SETUP_MANAGE,
  ]);
  const plain = await sign(fx.users.bob, [Permission.TASK_CREATE]);
  const fieldAdmin = await sign(fx.users.bob, [Permission.CUSTOM_FIELD_MANAGE]);
  const dispatcher = fx.app.get(EventDispatcher);

  // Детерминизм против прошлых прогонов — ТОЛЬКО форма окна: правила
  // системного каталога (`no_open_subtasks` и др.) не трогаем, иначе
  // соседние наборы теряют гейты (класс #486 — тест не изолирует данные).
  // Стандартный тип: атрибуты набора привязаны к нему (#432, Р8) — без
  // привязки атрибут нигде не виден и не принимает значения.
  const standardType = await fx.prisma.processType.findUnique({ where: { code: 'task' } });
  if (!standardType) throw new Error('Standard process type not found');
  const standard = await fx.prisma.workflow.findUnique({ where: { code: 'task.default' } });
  let completeOriginal: { id: string; form: unknown; rules: unknown } | null = null;
  let standardId: string | null = null;
  let standardPublishedAt: Date | null = null;
  if (standard) {
    const complete = await fx.prisma.workflowTransition.findFirstOrThrow({
      where: { workflowId: standard.id, name: 'Завершить', archivedAt: null },
    });
    completeOriginal = { id: complete.id, form: complete.form, rules: complete.rules };
    standardId = standard.id;
    standardPublishedAt = standard.publishedAt;
    await fx.prisma.workflowTransition.update({
      where: { id: complete.id },
      data: { form: {} },
    });
    // Использование атрибута считается по ОПУБЛИКОВАННЫМ маршрутам (Р7):
    // фикстура публикует системный, иначе кейс удаления ничего не проверяет.
    await fx.prisma.workflow.update({
      where: { id: standard.id },
      data: { publishedAt: new Date() },
    });
  }

  const fixture: CustomFieldsFixture = {
    fx,
    admin,
    plain,
    fieldAdmin,
    dispatcher,
    definitionIds: [],
    taskIds: [],
    dictionaryIds: [],
    departmentIds: [],
    counterpartyIds: [],
    async createField(body) {
      // Привязка к «Стандартному» типу задач по умолчанию (#631 Р3): без
      // неё атрибут нигде не виден и не принимает значения; явные bindings
      // тела сливаются по массивам.
      const { bindings: _bodyBindings, ...rest } = body;
      // Глобальной переменной (isCompany) привязки запрещены контрактом —
      // дефолтную привязку к типу не добавляем.
      const incoming = (Array.isArray(_bodyBindings) ? {} : _bodyBindings) ?? {};
      const bindings = rest.isCompany
        ? { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] }
        : {
            processTypeIds: [standardType.id],
            projectTypeIds: [],
            nodeKindIds: [],
            ...incoming,
          };
      const res = await fx.api(admin, 'POST', '/custom-fields/definitions', {
        body: { bindings, ...rest },
        key: `it-cf-${crypto.randomUUID()}`,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const definition = customFieldDefinitionSchema.parse(await res.json());
      fixture.definitionIds.push(definition.id);
      return definition;
    },
    async createTask(title = `Проба ${fx.runId} атрибуты`) {
      const res = await fx.api(admin, 'POST', '/tasks', {
        body: { title, assigneeId: admin.id },
        key: `it-cf-task-${crypto.randomUUID()}`,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const task = taskListItemSchema.parse(await res.json());
      fixture.taskIds.push(task.id);
      return task.id;
    },
    async startTask(taskId) {
      const buttons = z
        .array(workflowTransitionSchema)
        .parse(await (await fx.api(admin, 'GET', `/tasks/${taskId}/transitions`)).json());
      const start = buttons.find((t) => t.name === 'Взять в работу');
      if (!start) return;
      const res = await fx.api(admin, 'POST', `/tasks/${taskId}/transitions/${start.id}`, {
        body: {},
        key: `it-cf-start-${crypto.randomUUID()}`,
      });
      expect(res.status, await res.clone().text()).toBe(200);
    },
    async cleanup() {
      if (standardId) {
        await fx.prisma.workflow.update({
          where: { id: standardId },
          data: { publishedAt: standardPublishedAt },
        });
      }
      if (completeOriginal) {
        await fx.prisma.workflowTransition.update({
          where: { id: completeOriginal.id },
          data: {
            form: completeOriginal.form as never,
            rules: completeOriginal.rules as never,
          },
        });
      }
      if (fixture.taskIds.length > 0) {
        await fx.prisma.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
      }
      if (fixture.counterpartyIds.length > 0) {
        await fx.prisma.counterparty.deleteMany({ where: { id: { in: fixture.counterpartyIds } } });
      }
      await fx.prisma.event.deleteMany({
        where: { aggregateType: 'field_definition', aggregateId: { in: fixture.definitionIds } },
      });
      await fx.prisma.event.deleteMany({
        where: { aggregateType: 'dictionary', aggregateId: { in: fixture.dictionaryIds } },
      });
      await fx.prisma.fieldDefinition.deleteMany({ where: { id: { in: fixture.definitionIds } } });
      await fx.prisma.dictionaryItem.deleteMany({
        where: { dictionaryId: { in: fixture.dictionaryIds } },
      });
      await fx.prisma.dictionary.deleteMany({ where: { id: { in: fixture.dictionaryIds } } });
      if (fixture.departmentIds.length > 0) {
        await fx.prisma.department.deleteMany({ where: { id: { in: fixture.departmentIds } } });
      }
      await fx.cleanup();
    },
  };
  return fixture;
}
