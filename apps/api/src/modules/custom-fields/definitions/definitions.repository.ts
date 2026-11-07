import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { CustomFieldValue } from '@nodus/contracts';
import type { FieldDefinitionRow } from './definition.mapper.js';

const definitionSelect = {
  id: true,
  number: true,
  type: true,
  name: true,
  hint: true,
  settings: true,
  defaultValue: true,
  reportIndexed: true,
  isCompany: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  bindings: { select: { targetKind: true, targetId: true, defaultFormula: true } },
  companyValue: { select: { value: true } },
} as const;

/** Поля записи определения (белый список сервиса, без id/служебных). */
export interface FieldDefinitionWriteData {
  number: number;
  type: string;
  name: string;
  hint: string | null;
  settings: Prisma.InputJsonValue;
  defaultValue: Prisma.InputJsonValue | null;
  reportIndexed: boolean;
  isCompany: boolean;
  sortOrder: number;
  createdById: string | null;
}

/** Привязки «Где используется» (Р3) в разрезе по видам целей. */
export interface FieldBindingsData {
  processTypeIds: readonly string[];
  projectTypeIds: readonly string[];
  nodeKindIds: readonly string[];
}

/**
 * Доступ к `field_definitions` (модуль custom-fields, I3): таблица своя,
 * чужие модули читают значения только через порт `CUSTOM_FIELD_REGISTRY`.
 * Реестр один на портал (≤ 1000, Р12), выдача по (sort_order, id) — один
 * запрос на операцию без кэша.
 */
