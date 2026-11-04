import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  letterDetailSchema,
  letterTreeResponseSchema,
  type LetterDetail,
  type LetterTreeResponse,
} from '@nodus/contracts';

import {
  historyPage,
  registrationResult,
  setupCorrespondenceFixture,
  type CorrespondenceFixture,
} from './correspondence-fixtures.js';

const FILE = { name: 'scan.pdf', mime: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

describe.skipIf(!process.env.DATABASE_URL)(
  'корреспонденция: связи, приложенные письма, конфиденциальность (integration, #461)',
  () => {
    let c: CorrespondenceFixture;

    beforeAll(async () => {
      c = await setupCorrespondenceFixture();
    }, 180_000);

    afterAll(async () => {
      await c?.cleanup();
    });

    /** Зарегистрированное письмо; `input` дополняет окно регистрации. */
    async function registered(input: Record<string, unknown> = {}): Promise<LetterDetail> {
      const created = await c.createLetter(c.registrar, [FILE]);
      expect(created.status, await created.clone().text()).toBe(201);
      const letterId = letterDetailSchema.parse(await created.json()).id;
      const res = await c.register(c.registrar, letterId, {
        ...(await c.registrationPayload()),
        ...input,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return registrationResult.parse(await res.json()).letter;
    }

    const link = (letterId: string, body: Record<string, unknown>) =>
      c.api(c.registrar, 'POST', `/letters/${letterId}/relations`, {
        body,
        key: `it-rel-${crypto.randomUUID()}`,
      });

    const treeOf = async (
      user: typeof c.employee,
      letterId: string,
    ): Promise<LetterTreeResponse> => {
      const res = await c.api(user, 'GET', `/letters/${letterId}/tree`);
      expect(res.status, await res.clone().text()).toBe(200);
      return letterTreeResponseSchema.parse(await res.json());
    };

    it('связь «ответ на»: дерево от цели, повтор идемпотентен, замена и снятие', async () => {
      const target = await registered();
      const reply = await registered();
      const replacement = await registered();

      const linked = await link(reply.id, { relatedLetterId: target.id, kind: 'reply_to' });
      expect(linked.status, await linked.clone().text()).toBe(200);
      const detail = letterDetailSchema.parse(await linked.json());
      expect(detail.replyTo?.id).toBe(target.id);

      const tree = await treeOf(c.employee, reply.id);
      expect(tree.root.id).toBe(target.id);
      expect(tree.root.children.map((node) => node.id)).toContain(reply.id);
      expect(tree.root.children[0]?.relationKind).toBe('reply_to');

      // Повтор той же связи — успех без дубля.
      const again = await link(reply.id, { relatedLetterId: target.id, kind: 'reply_to' });
      expect(again.status).toBe(200);
      expect((await treeOf(c.employee, reply.id)).root.children).toHaveLength(1);

      // Другая цель без replace — 422 already_linked.
      const conflict = await link(reply.id, {
        relatedLetterId: replacement.id,
        kind: 'reply_to',
      });
      expect(conflict.status).toBe(422);
      expect(apiErrorResponseSchema.parse(await conflict.json()).details).toMatchObject({
        reason: 'already_linked',
      });

      // replace — цель меняется, история знает «заменено».
      const replaced = await link(reply.id, {
        relatedLetterId: replacement.id,
        kind: 'reply_to',
        replace: true,
      });
      expect(replaced.status, await replaced.clone().text()).toBe(200);
      expect((await treeOf(c.employee, reply.id)).root.id).toBe(replacement.id);
      const history = historyPage.parse(
        await (await c.api(c.registrar, 'GET', `/letters/${reply.id}/history`)).json(),
      );
      const relationEntry = history.items.find((entry) => entry.kind === 'relation_changed');
      expect(relationEntry).toMatchObject({
        action: 'replaced',
        relationKind: 'reply_to',
        relatedLetter: { id: replacement.id },
      });

      // Снятие — дерево снова от самого письма.
      const relationId = (await treeOf(c.employee, reply.id)).root.children[0]!.relationId!;
      const unlinked = await c.api(
        c.registrar,
        'DELETE',
        `/letters/${reply.id}/relations/${relationId}`,
        { key: `it-unlink-${crypto.randomUUID()}` },
      );
      expect(unlinked.status).toBe(204);
      expect((await treeOf(c.employee, reply.id)).root.id).toBe(reply.id);
    });

    it('цикл, самосвязь и незарегистрированная цель — 422 с причиной', async () => {
      const a = await registered();
      const b = await registered();
      expect((await link(b.id, { relatedLetterId: a.id, kind: 'nested_in' })).status).toBe(200);

      const cycle = await link(a.id, { relatedLetterId: b.id, kind: 'reply_to' });
      expect(cycle.status).toBe(422);
      expect(apiErrorResponseSchema.parse(await cycle.json()).details).toMatchObject({
        reason: 'cycle',
      });

      const self = await link(a.id, { relatedLetterId: a.id, kind: 'nested_in' });
      expect(self.status).toBe(422);
      expect(apiErrorResponseSchema.parse(await self.json()).details).toMatchObject({
        reason: 'cycle',
      });

      const fresh = await c.createLetter(c.registrar, [FILE]);
      const freshId = letterDetailSchema.parse(await fresh.json()).id;
      const notRegistered = await link(a.id, { relatedLetterId: freshId, kind: 'reply_to' });
      expect(notRegistered.status).toBe(422);
      expect(apiErrorResponseSchema.parse(await notRegistered.json()).details).toMatchObject({
        reason: 'not_registered',
      });
    });

    it('«вложено в» и матрёшка: конверт раскрывает вложенное письмо', async () => {
      const envelope = await registered();
      const nested = await registered();
      const res = await link(nested.id, { relatedLetterId: envelope.id, kind: 'nested_in' });
      expect(res.status, await res.clone().text()).toBe(200);
      const tree = await treeOf(c.employee, nested.id);
      expect(tree.root.id).toBe(envelope.id);
      expect(tree.root.children.map((node) => node.id)).toContain(nested.id);
      expect(tree.root.children[0]?.relationKind).toBe('nested_in');
    });

    it('приложенные письма: строки в карточке, поиск по номеру, история и дубль', async () => {
      const letter = await registered({
        attachedRefs: [
          {
            number: `456-${c.fx.runId.slice(0, 4)}`,
            counterpartyId: null,
            orgText: 'Беларуськалий',
            date: '2026-10-18',
          },
          {
            number: `78-${c.fx.runId.slice(0, 4)}`,
            counterpartyId: null,
            orgText: 'Беларуськалий',
            date: null,
          },
        ],
      });
      expect(letter.attachedRefs.map((ref) => ref.number)).toEqual([
        `456-${c.fx.runId.slice(0, 4)}`,
        `78-${c.fx.runId.slice(0, 4)}`,
      ]);
      expect(letter.attachedRefs[0]?.orgText).toBe('Беларуськалий');

      // Поиск по номеру приложенного письма находит конверт (Р8).
      const found = await c.api(
        c.employee,
        'GET',
        `/letters?search=${encodeURIComponent(`456-${c.fx.runId.slice(0, 4)}`)}`,
      );
      expect(found.status).toBe(200);
      const page = (await found.json()) as { items: { id: string }[] };
      expect(page.items.map((item) => item.id)).toContain(letter.id);

      // Правка набором: история — счётчиком строк.
      const patched = await c.api(c.registrar, 'PATCH', `/letters/${letter.id}`, {
        body: {
          attachedRefs: [
            {
              number: `456-${c.fx.runId.slice(0, 4)}`,
              counterpartyId: null,
              orgText: 'Беларуськалий',
              date: '2026-10-18',
            },
            {
              number: `78-${c.fx.runId.slice(0, 4)}`,
              counterpartyId: null,
              orgText: 'Беларуськалий',
              date: null,
            },
            { number: '90', counterpartyId: null, orgText: 'Беларуськалий', date: null },
          ],
        },
        key: `it-att-${crypto.randomUUID()}`,
      });
      expect(patched.status, await patched.clone().text()).toBe(200);
      const updated = letterDetailSchema.parse(await patched.json());
      expect(updated.attachedRefs).toHaveLength(3);
      const history = historyPage.parse(
        await (await c.api(c.registrar, 'GET', `/letters/${letter.id}/history`)).json(),
      );
      const change = history.items
        .filter((entry) => entry.kind === 'updated')
        .flatMap((entry) => (entry.kind === 'updated' ? entry.changes : []))
        .find((item) => item.field === 'attachedRefs');
      expect(change).toMatchObject({ from: '2', to: '3' });

      // Точный дубль строки — 422 duplicate.
      const duplicate = await c.api(c.registrar, 'PATCH', `/letters/${letter.id}`, {
        body: {
          attachedRefs: [
            { number: '90', counterpartyId: null, orgText: 'Беларуськалий', date: null },
            { number: '90', counterpartyId: null, orgText: 'Беларуськалий', date: null },
          ],
        },
        key: `it-att-dup-${crypto.randomUUID()}`,
      });
      expect(duplicate.status).toBe(422);
      expect(apiErrorResponseSchema.parse(await duplicate.json()).details).toMatchObject({
        field: 'attachedRefs',
        reason: 'duplicate',
      });
    });

    it('конфиденциальное письмо: чужим 404 везде, участникам — видно; снятие флага возвращает', async () => {
      const payload = await c.registrationPayload();
      const secret = await registered({ ...payload, confidential: true });
      expect(secret.confidential).toBe(true);
      // Проекция CRM доезжает обработчиком события регистрации.
      await c.flushLetterEvents(secret.id);
      const counterpartyId = String(payload.counterpartyId);

      // Чужой (не участник): карточка, история, дерево, чат — 404; в списке и поиске нет.
      for (const path of [
        `/letters/${secret.id}`,
        `/letters/${secret.id}/history`,
        `/letters/${secret.id}/tree`,
        `/chat/conversations/by-letter/${secret.id}`,
      ]) {
        const res = await c.api(c.employee, 'GET', path);
        expect(res.status, `${path}: ${await res.clone().text()}`).toBe(404);
      }
      const list = await c.api(c.employee, 'GET', '/letters?box=incoming&limit=50');
      const items = ((await list.json()) as { items: { id: string }[] }).items;
      expect(items.map((item) => item.id)).not.toContain(secret.id);
      const search = await c.api(
        c.employee,
        'GET',
        `/letters?search=${encodeURIComponent(secret.theirNumber ?? '')}`,
      );
      expect(((await search.json()) as { items: { id: string }[] }).items).not.toContainEqual(
        expect.objectContaining({ id: secret.id }),
      );

      // Участники: регистратор и адресат видят карточку и чат.
      expect((await c.api(c.registrar, 'GET', `/letters/${secret.id}`)).status).toBe(200);
      expect((await c.api(c.resolver, 'GET', `/letters/${secret.id}`)).status).toBe(200);
      expect(
        (await c.api(c.resolver, 'GET', `/chat/conversations/by-letter/${secret.id}`)).status,
      ).toBe(200);

      // CRM-счётчик контрагента: у чужого без +1, у регистратора — с письмом.
      const employeeCard = await c.api(c.employee, 'GET', `/counterparties/${counterpartyId}`);
      const registrarCard = await c.api(c.registrar, 'GET', `/counterparties/${counterpartyId}`);
      const employeeCount = ((await employeeCard.json()) as { lettersCount: number }).lettersCount;
      const registrarCount = ((await registrarCard.json()) as { lettersCount: number })
        .lettersCount;
      expect(registrarCount).toBe(employeeCount + 1);

      // Снятие флага канцелярией: письмо возвращается в общие списки, история знает.
      const open = await c.api(c.registrar, 'PATCH', `/letters/${secret.id}`, {
        body: { confidential: false },
        key: `it-open-${crypto.randomUUID()}`,
      });
      expect(open.status, await open.clone().text()).toBe(200);
      expect((await c.api(c.employee, 'GET', `/letters/${secret.id}`)).status).toBe(200);
      const history = historyPage.parse(
        await (await c.api(c.registrar, 'GET', `/letters/${secret.id}/history`)).json(),
      );
      const flag = history.items
        .filter((entry) => entry.kind === 'updated')
        .flatMap((entry) => (entry.kind === 'updated' ? entry.changes : []))
        .find((item) => item.field === 'confidential');
      expect(flag).toMatchObject({ from: 'true', to: 'false' });
    });

    it('дерево конфиденциального: узел скрыт чужому, поддерево не всплывает', async () => {
      const root = await registered();
      const secretChild = await registered({ confidential: true });
      expect(
        (await link(secretChild.id, { relatedLetterId: root.id, kind: 'nested_in' })).status,
      ).toBe(200);

      const forEmployee = await treeOf(c.employee, root.id);
      expect(forEmployee.root.children.map((node) => node.id)).not.toContain(secretChild.id);
      const forRegistrar = await treeOf(c.registrar, root.id);
      expect(forRegistrar.root.children.map((node) => node.id)).toContain(secretChild.id);
    });
  },
);
