import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  apiErrorResponseSchema,
  counterpartyCardSchema,
  counterpartyBulkResultSchema,
  counterpartyListItemSchema,
  contactPersonSchema,
  paginatedSchema,
  type CounterpartyListItem,
} from '@nodus/contracts';

import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { setupCrmFixture, type CrmTestFixture } from './crm-fixtures.js';

const cardPage = paginatedSchema(counterpartyListItemSchema);
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/**
 * CRM: жизненный цикл справочника на живом HTTP (#460) — keyset-пагинация
 * без дублей и пропусков, серверный поиск и фильтр архива, идемпотентность
 * мутаций, архив/возврат контрагента и контакта, принадлежность контакта,
 * проекция счётчиков (`counterparty_usages`) и фичефлаг модуля.
 */
describe.skipIf(!process.env.DATABASE_URL)('crm: реестр и жизненный цикл (integration)', () => {
  let crm: CrmTestFixture;
  let fx: CrmTestFixture['fx'];
  let employee: CrmTestFixture['employee'];
  let manager: CrmTestFixture['manager'];
  let create: CrmTestFixture['create'];
  let name: CrmTestFixture['name'];

  beforeAll(async () => {
    crm = await setupCrmFixture();
    ({ fx, employee, manager, create, name } = crm);
  }, 120_000);

  afterAll(async () => {
    await crm?.cleanup();
  });

  it('keyset без дублей и пропусков; поиск по названию и УНП; фильтр архива', async () => {
    const prefix = name('Сортировка');
    const ids: string[] = [];
    for (const suffix of ['А', 'Б', 'В']) {
      const card = await create({
        fullName: `${prefix} ${suffix}`,
        shortName: `${prefix} ${suffix}`,
      });
      ids.push(card.id);
    }
    // Отдельная запись с УНП — поиск по номеру (цифры в запросе).
    await create({ fullName: name('Номер'), shortName: name('Номер'), unp: '400123456' });
    await fx.api(manager, 'POST', `/counterparties/${ids[1]}/archive`);

    const seen: CounterpartyListItem[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = cardPage.parse(
        await json(
          await fx.api(
            employee,
            'GET',
            `/counterparties?search=${encodeURIComponent(prefix)}&limit=1${qs}`,
          ),
        ),
      );
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen.map((i) => i.id)).toEqual([ids[0], ids[2]]);
    expect(new Set(seen.map((i) => i.id)).size).toBe(2);

    const withArchived = cardPage.parse(
      await json(
        await fx.api(
          employee,
          'GET',
          `/counterparties?search=${encodeURIComponent(prefix)}&includeArchived=true&limit=100`,
        ),
      ),
    );
    expect(withArchived.items.map((i) => i.id)).toEqual([ids[0], ids[1], ids[2]]);
    expect(withArchived.items[1]?.archivedAt).toBeTruthy();

    const byUnp = cardPage.parse(
      await json(await fx.api(employee, 'GET', '/counterparties?search=400123456')),
    );
    expect(byUnp.items.some((i) => i.unp === '400123456')).toBe(true);

    // «%» в названии ищется как литерал (не двойное экранирование).
    const percent = await create({
      fullName: name('Скидка 10%'),
      shortName: name('Скидка 10%'),
    });
    const byPercent = cardPage.parse(
      await json(
        await fx.api(employee, 'GET', `/counterparties?search=${encodeURIComponent('10%')}`),
      ),
    );
    expect(byPercent.items.map((i) => i.id)).toContain(percent.id);

    // Спецсимволы LIKE — литералы, а не шаблон (security-ревью #460):
    // «%» находит только запись с процентом в названии, «_» — ничего.
    const percentOnly = cardPage.parse(
      await json(
        await fx.api(employee, 'GET', '/counterparties?search=%25&includeArchived=true&limit=100'),
      ),
    );
    expect(percentOnly.items.map((i) => i.id)).toEqual([percent.id]);
    const underscore = cardPage.parse(
      await json(
        await fx.api(employee, 'GET', '/counterparties?search=_&includeArchived=true&limit=100'),
      ),
    );
    expect(underscore.items).toEqual([]);

    await fx.api(manager, 'POST', `/counterparties/${ids[1]}/restore`);
  });

  it('идемпотентность: повтор с тем же Idempotency-Key — одна запись', async () => {
    const key = `crm-it-${fx.runId}-idem`;
    const body = { fullName: name('Идемпотент'), shortName: name('Идемпотент') };
    const first = await fx.api(manager, 'POST', '/counterparties', { body, key });
    const second = await fx.api(manager, 'POST', '/counterparties', { body, key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstCard = counterpartyCardSchema.parse(await first.json());
    crm.created.push(firstCard.id);
    expect(counterpartyCardSchema.parse(await second.json()).id).toBe(firstCard.id);
    expect(await fx.prisma.counterparty.count({ where: { shortName: name('Идемпотент') } })).toBe(
      1,
    );
  });

  it('архив: мутации архивного — 409; контакт чужого контрагента — 404', async () => {
    const card = await create({ fullName: name('Архив'), shortName: name('Архив') });
    const other = await create({ fullName: name('Сосед'), shortName: name('Сосед') });

    const contact = contactPersonSchema.parse(
      await json(
        await fx.api(manager, 'POST', `/counterparties/${card.id}/contacts`, {
          body: { fullName: 'Петров Пётр' },
        }),
      ),
    );
    const foreign = await fx.api(
      manager,
      'PATCH',
      `/counterparties/${other.id}/contacts/${contact.id}`,
      {
        body: { position: 'Директор' },
      },
    );
    expect(foreign.status).toBe(404);

    await fx.api(manager, 'POST', `/counterparties/${card.id}/archive`);
    const archivedEdit = await fx.api(manager, 'PATCH', `/counterparties/${card.id}`, {
      body: { phone: '+375 17 000-00-00' },
    });
    expect(archivedEdit.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await archivedEdit.json()).code).toBe(
      ErrorCode.CRM_COUNTERPARTY_ARCHIVED,
    );
    const archivedContactAdd = await fx.api(
      manager,
      'POST',
      `/counterparties/${card.id}/contacts`,
      {
        body: { fullName: 'Новый' },
      },
    );
    expect(archivedContactAdd.status).toBe(409);

    // Архив идемпотентен, возврат работает.
    expect((await fx.api(manager, 'POST', `/counterparties/${card.id}/archive`)).status).toBe(200);
    const restored = counterpartyCardSchema.parse(
      await json(await fx.api(manager, 'POST', `/counterparties/${card.id}/restore`)),
    );
    expect(restored.archivedAt).toBeNull();

    // Контакт: архив → 200, правка архивного → 409, возврат → 200.
    const contactPath = `/counterparties/${card.id}/contacts/${contact.id}`;
    expect((await fx.api(manager, 'POST', `${contactPath}/archive`)).status).toBe(200);
    expect(
      (await fx.api(manager, 'PATCH', contactPath, { body: { position: 'Директор' } })).status,
    ).toBe(409);
    const contactRestored = contactPersonSchema.parse(
      await json(await fx.api(manager, 'POST', `${contactPath}/restore`)),
    );
    expect(contactRestored.archivedAt).toBeNull();
  });

  it('массовый архив/возврат: результат по записи, частичный успех — норма', async () => {
    const a = await create({ fullName: name('Пачка А'), shortName: name('Пачка А') });
    const b = await create({ fullName: name('Пачка Б'), shortName: name('Пачка Б') });
    const missing = crypto.randomUUID();

    const archived = await fx.api(manager, 'POST', '/counterparties/bulk', {
      body: { counterpartyIds: [a.id, b.id, missing], action: { kind: 'archive' } },
    });
    expect(archived.status).toBe(200);
    const result = counterpartyBulkResultSchema.parse(await archived.json());
    expect(result.results.filter((row) => row.ok).map((row) => row.counterpartyId)).toEqual([
      a.id,
      b.id,
    ]);
    expect(result.results.find((row) => !row.ok)).toMatchObject({
      counterpartyId: missing,
      code: ErrorCode.NOT_FOUND,
    });

    const restored = counterpartyBulkResultSchema.parse(
      await json(
        await fx.api(manager, 'POST', '/counterparties/bulk', {
          body: { counterpartyIds: [a.id, b.id], action: { kind: 'restore' } },
        }),
      ),
    );
    expect(restored.results.every((row) => row.ok)).toBe(true);

    // Право crm.manage обязательно (островок скрыт без права, сервер — истина).
    expect(
      (
        await fx.api(employee, 'POST', '/counterparties/bulk', {
          body: { counterpartyIds: [a.id], action: { kind: 'archive' } },
        })
      ).status,
    ).toBe(403);
  });

  it('проекция счётчиков: живое письмо в counterparty_usages даёт lettersCount', async () => {
    const card = await create({ fullName: name('Счётчики'), shortName: name('Счётчики') });
    // Счётчик считает ТОЛЬКО видимые письма (#461, Р4): проекция без живой
    // строки `letters` — мусор, а не письмо. Создаём зарегистрированное
    // письмо (plain UUID движка, без FK — I3) и строку проекции.
    const letter = await fx.prisma.letter.create({
      data: {
        typeId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
        stageId: crypto.randomUUID(),
        systemState: 'active',
        direction: 'incoming',
        source: 'manual',
        createdBy: employee.id,
        // CHECK полноты регистрации: номер и его состав заполняются вместе.
        regNumber: `ИТ-${crypto.randomUUID().slice(0, 8)}`,
        regSeriesId: crypto.randomUUID(),
        regYear: 2026,
        regSeq: 1,
        regDate: new Date(),
        registeredAt: new Date(),
        registrarId: employee.id,
        counterpartyId: card.id,
      },
    });
    await fx.prisma.counterpartyUsage.create({
      data: { sourceKind: 'letter', sourceId: letter.id, counterpartyId: card.id },
    });

    const read = counterpartyCardSchema.parse(
      await json(await fx.api(employee, 'GET', `/counterparties/${card.id}`)),
    );
    expect(read.lettersCount).toBe(1);
    expect(read.projectsCount).toBe(0);

    const list = cardPage.parse(
      await json(
        await fx.api(
          employee,
          'GET',
          `/counterparties?search=${encodeURIComponent(name('Счётчики'))}`,
        ),
      ),
    );
    expect(list.items[0]?.lettersCount).toBe(1);
  });

  it('выключенный флаг модуля — 404 на весь справочник (I10)', async () => {
    const flags = fx.app.get(FeatureFlagService);
    await flags.setEnabled('crm', false);
    try {
      expect((await fx.api(employee, 'GET', '/counterparties')).status).toBe(404);
      const denied = await fx.api(manager, 'POST', '/counterparties', {
        body: { fullName: 'X', shortName: 'X' },
      });
      expect(denied.status).toBe(404);
    } finally {
      await flags.setEnabled('crm', true);
    }
  });

  it('ошибки единого формата: кривой id и пустые похожие — 400, отсутствующий — 404', async () => {
    const badId = await fx.api(employee, 'GET', '/counterparties/not-a-uuid');
    expect(badId.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await badId.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await fx.api(employee, 'GET', '/counterparties/similar')).status).toBe(400);
    expect((await fx.api(employee, 'GET', `/counterparties/${crypto.randomUUID()}`)).status).toBe(
      404,
    );
  });
});
