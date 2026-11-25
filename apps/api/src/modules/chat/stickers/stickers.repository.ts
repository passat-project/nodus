import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/** Строка пака (сырой ряд, camelCase). */
export interface StickerPackRow {
  id: string;
  title: string;
  scope: string;
  ownerId: string | null;
  createdBy: string;
  createdAt: Date;
}

/** Строка стикера (сырой ряд, camelCase). */
export interface StickerRow {
  id: string;
  packId: string;
  fileId: string;
  emojis: string[];
  width: number | null;
  height: number | null;
  mime: string;
  size: number;
  sortOrder: number;
}

/** Стикер с паком (include pack; Prisma возвращает плоско). */
export type StickerWithPackRow = StickerRow & { pack: StickerPackRow };

/** Вложение-стикер сообщения (форма для маппера DTO). */
export interface StickerAttachmentRow {
  id: string;
  fileId: string;
  ownerId: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  width: number | null;
  height: number | null;
  /** Длительность видео, мс (#250): у стикеров всегда null. */
  durationMs: number | null;
  thumbFileId: string | null;
  /** Снапшот {packId, packTitle, packScope, emojis} (JSONB, #143). */
  stickerMeta: unknown;
}

const packInclude = {
  stickers: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
} satisfies Prisma.StickerPackInclude;

type PackWithStickers = Prisma.StickerPackGetPayload<{ include: typeof packInclude }>;

/**
 * Репозиторий стикер-паков (#143): таблицы sticker_packs / stickers /
 * user_sticker_packs — только через этот модуль (I3/I6). fileId — plain UUID
 * на файлы модуля files (как MessageAttachment, без FK). Отправка читает
 * стикер тем же репозиторием в транзакции messages.service.send.
 */
