import { describe, expect, it } from 'vitest';
import { customFieldKey, type ListSort, type ListTotal } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import {
  assertListField,
  buildStageFlagIndex,
  filterSql,
  keysetAfterSql,
  orderSql,
  predicateSql,
  totalSelectSql,
  type CatalogStageFlag,
  type ListCfDef,
  type ListSqlContext,
} from './list-ext-sql.js';

/** Строка SQL из фрагмента — для чтаемых ассертов (параметры — ?). */
function textOf(sql: Prisma.Sql): string {
  return sql.strings.join('?');
}

const UUID = '00000000-0000-4000-8000-0000000000ff';
const field = (id: string) => customFieldKey(id);

function ctxOf(
  defs: Record<string, string>,
  entity: ListSqlContext['entity'] = 'task',
): ListSqlContext {
  const map = new Map<string, ListCfDef>(
    Object.entries(defs).map(([id, type]) => {
      const def: ListCfDef = { id, type: type as ListCfDef['type'], settings: {} };
      return [id, def] as const;
    }),
  );
  return {
    entity,
    defs: map,
    systemExpr: {
      number: { expr: Prisma.sql`t.number`, cast: 'numeric' },
      title: { expr: Prisma.sql`t.title`, cast: 'text' },
      deadline: { expr: Prisma.sql`t.deadline`, cast: 'timestamptz' },
    },
    cfColumn: Prisma.sql`t.custom_fields`,
    idExpr: Prisma.sql`t.id`,
    systemPredicates: {
      typeId: Prisma.sql`t.type_id`,
      stageId: Prisma.sql`t.stage_id`,
      systemState: Prisma.sql`t.system_state`,
    },
  };
}

const NO_STAGES = buildStageFlagIndex([]);

describe('list-ext-sql (#435): предикаты атрибутов', () => {
  it('число: eq/gt через защищённый numeric-каст (мусор в JSONB — NULL, не 500)', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    const eq = predicateSql(
      { kind: 'field', field: field(UUID), op: 'eq', value: 42 },
      ctx,
      NO_STAGES,
    );
    expect(textOf(eq)).toContain('~');
    expect(textOf(eq)).toContain('::numeric');
    expect(eq.values).toContain(42);
    const gt = predicateSql(
      { kind: 'field', field: field(UUID), op: 'gt', value: 7 },
      ctx,
      NO_STAGES,
    );
    expect(textOf(gt)).toContain('>');
  });

  it('деньги: eq — сумма И валюта; сравнение — только той же валюты', () => {
    const ctx = ctxOf({ [UUID]: 'money' });
    const eq = predicateSql(
      {
        kind: 'field',
        field: field(UUID),
        op: 'eq',
        value: { amount: 99.5, currencyId: 'cur-1' },
      },
      ctx,
      NO_STAGES,
    );
    expect(textOf(eq)).toContain("->> 'amount'");
    expect(textOf(eq)).toContain("->> 'currencyId'");
    expect(() =>
      predicateSql({ kind: 'field', field: field(UUID), op: 'eq', value: 'x' }, ctx, NO_STAGES),
    ).toThrowError(/not applicable/);
  });

  it('текст/дата: лексикографическое сравнение (ISO-даты упорядочены)', () => {
    const ctx = ctxOf({ [UUID]: 'date' });
    const lt = predicateSql(
      { kind: 'field', field: field(UUID), op: 'lte', value: '2026-11-01' },
      ctx,
      NO_STAGES,
    );
    expect(textOf(lt)).toContain('#>>');
    expect(textOf(lt)).toContain('<=');
  });

  it('multienum in_any: containment ?| для массива, ANY — для скаляра (Р3)', () => {
    const ctx = ctxOf({ [UUID]: 'multienum' });
    const inAny = predicateSql(
      { kind: 'field', field: field(UUID), op: 'in_any', value: ['a', 'b'] },
      ctx,
      NO_STAGES,
    );
    const text = textOf(inAny);
    expect(text).toContain('?|');
    expect(text).toContain('= ANY(');
  });

  it('filled: дефис-маркер и пустая строка — не заполнено; eq null — не заполнено', () => {
    const ctx = ctxOf({ [UUID]: 'text' });
    const filled = predicateSql(
      { kind: 'field', field: field(UUID), op: 'filled' },
      ctx,
      NO_STAGES,
    );
    expect(textOf(filled)).toContain('CASE jsonb_typeof');
    const eqNull = predicateSql(
      { kind: 'field', field: field(UUID), op: 'eq', value: null },
      ctx,
      NO_STAGES,
    );
    expect(textOf(eqNull)).toContain('NOT');
  });

  it('contains: ILIKE с экранированием метасимволов', () => {
    const ctx = ctxOf({ [UUID]: 'text' });
    const contains = predicateSql(
      { kind: 'field', field: field(UUID), op: 'contains', value: '50%' },
      ctx,
      NO_STAGES,
    );
    expect(contains.values.some((v) => String(v).includes('50\\%'))).toBe(true);
  });

  it('несовместимое значение с оператором — 422 LIST_FIELD_INVALID', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    expect(() =>
      predicateSql({ kind: 'field', field: field(UUID), op: 'eq', value: 'x' }, ctx, NO_STAGES),
    ).toThrowError(/not applicable/);
  });
});