@Injectable()
export class DefinitionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Весь реестр портала в порядке карточки; фильтр по модулю — сервисом. */
  async list(tx?: TransactionClient): Promise<FieldDefinitionRow[]> {
    const rows = await this.db(tx).fieldDefinition.findMany({
      select: definitionSelect,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows;
  }

  async findById(id: string, tx?: TransactionClient): Promise<FieldDefinitionRow | null> {
    return this.db(tx).fieldDefinition.findUnique({ where: { id }, select: definitionSelect });
  }

  async countAll(tx?: TransactionClient): Promise<number> {
    return this.db(tx).fieldDefinition.count();
  }

  /** Занятое имя портала (lower + trim) — проверка под advisory-локом;
   *  возвращает id и каноническое имя занявшей строки (suggestion 409). */
  async findByName(
    name: string,
    exceptId: string | null,
    tx?: TransactionClient,
  ): Promise<{ id: string; name: string } | null> {
    const rows = await this.db(tx).$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
      SELECT id, name FROM field_definitions
      WHERE lower(btrim(name)) = lower(btrim(${name}))
        ${exceptId ? Prisma.sql`AND id <> ${exceptId}::uuid` : Prisma.empty}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async maxSortOrder(tx?: TransactionClient): Promise<number> {
    const row = await this.db(tx).fieldDefinition.aggregate({ _max: { sortOrder: true } });
    return row._max.sortOrder ?? -1;
  }

  /** Внутренний номер (Р2): sequence, не переиспользуется; выдача внутри
   *  транзакции создания — атомарно без гонки. */
  async nextNumber(tx: TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<
      { n: number }[]
    >`SELECT nextval('field_definitions_number_seq') AS n`;
    return Number(rows[0]!.n);
  }

  async create(data: FieldDefinitionWriteData, tx: TransactionClient): Promise<FieldDefinitionRow> {
    return tx.fieldDefinition.create({
      data: { ...data, defaultValue: data.defaultValue ?? Prisma.DbNull },
      select: definitionSelect,
    });
  }

  async update(
    id: string,
    data: Partial<Omit<FieldDefinitionWriteData, 'number' | 'isCompany' | 'createdById'>>,
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

  /** Удаление всегда разрешено (Р8): bindings/company_value — каскадом,
   *  значения стирают владельцы по событию `deleted`. */
  async remove(id: string, tx: TransactionClient): Promise<void> {
    await tx.fieldDefinition.delete({ where: { id } });
  }

  /** Привязка к месту — идемпотентна: повтор не ошибка (Р3). */
  async bindTarget(
    definitionId: string,
    targetKind: 'process_type' | 'project_type' | 'node_kind',
    targetId: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.fieldBinding.upsert({
      where: {
        definitionId_targetKind_targetId: { definitionId, targetKind, targetId },
      },
      update: {},
      create: { definitionId, targetKind, targetId },
    });
  }

  /** Снятие привязки — идемпотентно; `false` — связи не было (Р8: снятие
   *  разрешено всегда, опубликованные маршруты не блокируются). */
  async unbindTarget(
    definitionId: string,
    targetKind: 'process_type' | 'project_type' | 'node_kind',
    targetId: string,
    tx: TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.fieldBinding.deleteMany({
      where: { definitionId, targetKind, targetId },
    });
    return count > 0;
  }

  /** Формула места (#632, Р6): AST на привязке «атрибут × тип/вид».
   *  null — формулы нет. Привязки нет — false (404 на уровне сервиса). */
  async setBindingFormula(
    definitionId: string,
    targetKind: 'process_type' | 'project_type' | 'node_kind',
    targetId: string,
    ast: Prisma.InputJsonValue | null,
    tx: TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.fieldBinding.updateMany({
      where: { definitionId, targetKind, targetId },
      data: { defaultFormula: ast === null ? Prisma.DbNull : ast },
    });
    return count > 0;
  }

  /** Замена набора привязок одного вида цели (тела создания/правки с
   *  `bindings`, формы вида/типа: слот И ЕСТЬ привязка — Р3/Р10). */
  async replaceTargets(
    definitionId: string,
    targetKind: 'process_type' | 'project_type' | 'node_kind',
    targetIds: readonly string[],
    tx: TransactionClient,
  ): Promise<void> {
    await tx.fieldBinding.deleteMany({
      where: {
        definitionId,
        targetKind,
        ...(targetIds.length > 0 ? { targetId: { notIn: [...targetIds] } } : {}),
      },
    });
    if (targetIds.length === 0) return;
    await tx.fieldBinding.createMany({
      data: targetIds.map((targetId) => ({ definitionId, targetKind, targetId })),
      skipDuplicates: true,
    });
  }

  /** Синхронизация привязок формы места (Р10): слот добавлен — привязка
   *  появляется, слот СНЯТ (`removedFieldIds`) — привязка снимается.
   *  Привязки без слотов не трогаются: их законно сеет миграция (системные
   *  поля на все места) и ставит диалог атрибута (#646). Значения не
   *  трогаются. Один вызов на запись формы (форма и привязки — одна
   *  операция в транзакции записи формы). */
  async syncTargets(
    targetKind: 'project_type' | 'node_kind',
    targetId: string,
    fieldIds: readonly string[],
    removedFieldIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<void> {
    if (removedFieldIds.length > 0) {
      await this.db(tx).fieldBinding.deleteMany({
        where: { targetKind, targetId, definitionId: { in: [...removedFieldIds] } },
      });
    }
    if (fieldIds.length === 0) return;
    await this.db(tx).fieldBinding.createMany({
      data: fieldIds.map((definitionId) => ({ definitionId, targetKind, targetId })),
      skipDuplicates: true,
    });
  }

  /** Значение глобальной переменной: upsert одной строки (PK = определение);
   *  null — очистка (строка удаляется, DTO отдаёт null). */
  async putCompanyValue(
    definitionId: string,
    value: CustomFieldValue | null,
    actorId: string,
    tx: TransactionClient,
  ): Promise<void> {
    if (value === null) {
      await tx.companyValue.deleteMany({ where: { definitionId } });
      return;
    }
    await tx.companyValue.upsert({
      where: { definitionId },
      update: {
        value: value as Prisma.InputJsonValue,
        updatedById: actorId,
        updatedAt: new Date(),
      },
      create: { definitionId, value: value as Prisma.InputJsonValue, updatedById: actorId },
    });
  }

  /** Порядок атрибутов портала: sortOrder = индекс в `ids` (один UPDATE … FROM). */
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

  /** Advisory-лок реестра на транзакцию: имя, лимит и порядок сериализуются
   *  одним ключом на портал (Р1; прецедент #177/#195). */
  async lockRegistry(tx: TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(431, 0)`;
  }

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }
}