@Injectable()
export class StickersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /** Паки, видимые пользователю: корпоративные + свои + установленные. */
  async listVisible(
    userId: string,
  ): Promise<{ packs: PackWithStickers[]; installedIds: Set<string> }> {
    const installs = await this.prisma.userStickerPack.findMany({
      where: { userId },
      select: { packId: true },
    });
    const installedIds = new Set(installs.map((row) => row.packId));
    const packs = await this.prisma.stickerPack.findMany({
      where: {
        deletedAt: null,
        OR: [{ scope: 'corporate' }, { ownerId: userId }, { id: { in: [...installedIds] } }],
      },
      include: packInclude,
      orderBy: [{ scope: 'desc' }, { createdAt: 'asc' }], // корпоративные первыми
    });
    return { packs, installedIds };
  }

  /** Пак по id (не удалённый) со стикерами; поповер из чата — пак может быть
   *  любым (дистрибуция «из чата»), секретности нет. */
  findPack(id: string, tx?: TransactionClient): Promise<PackWithStickers | null> {
    return this.client(tx).stickerPack.findFirst({
      where: { id, deletedAt: null },
      include: packInclude,
    });
  }

  /** Пак, доступный отправителю (доступ = корпоративный | владеет | установлен). */
  findPackAccessible(
    id: string,
    userId: string,
    tx?: TransactionClient,
  ): Promise<PackWithStickers | null> {
    return this.client(tx).stickerPack.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { scope: 'corporate' },
          { ownerId: userId },
          { installedByUsers: { some: { userId } } },
        ],
      },
      include: packInclude,
    });
  }

  /** Установлен ли пак пользователю (деталь окна — футер/меню по installed). */
  async isInstalled(userId: string, packId: string): Promise<boolean> {
    const row = await this.prisma.userStickerPack.findUnique({
      where: { userId_packId: { userId, packId } },
      select: { userId: true },
    });
    return row !== null;
  }

  /** Живые личные паки пользователя (лимит 20 — спека #143). */
  countPersonalPacks(ownerId: string, tx?: TransactionClient): Promise<number> {
    return this.client(tx).stickerPack.count({
      where: { ownerId, scope: 'personal', deletedAt: null },
    });
  }

  /** Сериализация лимита личных паков ОДНОГО владельца (паттерн
   *  lockUrgentLimit #177): без лока два параллельных create на границе
   *  лимита оба проходят count (TOCTOU). Advisory-лок до конца tx. */
  async lockPersonalPackLimit(ownerId: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(143, hashtext(${ownerId}::text))
    `);
  }

  /** Блокировка строки пака (только внутри tx): сериализует параллельные
   *  загрузки в один пак — перечёт лимита стикеров под локом точен. */
  async lockPack(packId: string, tx: TransactionClient): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM sticker_packs WHERE id = ${packId}::uuid FOR UPDATE
    `);
  }

  createPack(
    row: {
      id: string;
      title: string;
      scope: string;
      ownerId: string | null;
      createdBy: string;
    },
    tx?: TransactionClient,
  ): Promise<StickerPackRow> {
    return this.client(tx).stickerPack.create({ data: row });
  }

  async renamePack(id: string, title: string, tx?: TransactionClient): Promise<void> {
    await this.client(tx).stickerPack.update({ where: { id }, data: { title } });
  }

  async softDeletePack(id: string, tx?: TransactionClient): Promise<void> {
    await this.client(tx).stickerPack.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  countStickers(packId: string, tx?: TransactionClient): Promise<number> {
    return this.client(tx).sticker.count({ where: { packId } });
  }

  insertSticker(
    row: {
      id: string;
      packId: string;
      fileId: string;
      emojis: string[];
      width: number | null;
      height: number | null;
      mime: string;
      size: number;
      sortOrder: number;
    },
    tx?: TransactionClient,
  ): Promise<StickerRow> {
    return this.client(tx).sticker.create({ data: row });
  }

  /** Стикер + пак для удаления из пака / отправки. */
  findSticker(stickerId: string, tx?: TransactionClient): Promise<StickerWithPackRow | null> {
    return this.client(tx).sticker.findFirst({
      where: { id: stickerId, pack: { deletedAt: null } },
      include: { pack: true },
    });
  }

  async deleteSticker(stickerId: string, tx?: TransactionClient): Promise<void> {
    await this.client(tx).sticker.delete({ where: { id: stickerId } });
  }

  /** Установить пак «себе» — идемпотентно (PK); false — уже стоял. */
  async install(userId: string, packId: string, tx?: TransactionClient): Promise<boolean> {
    const result = await this.client(tx).userStickerPack.createMany({
      data: { userId, packId },
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  /** Кто установил пак «себе» — адресаты живых событий личного пака (#318). */
  async listInstallerIds(packId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await this.client(tx).userStickerPack.findMany({
      where: { packId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /** Снять пак «у себя»; false — не был установлен. */
  async uninstall(userId: string, packId: string, tx?: TransactionClient): Promise<boolean> {
    const result = await this.client(tx).userStickerPack.deleteMany({
      where: { userId, packId },
    });
    return result.count > 0;
  }

  /** Вложение kind='sticker' для сообщения (снапшот пака, #143): пишется в
   *  транзакции отправки рядом с сообщением — как claimAttachments, но без
   *  предварительной загрузки (стикер многократно переиспользуем). */
  insertAttachmentForMessage(
    messageId: string,
    ownerId: string,
    sticker: StickerRow,
    pack: Pick<StickerPackRow, 'id' | 'title' | 'scope'>,
    tx: TransactionClient,
  ): Promise<StickerAttachmentRow> {
    const ext = sticker.mime.split('/')[1] ?? 'png';
    return tx.messageAttachment.create({
      data: {
        id: crypto.randomUUID(),
        messageId,
        fileId: sticker.fileId,
        ownerId,
        name: `sticker.${ext}`,
        size: sticker.size,
        mime: sticker.mime,
        kind: 'sticker',
        width: sticker.width,
        height: sticker.height,
        stickerMeta: {
          packId: pack.id,
          packTitle: pack.title,
          packScope: pack.scope,
          emojis: sticker.emojis,
        },
      },
      select: {
        id: true,
        fileId: true,
        ownerId: true,
        name: true,
        size: true,
        mime: true,
        kind: true,
        width: true,
        height: true,
        durationMs: true,
        thumbFileId: true,
        stickerMeta: true,
      },
    });
  }
}