describe('list-ext-sql: системные предикаты и стадии', () => {
  it('stage_is по неживой стадии и outcome без стадий — ложны', () => {
    const ctx = ctxOf({});
    expect(textOf(predicateSql({ kind: 'stage_is', stageId: UUID }, ctx, NO_STAGES))).toBe('false');
    expect(textOf(predicateSql({ kind: 'outcome', outcome: 'success' }, ctx, NO_STAGES))).toBe(
      'false',
    );
  });

  it('«результат выдан»: отметка и все стадии позже; без отметок — closed+success', () => {
    const flags: CatalogStageFlag[] = [
      {
        id: 's1',
        workflowId: 'w1',
        sortOrder: 10,
        systemState: 'active',
        outcome: null,
        resultIssued: false,
      },
      {
        id: 's2',
        workflowId: 'w1',
        sortOrder: 20,
        systemState: 'active',
        outcome: null,
        resultIssued: true,
      },
      {
        id: 's3',
        workflowId: 'w1',
        sortOrder: 30,
        systemState: 'closed',
        outcome: 'success',
        resultIssued: false,
      },
      {
        id: 's4',
        workflowId: 'w2',
        sortOrder: 10,
        systemState: 'closed',
        outcome: 'cancelled',
        resultIssued: false,
      },
      {
        id: 's5',
        workflowId: 'w2',
        sortOrder: 20,
        systemState: 'closed',
        outcome: 'success',
        resultIssued: false,
      },
    ];
    const index = buildStageFlagIndex(flags);
    expect([...index.issuedStageIds].sort()).toEqual(['s2', 's3', 's5']);
    expect([...index.outcomeStages.get('success')!]).toEqual(['s3', 's5']);
  });
});

describe('list-ext-sql: сортировка и курсор', () => {
  it('ORDER BY: направление + NULLS LAST + id tie-break', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    const order = orderSql(
      [
        { field: field(UUID), dir: 'desc' },
        { field: 'title', dir: 'asc' },
      ],
      ctx,
    );
    const text = textOf(order);
    expect(text).toContain('DESC NULLS LAST');
    expect(text).toContain('ASC NULLS LAST');
    expect(text.endsWith('ASC')).toBe(true);
  });

  it('keyset asc: NULL-блок после значений, равные — к следующему ключу', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    const sorts: ListSort[] = [{ field: field(UUID), dir: 'asc' }];
    const after = keysetAfterSql({ o: [5], id: UUID }, sorts, ctx);
    const text = textOf(after);
    expect(text).toContain('IS NULL OR');
    expect(text).toContain('> ?::numeric');
    expect(text).toContain('= ?::numeric AND');
  });

  it('keyset в NULL-блоке: дальше только NULL с большим id', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    const sorts: ListSort[] = [{ field: field(UUID), dir: 'asc' }];
    const after = keysetAfterSql({ o: [null], id: UUID }, sorts, ctx);
    expect(textOf(after)).toContain('IS NULL AND');
  });

  it('ключ курсора не совпадает с числом полей сортировки — VALIDATION_FAILED', () => {
    const ctx = ctxOf({ [UUID]: 'number' });
    const sorts: ListSort[] = [
      { field: field(UUID), dir: 'asc' },
      { field: 'title', dir: 'asc' },
    ];
    expect(() => keysetAfterSql({ o: [1], id: UUID }, sorts, ctx)).toThrowError(/cursor/i);
  });
});

describe('list-ext-sql: итоги и проверка полей', () => {
  it('sum нечислового поля — 422; числового — float8', () => {
    const num = '00000000-0000-4000-8000-0000000000f1';
    const txt = '00000000-0000-4000-8000-0000000000f2';
    const ctx = ctxOf({ [num]: 'number', [txt]: 'text' });
    const sum: ListTotal = { fn: 'sum', field: field(num) };
    expect(textOf(totalSelectSql(sum, ctx))).toContain('::float8');
    expect(() => totalSelectSql({ fn: 'sum', field: field(txt) }, ctx)).toThrowError(
      /not applicable/,
    );
  });

  it('assertListField: системное поле чужой сущности и неизвестный атрибут — 422', () => {
    const taskCtx = ctxOf({});
    expect(() => assertListField('regNumber', taskCtx)).toThrowError(/not applicable/);
    expect(() => assertListField('correspondent', taskCtx)).toThrowError(/not applicable/);
    expect(() => assertListField(field(UUID), taskCtx)).toThrowError(/not applicable/);
    // Задачные поля (включая «кто решил») проходят
    expect(() => assertListField('decidedBy', taskCtx)).not.toThrow();
    expect(() => assertListField('title', taskCtx)).not.toThrow();
  });

  it('конъюнкция фильтра: пустой — true, из двух — AND', () => {
    const ctx = ctxOf({});
    expect(textOf(filterSql([], ctx, NO_STAGES))).toBe('true');
    const two = filterSql(
      [
        { kind: 'type_is', typeId: UUID },
        { kind: 'system_state', state: 'active' },
      ],
      ctx,
      NO_STAGES,
    );
    expect(textOf(two)).toContain(' AND ');
  });
});
