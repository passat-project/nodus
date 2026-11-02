import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FieldDefinitionRow } from './definition.mapper.js';

/** Порядок областей в выдаче реестра (Р4): задачи, письма, проекты, папки,
 *  контрагенты. */
const SCOPE_ORDER = ['task', 'letter', 'project', 'node', 'counterparty'] as const;

const definitionSelect = {
  id: true,
  scope: true,
  type: true,
  name: true,
  hint: true,
  settings: true,
  defaultValue: true,
  reportIndexed: true,
  hidden: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  typeBindings: { select: { processTypeId: true } },
} as const;

/** Поля записи определения (белый список сервиса, без id/служебных). */
export interface FieldDefinitionWriteData {
  scope: string;
  type: string;
  name: string;
  hint: string | null;
  settings: Prisma.InputJsonValue;
  defaultValue: Prisma.InputJsonValue | null;
  reportIndexed: boolean;
  hidden: boolean;
  sortOrder: number;
  createdById: string | null;
}

/**
 * Доступ к `field_definitions` (модуль custom-fields, I3): таблица своя,
 * чужие модули читают значения только через порт `CUSTOM_FIELD_REGISTRY`.
 * Определения читаются БЕЗ кэша: ≤ 100 строк на область, индекс
 * `(scope, sort_order, id)` — один запрос на операцию (Р2).
 */
@Injectable()
export class DefinitionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Реестр области (или всех) в порядке карточки и фильтров. С `typeId` —
   *  только атрибуты, привязанные к типу (#432, Р8); с `fieldIds` — только
   *  атрибуты формы вида папки (#556, Р4). */
  async list(
    scope: string | null,
    tx?: TransactionClient,
    opts: { typeId?: string; fieldIds?: readonly string[] } = {},
  ): Promise<FieldDefinitionRow[]> {
    const rows = await this.db(tx).fieldDefinition.findMany({
      where: {
        ...(scope ? { scope } : {}),
        ...(opts.typeId ? { typeBindings: { some: { processTypeId: opts.typeId } } } : {}),
        ...(opts.fieldIds ? { id: { in: [...opts.fieldIds] } } : {}),
      },
      select: definitionSelect,
    });
    return rows.sort(
      (a, b) =>
        SCOPE_ORDER.indexOf(a.scope as (typeof SCOPE_ORDER)[number]) -
          SCOPE_ORDER.indexOf(b.scope as (typeof SCOPE_ORDER)[number]) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id),
    );
  }

  async findById(id: string, tx?: TransactionClient): Promise<FieldDefinitionRow | null> {
    return this.db(tx).fieldDefinition.findUnique({ where: { id }, select: definitionSelect });
  }

  async countInScope(scope: string, tx?: TransactionClient): Promise<number> {
    return this.db(tx).fieldDefinition.count({ where: { scope } });
  }

  /** Занятое имя области (lower + trim) — проверка под advisory-локом. */
  async findByName(
    scope: string,
    name: string,
    exceptId: string | null,
    tx?: TransactionClient,
  ): Promise<{ id: string } | null> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM field_definitions
      WHERE scope = ${scope}
        AND lower(btrim(name)) = lower(btrim(${name}))
        ${exceptId ? Prisma.sql`AND id <> ${exceptId}::uuid` : Prisma.empty}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async maxSortOrder(scope: string, tx?: TransactionClient): Promise<number> {
    const row = await this.db(tx).fieldDefinition.aggregate({
      where: { scope },
      _max: { sortOrder: true },
    });
    return row._max.sortOrder ?? -1;
  }

  async create(data: FieldDefinitionWriteData, tx: TransactionClient): Promise<FieldDefinitionRow> {
    return tx.fieldDefinition.create({
      data: { ...data, defaultValue: data.defaultValue ?? Prisma.DbNull },
      select: definitionSelect,
    });
  }

  async update(
    id: string,
    data: Partial<Omit<FieldDefinitionWriteData, 'scope' | 'createdById'>>,
    tx: TransactionClient,
  ): Promise<FieldDefinitionRow> {
    // `default_value` nullable: Prisma различает «не менять» (undefined) и
    // «очистить» (DbNull) — null из домена переводится в DbNull явно.
    const { defaultValue, ...rest } = data;
    return tx.fieldDefinition.update({
      where: { id },
      data: {
        ...rest,
        ...(defaultValue === undefined
          ? {}
          : { defaultValue: defaultValue === null ? Prisma.DbNull : defaultValue }),
      },
      select: definitionSelect,
    });
  }

  async remove(id: string, tx: TransactionClient): Promise<void> {
    await tx.fieldDefinition.delete({ where: { id } });
  }

  /** Привязка к типу — идемпотентна: повтор не ошибка (#432, Р8). */
  async bindType(definitionId: string, typeId: string, tx: TransactionClient): Promise<void> {
    await tx.fieldDefinitionType.upsert({
      where: { definitionId_processTypeId: { definitionId, processTypeId: typeId } },
      update: {},
      create: { definitionId, processTypeId: typeId },
    });
  }

  /** Снятие привязки — идемпотентно; `false` — связи не было. */
  async unbindType(definitionId: string, typeId: string, tx: TransactionClient): Promise<boolean> {
    const { count } = await tx.fieldDefinitionType.deleteMany({
      where: { definitionId, processTypeId: typeId },
    });
    return count > 0;
  }

  /** Замена набора типов атрибута (тело создания/правки с `typeIds`). */
  async replaceTypes(
    definitionId: string,
    typeIds: readonly string[],
    tx: TransactionClient,
  ): Promise<void> {
    await tx.fieldDefinitionType.deleteMany({
      where: {
        definitionId,
        ...(typeIds.length > 0 ? { processTypeId: { notIn: [...typeIds] } } : {}),
      },
    });
    if (typeIds.length === 0) return;
    await tx.fieldDefinitionType.createMany({
      data: typeIds.map((processTypeId) => ({ definitionId, processTypeId })),
      skipDuplicates: true,
    });
  }

  /** Порядок атрибутов области: sortOrder = индекс в `ids` (один UPDATE … FROM). */
  async applyOrder(ids: readonly string[], tx: TransactionClient): Promise<void> {
    if (ids.length === 0) return;
    const values = Prisma.join(ids.map((id, index) => Prisma.sql`(${id}::uuid, ${index}::int)`));
    await tx.$executeRaw(Prisma.sql`
      UPDATE field_definitions AS f
      SET sort_order = v.sort_order, updated_at = now()
      FROM (VALUES ${values}) AS v(id, sort_order)
      WHERE f.id = v.id
    `);
  }

  /** Advisory-лок области на транзакцию: имя, лимит и порядок сериализуются
   *  (прецедент #177/#195; partial unique Prisma не декларирует — Р4). */
  async lockScope(scope: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(431, hashtext(${scope}::text))
    `);
  }

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }
}
