import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  normalizeNodeKindConfig,
  type NodeKind,
  type NodeKindConfig,
  type NodeKindIcon,
  type ProjectColor,
} from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const kindSelect = {
  id: true,
  name: true,
  icon: true,
  color: true,
  config: true,
  archivedAt: true,
} as const;
type KindRow = {
  id: string;
  name: string;
  icon: string;
  color: string;
  config: unknown;
  archivedAt: Date | null;
};

export interface NodeKindPatch {
  name?: string;
  icon?: string;
  color?: string;
  /** Конфигурация целиком: разделы заменяются вместе (Р2). */
  config?: NodeKindConfig;
}

/**
 * Таблица `node_kinds` — виды папок структуры (#467, #556): ярлык (значок +
 * цвет) и конфигурация вида (форма создания + возможности). Справочник
 * «Автоматизации»: чтение — всем, правка — project.setup.manage (гвард
 * контроллера); удаление = архивация. Уникальность имени
 * lower(btrim(name)) — выраженный индекс в миграции, проверка здесь raw-SQL
 * (Prisma выражения не декларирует, канон projects_code_key).
 *
 * Конфигурация — закрытая zod-схема контрактов: чтение толерантное
 * (`normalizeNodeKindConfig`: `{}` и битые разделы → умолчания), запись —
 * целыми разделами. Все мутации идут под advisory-локом `nodus:node_kinds`
 * (`lockForms`): чтение-изменение-запись `config` и уникальность имени
 * сериализуются (Р7).
 */
@Injectable()
export class NodeKindsRepository {
  constructor(private readonly prisma: PrismaService) {}

  toDto(row: KindRow): NodeKind {
    const config = normalizeNodeKindConfig(row.config);
    return {
      id: row.id,
      name: row.name,
      icon: row.icon as NodeKindIcon,
      color: row.color as ProjectColor,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      form: config.form,
      capabilities: config.capabilities,
    };
  }

  /** Все виды: живые по имени, архивные в конце (подсказка окна создания). */
  async list(): Promise<NodeKind[]> {
    const rows = await this.prisma.nodeKind.findMany({
      select: kindSelect,
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async findById(id: string, tx?: TransactionClient): Promise<NodeKind | null> {
    const row = await (tx ?? this.prisma).nodeKind.findUnique({
      select: kindSelect,
      where: { id },
    });
    return row ? this.toDto(row) : null;
  }

  async findActive(id: string): Promise<NodeKind | null> {
    const row = await this.prisma.nodeKind.findFirst({
      select: kindSelect,
      where: { id, archivedAt: null },
    });
    return row ? this.toDto(row) : null;
  }

  /** Живой вид с блокировкой строки до конца транзакции (`FOR SHARE`):
   *  создание папки и смена вида не разойдутся с параллельной архивацией
   *  вида — архив ждёт коммита, а не наоборот (узкая гонка Р7). */
  async findActiveForShare(tx: TransactionClient, id: string): Promise<NodeKind | null> {
    const rows = await tx.$queryRaw<KindRow[]>(Prisma.sql`
      SELECT id, name, icon, color, config, archived_at AS "archivedAt"
      FROM node_kinds
      WHERE id = ${id}::uuid AND archived_at IS NULL
      FOR SHARE
    `);
    return rows[0] ? this.toDto(rows[0]) : null;
  }

  /** Живые виды по id (валидация подсказки типа проекта). */
  async activeByIds(ids: readonly string[]): Promise<NodeKind[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.nodeKind.findMany({
      select: kindSelect,
      where: { id: { in: [...ids] }, archivedAt: null },
    });
    return rows.map((row) => this.toDto(row));
  }

  /** Имя занято без учёта регистра и краёв (зеркало уникального индекса). */
  async nameTaken(
    name: string,
    excludeId: string | null,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const rows = await (tx ?? this.prisma).$queryRaw<{ id: string }[]>`
      SELECT id FROM node_kinds
      WHERE lower(btrim(name)) = lower(btrim(${name}))
        AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
      LIMIT 1`;
    return rows.length > 0;
  }

  async create(
    tx: TransactionClient,
    data: { name: string; icon: string; color: string },
  ): Promise<NodeKind> {
    const row = await tx.nodeKind.create({
      select: kindSelect,
      data: { id: randomUUID(), ...data },
    });
    return this.toDto(row);
  }

  async update(tx: TransactionClient, id: string, patch: NodeKindPatch): Promise<NodeKind | null> {
    const data: Prisma.NodeKindUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.config !== undefined) data.config = patch.config as Prisma.InputJsonValue;
    const updated = await tx.nodeKind.updateMany({ where: { id }, data });
    if (updated.count === 0) return null;
    const row = await tx.nodeKind.findUnique({ select: kindSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async setArchived(
    tx: TransactionClient,
    id: string,
    archived: boolean,
  ): Promise<NodeKind | null> {
    const updated = await tx.nodeKind.updateMany({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (updated.count === 0) return null;
    const row = await tx.nodeKind.findUnique({ select: kindSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  /** Advisory-лок справочника видов на транзакцию (Р7): имя и форма
   *  сериализуются между собой и с обработчиком удаления атрибута. */
  async lockForms(tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('nodus:node_kinds'))`);
  }

  /** Убрать атрибут из форм всех видов (удаление определения, Р11):
   *  идемпотентно, возвращает изменённые виды для события. */
  async removeFieldFromForms(
    tx: TransactionClient,
    fieldId: string,
  ): Promise<{ id: string; name: string }[]> {
    return tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
      UPDATE node_kinds
      SET config = jsonb_set(
              config,
              '{form,fields}',
              COALESCE((
                SELECT jsonb_agg(slot)
                FROM jsonb_array_elements(config->'form'->'fields') AS slot
                WHERE slot->>'fieldId' <> ${fieldId}
              ), '[]'::jsonb)
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE config->'form'->'fields' @> jsonb_build_array(jsonb_build_object('fieldId', ${fieldId}::text))
      RETURNING id, name
    `);
  }
}
