import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  apiErrorResponseSchema,
  letterDetailSchema,
  type LetterDetail,
} from '@nodus/contracts';

import { FileAccessRegistry } from '../../src/core/ports/file-access.registry.js';
import { waitForAudit } from './audit-test-utils.js';
import {
  historyPage,
  registrationResult,
  setupCorrespondenceFixture,
  today,
  type CorrespondenceFixture,
} from './correspondence-fixtures.js';

const FILE = { name: 'scan.pdf', mime: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };
const seqOf = (regNumber: string): number => Number(regNumber.split('/')[1]);

describe.skipIf(!process.env.DATABASE_URL)(
  'корреспонденция: регистрация, видимость, нумерация, чат (integration, #55)',
  () => {
    let c: CorrespondenceFixture;

    beforeAll(async () => {
      c = await setupCorrespondenceFixture();
    }, 180_000);

    afterAll(async () => {
      await c?.cleanup();
    });

    async function newLetter(): Promise<string> {
      const res = await c.createLetter(c.registrar, [FILE]);
      expect(res.status, await res.clone().text()).toBe(201);
      return letterDetailSchema.parse(await res.json()).id;
    }

    it('реестр прав файлов видит оба контекста (chat и letter)', () => {
      const contexts = c.fx.app
        .get(FileAccessRegistry)
        .contributors()
        .map((contributor) => contributor.fileAccessContext);
      expect(contexts).toEqual(expect.arrayContaining(['chat', 'letter']));
    });

    it('канцелярия создаёт и регистрирует: номер «Вх-ГГГГ/N», письмо во «Входящих» у сотрудника', async () => {
      const letterId = await newLetter();
      const res = await c.register(c.registrar, letterId);
      expect(res.status, await res.clone().text()).toBe(200);
      const { letter } = registrationResult.parse(await res.json());
      expect(letter.regNumber).toMatch(/^Вх-\d{4}\/\d+$/);
      expect(letter.registeredAt).not.toBeNull();
      expect(letter.registrar?.id).toBe(c.registrar.id);
      expect(letter.stage.name).toBe('На резолюции');
      expect(letter.body.kind).toBe('document');

      const incoming = await c.api(c.employee, 'GET', '/letters?box=incoming&limit=50');
      expect(incoming.status).toBe(200);
      const page = (await incoming.json()) as { items: { id: string }[] };
      expect(page.items.map((item) => item.id)).toContain(letterId);

      // Фильтр корреспондента (вкладка «Письма» CRM) применяется сервером.
      const byCounterparty = await c.api(
        c.employee,
        'GET',
        `/letters?counterpartyId=${letter.counterparty!.id}`,
      );
      expect(byCounterparty.status).toBe(200);
      const filtered = (await byCounterparty.json()) as { items: { id: string }[] };
      expect(filtered.items.map((item) => item.id)).toContain(letterId);

      const history = await c.api(c.employee, 'GET', `/letters/${letterId}/history`);
      expect(history.status).toBe(200);
      const entries = historyPage.parse(await history.json()).items;
      expect(entries.map((entry) => entry.kind)).toEqual(
        expect.arrayContaining(['received', 'registered']),
      );
    });

    it('незарегистрированное: сотруднику 404, box=new без права 403', async () => {
      const letterId = await newLetter();
      expect((await c.api(c.employee, 'GET', `/letters/${letterId}`)).status).toBe(404);
      expect((await c.api(c.employee, 'GET', '/letters?box=new')).status).toBe(403);
      expect((await c.api(c.registrar, 'GET', `/letters/${letterId}`)).status).toBe(200);
    });

    it('повторная регистрация — 409 LETTER_ALREADY_REGISTERED с номером', async () => {
      const letterId = await newLetter();
      const button = await c.registerButton(c.registrar, letterId);
      const registration = await c.registrationPayload();
      const send = () =>
        c.api(c.registrar, 'POST', `/letters/${letterId}/transitions/${button.id}`, {
          body: { form: { registration } },
          key: `it-rereg-${crypto.randomUUID()}`,
        });
      expect((await send()).status).toBe(200);
      const again = await send();
      expect(again.status).toBe(409);
      const body = apiErrorResponseSchema.parse(await again.json());
      expect(body.code).toBe(ErrorCode.LETTER_ALREADY_REGISTERED);
      expect((body.details as { regNumber?: string }).regNumber).toMatch(/^Вх-/);
    });

    it('закрытие без регистрации: без причины 422, с причиной — стадия и событие', async () => {
      const letterId = await newLetter();
      const transitionsRes = await c.api(c.registrar, 'GET', `/letters/${letterId}/transitions`);
      const transitions = (await transitionsRes.json()) as { id: string; name: string }[];
      const close = transitions.find((transition) => transition.name === 'Закрыть без регистрации');
      expect(close).toBeDefined();

      const withoutReason = await c.api(
        c.registrar,
        'POST',
        `/letters/${letterId}/transitions/${close!.id}`,
        { body: { form: {} }, key: `it-close-${crypto.randomUUID()}` },
      );
      expect(withoutReason.status).toBe(422);

      const withReason = await c.api(
        c.registrar,
        'POST',
        `/letters/${letterId}/transitions/${close!.id}`,
        {
          body: { form: { comment: `Проба ${c.fx.runId}: ошибочный скан` } },
          key: `it-close-${crypto.randomUUID()}`,
        },
      );
      expect(withReason.status, await withReason.clone().text()).toBe(200);
      const { letter } = registrationResult.parse(await withReason.json());
      expect(letter.stage.name).toBe('Не зарегистрировано');
      const events = await c.fx.prisma.event.findMany({
        where: {
          aggregateType: 'letter',
          aggregateId: letterId,
          type: 'correspondence.letter_closed_unregistered',
        },
      });
      expect(events).toHaveLength(1);
    });

    it('параллельные регистрации: 8 писем — 8 разных номеров; одно письмо — один успех', async () => {
      const ids = await Promise.all(Array.from({ length: 8 }, () => newLetter()));
      const results = await Promise.all(ids.map((id) => c.register(c.registrar, id)));
      const numbers: string[] = [];
      for (const result of results) {
        expect(result.status, await result.clone().text()).toBe(200);
        const { letter } = registrationResult.parse(await result.json());
        numbers.push(letter.regNumber!);
      }
      expect(new Set(numbers).size).toBe(8);

      const contest = await newLetter();
      const [first, second] = await Promise.all([
        c.register(c.registrar, contest),
        c.register(c.registrar, contest),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflict = first.status === 409 ? first : second;
      expect(apiErrorResponseSchema.parse(await conflict.json()).code).toBe(
        ErrorCode.LETTER_ALREADY_REGISTERED,
      );
    });

    it('отказ регистрации не сдвигает счётчик (номеров без пропусков)', async () => {
      const first = await newLetter();
      const firstRes = await c.register(c.registrar, first);
      const firstNumber = registrationResult.parse(await firstRes.json()).letter.regNumber!;

      const broken = await newLetter();
      const invalid = await c.register(c.registrar, broken, {
        counterpartyId: crypto.randomUUID(),
        signerId: null,
        theirNumber: 'ИТ-ОШИБКА',
        theirDate: today(),
        subject: `Проба ${c.fx.runId} неверный корреспондент`,
        receiptMethodId: crypto.randomUUID(),
        projectId: null,
        addresseeId: c.resolver.id,
        responseDeadline: null,
      });
      expect(invalid.status).toBe(422);

      const next = await newLetter();
      const nextRes = await c.register(c.registrar, next);
      const nextNumber = registrationResult.parse(await nextRes.json()).letter.regNumber!;
      expect(seqOf(nextNumber)).toBe(seqOf(firstNumber) + 1);
    });

    it('идемпотентность ручного создания: один ключ — одно письмо', async () => {
      const key = `it-letter-idem-${c.fx.runId}`;
      const [first, second] = await Promise.all([
        c.createLetter(c.registrar, [FILE], { key }),
        c.createLetter(c.registrar, [FILE], { key }),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const a = letterDetailSchema.parse(await first.json());
      const b = letterDetailSchema.parse(await second.json());
      expect(b.id).toBe(a.id);
    });

    it('спам: только из «Нового», аудит без содержимого', async () => {
      const letterId = await newLetter();
      const detail = letterDetailSchema.parse(
        await (await c.api(c.registrar, 'GET', `/letters/${letterId}`)).json(),
      );
      expect(detail.access.canDeleteSpam).toBe(true);
      const removed = await c.api(c.registrar, 'DELETE', `/letters/${letterId}`, {
        key: `it-spam-${crypto.randomUUID()}`,
      });
      expect(removed.status).toBe(204);
      expect((await c.api(c.registrar, 'GET', `/letters/${letterId}`)).status).toBe(404);
      // DELETE отвечает 204 без тела — entityId аудита пуст, путь несёт id.
      const audit = await waitForAudit(() =>
        c.fx.prisma.auditLog.findFirst({
          where: { action: 'correspondence.letter_spam_deleted' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(audit.entityId).toBe(letterId);
      expect(JSON.stringify(audit.details ?? {})).toContain(letterId);
      expect(JSON.stringify(audit.details ?? {})).not.toContain('scan.pdf');
    });

    it('присоединение: беседа письма, проекция CRM, подписант занят', async () => {
      const letterId = await newLetter();
      const registered = await c.register(c.registrar, letterId);
      expect(registered.status).toBe(200);
      const { letter } = registrationResult.parse(await registered.json());
      await c.flushLetterEvents(letterId);

      const usage = await c.fx.prisma.counterpartyUsage.findUnique({
        where: { sourceKind_sourceId: { sourceKind: 'letter', sourceId: letterId } },
      });
      expect(usage?.counterpartyId).toBe(letter.counterparty?.id);
      expect(usage?.contactId).toBeNull();

      const joined = await c.api(c.employee, 'POST', `/letters/${letterId}/join`, {
        key: `it-join-${crypto.randomUUID()}`,
      });
      expect(joined.status, await joined.clone().text()).toBe(200);
      expect(letterDetailSchema.parse(await joined.json()).access.isParticipant).toBe(true);

      const conversation = await c.api(
        c.employee,
        'GET',
        `/chat/conversations/by-letter/${letterId}`,
      );
      expect(conversation.status, await conversation.clone().text()).toBe(200);
      const forbidden = await c.api(
        c.registrar,
        'GET',
        `/chat/conversations/by-letter/${letterId}`,
      );
      expect(forbidden.status).toBe(404);
    });

    it('отмена регистрации канцелярией: блока в чате нет, журнал и история — с причиной (#741)', async () => {
      const letterId = await newLetter();
      const registered = await c.register(c.registrar, letterId);
      expect(registered.status, await registered.clone().text()).toBe(200);
      await c.flushLetterEvents(letterId);
      const chat = await c.fx.prisma.conversation.findFirstOrThrow({
        where: { type: 'letter', letterId },
      });
      // Регистратор вне беседы письма (В2): её собственная причина не должна
      // попасть в чужую переписку. Журнал перехода и история письма остаются.
      const transitions = (await (
        await c.api(c.registrar, 'GET', `/letters/${letterId}/transitions`)
      ).json()) as { id: string; name: string }[];
      const cancel = transitions.find((transition) => transition.name === 'Отменить регистрацию');
      expect(cancel).toBeDefined();
      const res = await c.api(
        c.registrar,
        'POST',
        `/letters/${letterId}/transitions/${cancel!.id}`,
        {
          body: { form: { comment: 'Ошибочно зарегистрировано' } },
          key: `it-cancel-${crypto.randomUUID()}`,
        },
      );
      expect(res.status, await res.clone().text()).toBe(200);
      await c.flushLetterEvents(letterId);

      expect(
        await c.fx.prisma.message.count({
          where: { conversationId: chat.id, kind: 'letter_transition' },
        }),
      ).toBe(0);
      const record = await c.fx.prisma.transitionRecord.findFirstOrThrow({
        where: { entityKind: 'letter', entityId: letterId, recordKind: 'transition' },
        orderBy: { createdAt: 'desc' },
      });
      expect(record.comment).toBe('Ошибочно зарегистрировано');
      const history = historyPage.parse(
        await (await c.api(c.resolver, 'GET', `/letters/${letterId}/history`)).json(),
      ).items;
      const stageEntry = history.find(
        (entry) =>
          entry.kind === 'stage_changed' && entry.transitionName === 'Отменить регистрацию',
      );
      expect(stageEntry?.kind === 'stage_changed' ? stageEntry.comment : undefined).toBe(
        'Ошибочно зарегистрировано',
      );
    });

    it('подписант письма: удаление контакта — 409 CRM_CONTACT_IN_USE', async () => {
      const counterpartyId = (
        await c.fx.prisma.counterparty.findFirstOrThrow({
          where: { email: `it-${c.fx.runId}@example.test` },
        })
      ).id;
      const contactRes = await c.api(
        c.registrar,
        'POST',
        `/counterparties/${counterpartyId}/contacts`,
        {
          body: { fullName: 'Петров Пётр Петрович', position: 'Директор' },
          key: `it-contact-${crypto.randomUUID()}`,
        },
      );
      expect(contactRes.status, await contactRes.clone().text()).toBe(201);
      const contact = (await contactRes.json()) as { id: string };

      const letterId = await newLetter();
      const registered = await c.register(c.registrar, letterId, {
        counterpartyId,
        signerId: contact.id,
        theirNumber: `ИТ-${c.fx.runId.slice(0, 6)}-П`,
        theirDate: today(),
        subject: `Проба ${c.fx.runId} подписант`,
        receiptMethodId: (
          await c.fx.prisma.dictionaryItem.findFirstOrThrow({
            where: { code: 'post' },
          })
        ).id,
        projectId: null,
        addresseeId: c.resolver.id,
        responseDeadline: null,
      });
      expect(registered.status, await registered.clone().text()).toBe(200);
      await c.flushLetterEvents(letterId);

      const removed = await c.api(
        c.registrar,
        'DELETE',
        `/counterparties/${counterpartyId}/contacts/${contact.id}`,
        { key: `it-contact-del-${crypto.randomUUID()}` },
      );
      expect(removed.status).toBe(409);
      expect(apiErrorResponseSchema.parse(await removed.json()).code).toBe(
        ErrorCode.CRM_CONTACT_IN_USE,
      );
    });

    it('правка реквизитов пишет историю и событие', async () => {
      const letterId = await newLetter();
      const registered = await c.register(c.registrar, letterId);
      const { letter } = registrationResult.parse(await registered.json());
      const patched = await c.api(c.registrar, 'PATCH', `/letters/${letterId}`, {
        body: { subject: `Проба ${c.fx.runId} новая тема` },
        key: `it-patch-${crypto.randomUUID()}`,
      });
      expect(patched.status, await patched.clone().text()).toBe(200);
      const updated: LetterDetail = letterDetailSchema.parse(await patched.json());
      expect(updated.subject).toBe(`Проба ${c.fx.runId} новая тема`);
      expect(updated.regNumber).toBe(letter.regNumber);

      const history = historyPage.parse(
        await (await c.api(c.registrar, 'GET', `/letters/${letterId}/history`)).json(),
      );
      const entry = history.items.find((item) => item.kind === 'updated');
      expect(entry).toBeDefined();
      if (entry?.kind === 'updated') {
        expect(entry.changes[0]).toMatchObject({ field: 'subject' });
      }
    });
  },
);
