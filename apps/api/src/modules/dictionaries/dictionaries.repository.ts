import { Injectable } from '@nestjs/common';
import { stageColorSchema } from '@nodus/contracts';
import { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Позиция keyset-курсора списка элементов: порядок (sortOrder, name, id). */
export interface ItemCursor {
  sortOrder: number;
  name: string;
  id: string;
}

/** Поля записи справочника и элемента (белые списки сервиса). */
export interface DictionaryWriteData {
  name: string;
}

export interface DictionaryItemWriteData {
  name: string;
  code: string | null;
  sortOrder: number;
  /** Тон варианта списка (Р6 #631); null — без цвета. */
  color?: string | null;
}

const dictionarySelect = {
  id: true,
  code: true,
  name: true,
  hierarchical: true,
  isSystem: true,
} as const;

const itemSelect = {
  id: true,
  dictionaryId: true,
  parentId: true,
  code: true,
  name: true,
  color: true,
  sortOrder: true,
  isActive: true,
} as const;

/**
 * Доступ к таблицам dictionaries / dictionary_items (модуль ядра, I15).
 * Мутации принимают `tx`: справочник и его элементы меняются в одной
 * транзакции с outbox-событием (I9).
 */
@Injectable()
export class DictionariesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Страница справочников по `code` (+1 строка — признак следующей страницы). */
  async listDictionaries(limit: number, afterCode: string | null) {
    return this.prisma.dictionary.findMany({
      where: afterCode ? { code: { gt: afterCode } } : {},
      orderBy: { code: 'asc' },
      take: limit + 1,
      select: dictionarySelect,
    });
  }

  async findDictionaryByCode(code: string, tx?: TransactionClient) {
    return this.db(tx).dictionary.findUnique({ where: { code }, select: dictionarySelect });
  }

  async findDictionaryById(id: string, tx?: TransactionClient) {
    return this.db(tx).dictionary.findUnique({ where: { id }, select: dictionarySelect });
  }

  /** Страница элементов справочника, keyset по (sortOrder, name, id); +1 строка. */
  async listItems(
    dictionaryId: string,
    opts: { includeArchived: boolean; limit: number; after: ItemCursor | null },
  ) {
    const { after } = opts;
    const rows = await this.prisma.dictionaryItem.findMany({
      where: {
        dictionaryId,
        ...(opts.includeArchived ? {} : { isActive: true }),
        ...(after
          ? {
              OR: [
                { sortOrder: { gt: after.sortOrder } },
                { sortOrder: after.sortOrder, name: { gt: after.name } },
                { sortOrder: after.sortOrder, name: after.name, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: opts.limit + 1,
      select: itemSelect,
    });
    return rows.map((row) => normalizeItem(row));
  }

  /** Все элементы справочника (без страницы) — сверка порядка и уборка. */
  async allItems(dictionaryId: string, tx?: TransactionClient) {
    return this.db(tx).dictionaryItem.findMany({
      where: { dictionaryId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: itemSelect,
    });
  }

  async findItemById(id: string, tx?: TransactionClient) {
    const row = await this.db(tx).dictionaryItem.findUnique({ where: { id }, select: itemSelect });
    return row ? normalizeItem(row) : null;
  }

  /** Активный элемент с таким названием (lower + trim) — проверка уникальности. */
  async findActiveItemByName(
    dictionaryId: string,
    name: string,
    exceptId: string | null,
    tx?: TransactionClient,
  ) {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM dictionary_items
      WHERE dictionary_id = ${dictionaryId}::uuid
        AND is_active
        AND lower(btrim(name)) = lower(btrim(${name}))
        ${exceptId ? Prisma.sql`AND id <> ${exceptId}::uuid` : Prisma.empty}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Максимальный sortOrder справочника (-1 — пусто): новый вариант в конец. */
  async maxItemSortOrder(dictionaryId: string, tx?: TransactionClient): Promise<number> {
    const row = await this.db(tx).dictionaryItem.aggregate({
      where: { dictionaryId },
      _max: { sortOrder: true },
    });
    return row._max.sortOrder ?? -1;
  }

  async createDictionary(
    data: { code: string; name: string },
    tx: TransactionClient,
  ): Promise<{ id: string; code: string; name: string; hierarchical: boolean; isSystem: boolean }> {
    return tx.dictionary.create({
      data: { code: data.code, name: data.name },
      select: dictionarySelect,
    });
  }

  async renameDictionary(id: string, data: DictionaryWriteData, tx: TransactionClient) {
    return tx.dictionary.update({ where: { id }, data, select: dictionarySelect });
  }

  async createItem(
    data: DictionaryItemWriteData & { dictionaryId: string },
    tx: TransactionClient,
  ) {
    const row = await tx.dictionaryItem.create({ data, select: itemSelect });
    return normalizeItem(row);
  }

  /** Правка варианта: имя и/или цвет (Р6 #631: PATCH цвета без переименования). */
  async updateItem(
    id: string,
    data: { name?: string; color?: string | null },
    tx: TransactionClient,
  ) {
    const row = await tx.dictionaryItem.update({ where: { id }, data, select: itemSelect });
    return normalizeItem(row);
  }

  async deleteItem(id: string, tx: TransactionClient): Promise<void> {
    await tx.dictionaryItem.delete({ where: { id } });
  }

  /** Порядок вариантов: sortOrder = индекс в `ids` (одним UPDATE … FROM). */
  async applyItemOrder(ids: readonly string[], tx: TransactionClient): Promise<void> {
    if (ids.length === 0) return;
    const values = Prisma.join(ids.map((id, index) => Prisma.sql`(${id}::uuid, ${index}::int)`));
    await tx.$executeRaw(Prisma.sql`
      UPDATE dictionary_items AS i
      SET sort_order = v.sort_order, updated_at = now()
      FROM (VALUES ${values}) AS v(id, sort_order)
      WHERE i.id = v.id
    `);
  }

  /** Advisory-лок справочника на транзакцию: уникальность имён вариантов
   *  проверяется и пишется сериализованно (прецедент #177/#195). */
  async lockDictionary(dictionaryId: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(434, hashtext(${dictionaryId}::text))
    `);
  }

  /** Свободный код `list-<8hex>`: генерация с проверкой занятости. */
  async generateCode(tx: TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `list-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
      const taken = await tx.dictionary.findUnique({ where: { code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new Error('dictionary code generation failed');
  }

  /** Справочники по id — пачкой (порт чтения, Р6). */
  async findDictionaryRefs(ids: readonly string[], tx?: TransactionClient) {
    if (ids.length === 0) return [];
    return this.db(tx).dictionary.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, name: true, isSystem: true },
    });
  }

  /** Элементы по id — пачкой, включая архивные (история читается). */
  async findItemRefs(ids: readonly string[], tx?: TransactionClient) {
    if (ids.length === 0) return [];
    const rows = await this.db(tx).dictionaryItem.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, dictionaryId: true, name: true, code: true, isActive: true, color: true },
    });
    return rows.map(normalizeItem);
  }

  /** Активный элемент конкретного справочника — запись значения (Р1). */
  async findActiveItemRef(dictionaryId: string, itemId: string, tx?: TransactionClient) {
    const row = await this.db(tx).dictionaryItem.findFirst({
      where: { id: itemId, dictionaryId, isActive: true },
      select: { id: true, dictionaryId: true, name: true, code: true, isActive: true, color: true },
    });
    return row ? normalizeItem(row) : null;
  }

  /** Все варианты справочника (обратная конвертация формул, #632). */
  async findItemsOf(dictionaryId: string, tx?: TransactionClient) {
    const rows = await this.db(tx).dictionaryItem.findMany({
      where: { dictionaryId },
      select: { id: true, dictionaryId: true, name: true, code: true, isActive: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(normalizeItem);
  }

  /** Id системного справочника по коду (#55: `receipt-method` в регистрации). */
  async findIdByCode(code: string, tx?: TransactionClient): Promise<string | null> {
    const row = await this.db(tx).dictionary.findUnique({ where: { code }, select: { id: true } });
    return row?.id ?? null;
  }

  /** Активный элемент справочника по коду элемента (#56: поллер почты
   *  подставляет «Электронная почта» из `receipt-method` без пользователя). */
  async findActiveItemByCode(
    dictionaryCode: string,
    itemCode: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; name: string } | null> {
    const dictionary = await this.db(tx).dictionary.findUnique({
      where: { code: dictionaryCode },
      select: { id: true },
    });
    if (!dictionary) return null;
    return this.db(tx).dictionaryItem.findFirst({
      where: { dictionaryId: dictionary.id, code: itemCode, isActive: true },
      select: { id: true, name: true },
    });
  }

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }
}

/** Цвет варианта нормализуется к палитре темы (Р6 #631): чужой ключ из БД
 *  читается как «без цвета» — чипы не ломаются. */
function normalizeItem<T extends { color: string | null }>(
  row: T,
): Omit<T, 'color'> & {
  color: StageColor | null;
} {
  const color = stageColorSchema.options.find((option) => option === row.color);
  return { ...row, color: color ?? null };
}

type StageColor = (typeof stageColorSchema.options)[number];
