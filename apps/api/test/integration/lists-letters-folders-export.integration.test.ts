/* eslint-disable nodus-internal/max-lines-warn -- один живой набор #435: ящики/поиск/группы писем + выгрузка писем и папок */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission, type Paginated } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { letterSeriesTemplate } from '../../src/modules/workflows/numbering/number-template.js';
import { setupConditionWorld, type ConditionWorld } from './tasks-condition-world.js';

/**
 * Конвейер писем ext-списка и CSV-выгрузки писем/папок (#435) на живом
 * движке: ящики направлений, поиск (тема + контрагент подсказкой), группы
 * и итоги (включая дату), гейт «Новых», фильтр полей экспорта, гидрация
 * имён (контрагент/адресат/тип/стадия/вид папки) и атрибуты в ячейках.
 */
describe.skipIf(!process.env.DATABASE_URL)('письма и папки: списки и выгрузка (#435)', () => {
  let w: ConditionWorld;
  let prisma: ConditionWorld['prisma'];
  let projectId = '';
  let runTag = '';
  let hoursId = '';
  /** Борис без права регистрации: «Новые» для него закрыты. */
  let bobNoRegister: ConditionWorld['bob'];
  let inProjectLetterId = '';
  let counterpartyName = '';

  beforeAll(async () => {
    w = await setupConditionWorld();
    prisma = w.prisma;
    runTag = `lf${w.runId}`;
    await w.addField('hours', 'number', { precision: 0 });
    hoursId = w.field.get('hours')!;

    const tokens = w.fx.app.get(TokenService);
    bobNoRegister = {
      ...w.bob,
      token: await tokens.signAccessToken(
        {
          id: w.bob.id,
          email: w.bob.email,
          displayName: w.bob.displayName,
          permissions: [Permission.TASK_CREATE],
        },
        'integration-test-session',
      ),
    };

    const projectType = (await prisma.projectType.findFirstOrThrow()).id;
    const project = await prisma.project.create({
      data: {
        name: `Письма списков ${w.runId}`,
        typeId: projectType,
        managerId: w.alice.id,
        creatorId: w.alice.id,
      },
    });
    projectId = project.id;
    w.cleanupIds.projects.push(projectId);

    // Письма: входящие (2) и исходящее (1), зарегистрированные — с реквизитами
    // для гидрации экспорта; плюс незарегистрированное для гейта «Новых».
    const inType = await prisma.processType.findUniqueOrThrow({
      where: { code: 'letter-incoming' },
    });
    const outType = await prisma.processType.findUniqueOrThrow({
      where: { code: 'letter-outgoing' },
    });
    const inWorkflow = await prisma.workflow.findUniqueOrThrow({
      where: { code: 'letter.incoming' },
    });
    const outWorkflow = await prisma.workflow.findUniqueOrThrow({
      where: { code: 'letter.outgoing' },
    });
    const stageOf = async (workflowId: string, code: string) =>
      (await prisma.workflowStage.findFirstOrThrow({ where: { workflowId, code } })).id;
    // Входящие начинаются с «new», исходящие — с «draft» (каталог писем).
    const inStage = await stageOf(inWorkflow.id, 'new');
    const outStage = await stageOf(outWorkflow.id, 'draft');
    const inSeries = (await prisma.numberSeries.findFirstOrThrow({ where: { prefix: 'Вх' } })).id;
    // Серия «Исх» живёт в бутстрапе каталога; в старой тестовой БД её может
    // не быть — создаём свою по той же схеме правил (уборка не нужна).
    const outSeries =
      (
        await prisma.numberSeries.findFirst({
          where: { code: 'letter-outgoing' },
        })
      )?.id ??
      (
        await prisma.numberSeries.create({
          data: {
            code: `out-${w.runId}`,
            prefix: 'Исх',
            reset: 'year',
            name: `Исходящие ${w.runId}`,
            containers: [],
            period: 'year',
            template: letterSeriesTemplate('Исх') as never,
            startValue: 1,
          },
        })
      ).id;
    const reg = (series: string, seq: number) => ({
      regSeriesId: series,
      regYear: 2026,
      regSeq: seq,
      regDate: new Date(),
      registeredAt: new Date(),
      registrarId: w.alice.id,
    });

    counterpartyName = `Контрагент списка ${w.runId}`;
    const counterparty = await prisma.counterparty.create({
      data: { shortName: counterpartyName, fullName: `ООО «${counterpartyName}»` },
    });
    const ids: string[] = [];
    const letters = [
      {
        typeId: inType.id,
        workflowId: inWorkflow.id,
        stageId: inStage,
        direction: 'incoming',
        subject: `О поставке ${runTag} в проекте`,
        counterpartyId: counterparty.id,
        theirNumber: `№${runTag}`,
        theirDate: new Date('2026-11-20T00:00:00Z'),
        addresseeId: w.bob.id,
        projectId,
        customFields: { [hoursId]: 5 } as never,
        ...reg(inSeries, 9001),
      },
      {
        typeId: inType.id,
        workflowId: inWorkflow.id,
        stageId: inStage,
        direction: 'incoming',
        subject: `О поставке ${runTag} вне проекта`,
        customFields: { [hoursId]: 2 } as never,
        ...reg(inSeries, 9002),
      },
      {
        typeId: outType.id,
        workflowId: outWorkflow.id,
        stageId: outStage,
        direction: 'outgoing',
        subject: `Ответ ${runTag}`,
        addresseeId: w.alice.id,
        customFields: { [hoursId]: 9 } as never,
        ...reg(outSeries, 9003),
      },
    ];
    for (const data of letters) {
      const row = await prisma.letter.create({
        data: {
          ...data,
          systemState: 'backlog',
          regNumber: `${data.direction === 'incoming' ? 'Вх' : 'Исх'}-2026/${runTag}-${data.regSeq}`,
          createdBy: w.alice.id,
        } as never,
      });
      ids.push(row.id);
    }
    inProjectLetterId = ids[0]!;
    w.cleanupIds.letters.push(...ids);

    // Папки проекта с атрибутом — для выгрузки «Папки».
    const kind = await prisma.nodeKind.create({
      data: { name: `Вид выгрузки ${w.runId}`, icon: 'folder', color: 'blue' },
    });
    w.cleanupIds.nodeKinds.push(kind.id);
    for (let i = 0; i < 2; i++) {
      const node = await prisma.projectNode.create({
        data: {
          projectId,
          kindId: kind.id,
          name: `Папка выгрузки ${runTag} ${i}`,
          order: `fe${runTag}${i}`,
          customFields: { [hoursId]: 3 + i } as never,
        },
      });
      w.cleanupIds.nodes.push(node.id);
    }
  });

  afterAll(async () => {
    await prisma.counterparty.deleteMany({ where: { shortName: counterpartyName } });
    await w.cleanup();
  });

  it('ящики направлений: incoming/outgoing только свои, «Новые» — гейт права', async () => {
    const incoming = (await (
      await w.fx.api(w.alice, 'GET', '/letters?box=incoming&limit=100')
    ).json()) as Paginated<{ id: string }>;
    const outgoing = (await (
      await w.fx.api(w.alice, 'GET', '/letters?box=outgoing&limit=100')
    ).json()) as Paginated<{ id: string }>;
    expect(incoming.items.some((i) => i.id === inProjectLetterId)).toBe(true);
    expect(outgoing.items.some((i) => i.id === inProjectLetterId)).toBe(false);
    // Без права регистрации «Новые» закрыты (403, не пустой список).
    const denied = await w.fx.api(bobNoRegister, 'GET', '/letters?box=new&limit=10');
    expect(denied.status).toBe(403);
  });

  it('поиск: тема, рег.номер и контрагент подсказкой находят письмо', async () => {
    const bySubject = (await (
      await w.fx.api(
        w.alice,
        'GET',
        `/letters?search=${encodeURIComponent(`О поставке ${runTag}`)}&limit=100`,
      )
    ).json()) as Paginated<{ id: string }>;
    expect(bySubject.items.some((i) => i.id === inProjectLetterId)).toBe(true);
    const byNumber = (await (
      await w.fx.api(
        w.alice,
        'GET',
        `/letters?search=${encodeURIComponent(`-2026/${runTag}-`)}&limit=100`,
      )
    ).json()) as Paginated<{ id: string }>;
    expect(byNumber.items.some((i) => i.id === inProjectLetterId)).toBe(true);
    // Контрагент — частью OR поиска: письмо без темы в совпадениях всё равно
    // находится по имени контрагента.
    const byCounterparty = (await (
      await w.fx.api(
        w.alice,
        'GET',
        `/letters?search=${encodeURIComponent(counterpartyName)}&limit=100`,
      )
    ).json()) as Paginated<{ id: string }>;
    expect(byCounterparty.items.some((i) => i.id === inProjectLetterId)).toBe(true);
  });

  it('группы и итоги писем: группировка по стадии, min(Создано) — датой ISO', async () => {
    const group = JSON.stringify({ field: 'stage' });
    const totals = JSON.stringify([
      { fn: 'count' },
      { fn: 'min', field: 'createdAt' },
      { fn: 'max', field: w.cf('hours') },
    ]);
    const res = await w.fx.api(
      w.alice,
      'GET',
      `/letters?limit=5&group=${encodeURIComponent(group)}&totals=${encodeURIComponent(totals)}`,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      groups: { key: string | null; count: number; totals: unknown[] }[];
      totals: { fn: string; value: number | string | null }[];
    };
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.groups.every((bucket) => bucket.count > 0)).toBe(true);
    const min = body.totals.find((t) => t.fn === 'min')?.value;
    expect(typeof min).toBe('string');
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}[ T]/);
    expect(body.totals.find((t) => t.fn === 'max')?.value).toBe(9);
    // Итог по полю чужой сущности — 422, как у задач.
    const bad = JSON.stringify([{ fn: 'min', field: 'title' }]);
    const invalid = await w.fx.api(
      w.alice,
      'GET',
      `/letters?limit=5&totals=${encodeURIComponent(bad)}`,
    );
    expect(invalid.status).toBe(422);
  });

  it('CSV письма (журнал): синхронно, имена вместо id, атрибут числом, фильтр полей', async () => {
    const res = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'letter',
        scope: { kind: 'journal' },
        filter: [{ kind: 'field', field: w.cf('hours'), op: 'gte', value: 2 }],
        sort: [{ field: w.cf('hours'), dir: 'asc' }],
        columns: [
          { field: 'regNumber' },
          { field: 'correspondent' },
          { field: 'sentAt' },
          { field: 'assignee' },
          { field: 'type' },
          { field: 'stage' },
          { field: w.cf('hours') },
        ],
      },
      key: `lf-csv-${runTag}`,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; url: string };
    expect(body.status).toBe('done');
    const origin = w.fx.baseUrl.replace('/api/v1', '');
    const file = await fetch(`${origin}${body.url}`);
    expect(file.status).toBe(200);
    const text = Buffer.from(await file.arrayBuffer()).toString('utf8');
    expect(text).toContain(
      'Регистрационный номер;Корреспондент;Дата документа;Адресат;Тип;Статус маршрута;',
    );
    const line = text.split('\r\n').find((l) => l.includes(`-2026/${runTag}-9001`))!;
    expect(line).toContain(counterpartyName);
    expect(line).toContain('2026-11-20');
    expect(line).toContain('Входящее письмо');
    expect(line.endsWith(';5')).toBe(true);
    // Фильтр gte=2 отсекает пустые атрибуты, но не письма с 2 и 5.
    const rows = text.split('\r\n').filter((l) => l.includes(`-2026/${runTag}-`));
    expect(rows).toHaveLength(3);
    // Порядок сортировки по атрибуту: 2 → 5 → 9.
    expect(rows.map((l) => Number(l.slice(-1)))).toEqual([2, 5, 9]);
  });

  it('CSV письмо (рамка проекта): только письма проекта', async () => {
    const res = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'letter',
        scope: { kind: 'project', projectId },
        columns: [{ field: 'regNumber' }, { field: 'project' }],
      },
      key: `lf-csv-prj-${runTag}`,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; url: string };
    expect(body.status).toBe('done');
    const origin = w.fx.baseUrl.replace('/api/v1', '');
    const text = Buffer.from(await (await fetch(`${origin}${body.url}`)).arrayBuffer()).toString(
      'utf8',
    );
    const rows = text.split('\r\n').filter((l) => l.includes(`-2026/${runTag}-`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`Письма списков ${w.runId}`);
  });

  it('CSV папки (рамка проекта): имя, вид и атрибут', async () => {
    const res = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'folder',
        scope: { kind: 'project', projectId },
        sort: [{ field: w.cf('hours'), dir: 'desc' }],
        columns: [{ field: 'name' }, { field: 'kind' }, { field: w.cf('hours') }],
      },
      key: `lf-csv-fld-${runTag}`,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; url: string };
    expect(body.status).toBe('done');
    const origin = w.fx.baseUrl.replace('/api/v1', '');
    const text = Buffer.from(await (await fetch(`${origin}${body.url}`)).arrayBuffer()).toString(
      'utf8',
    );
    const rows = text.split('\r\n').filter((l) => l.includes(`Папка выгрузки ${runTag}`));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(`Вид выгрузки ${w.runId}`);
    // desc: 4 раньше 3.
    expect(rows.map((l) => Number(l.slice(-1)))).toEqual([4, 3]);
  });
});
