import { expect } from 'vitest';
import {
  ErrorCode,
  Permission,
  letterDetailSchema,
  letterHistoryEntrySchema,
  paginatedSchema,
  workflowTransitionSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { dispatchOwnEvent, quiesceOutbox } from './outbox-test-utils.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Фикстура интеграционных тестов корреспонденции (#55): живое приложение на
 * реальных PG/Redis, три роли — канцелярия (регистрация), сотрудник (только
 * чтение), решающий (`correspondence.resolve`). Данные прогона удаляются
 * целиком: письма, вложения, участники, беседы, события, аудит, контрагенты.
 */
export interface CorrespondenceFixture {
  fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  registrar: ChatUser;
  employee: ChatUser;
  resolver: ChatUser;
  /** id типа «Входящее письмо» (каталог сеет бутстрап). */
  incomingTypeId: string;
  /** HTTP-вызов с JSON-телом (как в chat-фикстуре). */
  api: ChatTestFixture['api'];
  /** multipart-создание письма: typeId, mainIndex, файлы. */
  createLetter(
    user: ChatUser,
    files: { name: string; mime: string; bytes: Uint8Array }[],
    opts?: { typeId?: string; mainIndex?: number; key?: string },
  ): Promise<Response>;
  dispatcher: EventDispatcher;
  /** Довезти события письма до обработчиков (outbox → chat/crm-проекции). */
  flushLetterEvents(letterId: string): Promise<void>;
  /** Кнопка «Зарегистрировать» и готовый ввод окна регистрации. */
  registerButton(user: ChatUser, letterId: string): Promise<{ id: string; name: string }>;
  registrationPayload(): Promise<Record<string, unknown>>;
  /** Зарегистрировать письмо: кнопка маршрута + окно «Регистрация». */
  register(
    user: ChatUser,
    letterId: string,
    input?: Record<string, unknown>,
    key?: string,
  ): Promise<Response>;
  cleanup(): Promise<void>;
}

export async function setupCorrespondenceFixture(): Promise<CorrespondenceFixture> {
  const fx = await setupChatFixture(['alice', 'bob', 'carol']);
  await fx.prisma.featureFlag.upsert({
    where: { key: 'correspondence' },
    update: { enabled: true },
    create: { key: 'correspondence', enabled: true },
  });
  const incoming = await fx.prisma.processType.findUnique({ where: { code: 'letter-incoming' } });
  if (!incoming) throw new Error('Letter incoming type not found (catalog bootstrap failed)');

  const tokens = fx.app.get(TokenService);
  const sign = async (user: ChatUser, permissions: string[]): Promise<ChatUser> => ({
    ...user,
    token: await tokens.signAccessToken(
      { id: user.id, email: user.email, displayName: user.displayName, permissions },
      'integration-test-session',
    ),
  });
  const registrar = await sign(fx.users.alice, [
    Permission.CORRESPONDENCE_REGISTER,
    Permission.CRM_CREATE,
    Permission.CRM_MANAGE,
  ]);
  const employee = await sign(fx.users.bob, []);
  const resolver = await sign(fx.users.carol, [Permission.CORRESPONDENCE_RESOLVE]);

  const baseCleanup = fx.cleanup.bind(fx);
  const fixture: CorrespondenceFixture = {
    fx,
    registrar,
    employee,
    resolver,
    incomingTypeId: incoming.id,
    api: fx.api,
    dispatcher: fx.app.get(EventDispatcher),
    async flushLetterEvents(letterId) {
      const events = await fx.prisma.event.findMany({
        where: { aggregateType: 'letter', aggregateId: letterId },
        select: { id: true },
      });
      for (const event of events) {
        await dispatchOwnEvent(fixture.dispatcher, fx.prisma, event.id);
      }
    },
    async registerButton(user, letterId) {
      const res = await fx.api(user, 'GET', `/letters/${letterId}/transitions`);
      expect(res.status, await res.clone().text()).toBe(200);
      const transitions = z.array(workflowTransitionSchema).parse(await res.json());
      const button = transitions.find((transition) => transition.name === 'Зарегистрировать');
      if (!button) throw new Error('Register transition not available');
      return { id: button.id, name: button.name };
    },
    async registrationPayload() {
      return {
        counterpartyId: await createCounterparty(fixture),
        signerId: null,
        theirNumber: `ИТ-${fx.runId.slice(0, 6)}`,
        theirDate: today(),
        subject: `Проба ${fx.runId} регистрация`,
        receiptMethodId: await receiptMethodId(fixture),
        projectId: null,
        addresseeId: resolver.id,
        responseDeadline: null,
      };
    },
    async createLetter(user, files, opts = {}) {
      const form = new FormData();
      form.append('typeId', opts.typeId ?? incoming.id);
      form.append('mainIndex', String(opts.mainIndex ?? 0));
      for (const file of files) {
        form.append('files', new Blob([file.bytes], { type: file.mime }), file.name);
      }
      return fetch(`${fx.baseUrl}/letters`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${user.token}`,
          'idempotency-key': opts.key ?? `it-letter-${crypto.randomUUID()}`,
        },
        body: form,
      });
    },
    async register(user, letterId, input, key) {
      const button = await fixture.registerButton(user, letterId);
      const registration = input ?? (await fixture.registrationPayload());
      return fx.api(user, 'POST', `/letters/${letterId}/transitions/${button.id}`, {
        body: { form: { registration } },
        key: key ?? `it-letter-reg-${crypto.randomUUID()}`,
      });
    },
    async cleanup() {
      // #528: фоновая доставка letter.* (counterparty_usages) может приземлиться
      // между удалением usages и контрагентов — FK роняет teardown. Гасим
      // поллер и дожидаемся прохода ДО уборки, а не надеемся на пустой хвост.
      await quiesceOutbox(fixture.dispatcher);
      const userIds = Object.values(fx.users).map((user) => user.id);
      const letters = await fx.prisma.letter.findMany({
        where: { createdBy: { in: userIds } },
        select: { id: true },
      });
      const ids = letters.map((letter) => letter.id);
      if (ids.length > 0) {
        await fx.prisma.counterpartyUsage.deleteMany({
          where: { sourceKind: 'letter', sourceId: { in: ids } },
        });
        await fx.prisma.event.deleteMany({
          where: { aggregateType: 'letter', aggregateId: { in: ids } },
        });
        await fx.prisma.letter.deleteMany({ where: { id: { in: ids } } });
      }
      // Контрагенты прогона — только те, что создала фикстура (email-маркер).
      await fx.prisma.counterpartyUsage.deleteMany({
        where: { counterparty: { email: `it-${fx.runId}@example.test` } },
      });
      // Контакты прогона — до контрагента (FK RESTRICT).
      const testCounterparties = await fx.prisma.counterparty.findMany({
        where: { email: `it-${fx.runId}@example.test` },
        select: { id: true },
      });
      await fx.prisma.contactPerson.deleteMany({
        where: { counterpartyId: { in: testCounterparties.map((row) => row.id) } },
      });
      await fx.prisma.counterparty.deleteMany({
        where: { email: `it-${fx.runId}@example.test` },
      });
      await baseCleanup();
    },
  };
  return fixture;
}

/** ISO-дата «сегодня» по Минску — грамматика сервера и формы. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Контрагент прогона (создаётся канцелярией через API, кэш на фикстуру). */
const counterparties = new WeakMap<CorrespondenceFixture, string>();
async function createCounterparty(fixture: CorrespondenceFixture): Promise<string> {
  const cached = counterparties.get(fixture);
  if (cached) return cached;
  const res = await fixture.api(fixture.registrar, 'POST', '/counterparties', {
    body: {
      shortName: `ИТ ${fixture.fx.runId.slice(0, 8)}`,
      fullName: `ООО «Проба ${fixture.fx.runId}»`,
      email: `it-${fixture.fx.runId}@example.test`,
    },
    key: `it-cp-${fixture.fx.runId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const body = (await res.json()) as { id: string };
  counterparties.set(fixture, body.id);
  return body.id;
}

/** Элемент справочника «Почта» (засеян миграцией). */
const receipts = new WeakMap<CorrespondenceFixture, string>();
async function receiptMethodId(fixture: CorrespondenceFixture): Promise<string> {
  const cached = receipts.get(fixture);
  if (cached) return cached;
  const dictionary = await fixture.fx.prisma.dictionary.findUniqueOrThrow({
    where: { code: 'receipt-method' },
  });
  const item = await fixture.fx.prisma.dictionaryItem.findFirstOrThrow({
    where: { dictionaryId: dictionary.id, code: 'post' },
  });
  receipts.set(fixture, item.id);
  return item.id;
}

/** Разбор ответа регистрации: письмо + кнопки. */
export const registrationResult = z.object({
  letter: letterDetailSchema,
  transitions: z.array(workflowTransitionSchema),
});

/** Страница истории. */
export const historyPage = paginatedSchema(letterHistoryEntrySchema);

/** Ошибка API по коду. */
export function expectCode(body: unknown, code: ErrorCode): void {
  expect((body as { code?: string }).code).toBe(code);
}
