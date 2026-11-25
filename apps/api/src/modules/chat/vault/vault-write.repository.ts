import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { extractMessageUrls } from '../messages/link-extractor.js';
import {
  emptyAttachmentDelta,
  emptyVaultDelta,
  vaultKindOf,
  type LinkMessageContext,
  type VaultAttachmentDelta,
  type VaultDelta,
} from './vault-kinds.js';

/**
 * Витрина беседы — ЗАПИСЬ (#211): проекция ссылок (message_links) и
 * денормализованные счётчики (conversation_vault_stats) — Δ-обслуживание в
 * тех же транзакциях состава (send/edit/delete/batch-delete/forward), tx
 * обязателен. Чтение — VaultRepository. Выделено из VaultRepository (I5).
 */
@Injectable()
export class VaultWriteRepository {
  // ===== Обслуживание проекции ссылок (те же транзакции, что и состав) =====

  /** Вставка ссылок нового сообщения + Δ link-счётчика. */
  async insertLinks(
    tx: TransactionClient,
    message: LinkMessageContext,
    urls: string[],
  ): Promise<number> {
    if (urls.length === 0) return 0;
    await tx.messageLink.createMany({
      data: urls.map((url, position) => ({
        messageId: message.id,
        conversationId: message.conversationId,
        threadRootId: message.threadRootId,
        position,
        url,
        authorId: message.authorId,
        createdAt: message.createdAt,
      })),
    });
    return urls.length;
  }

  /**
   * Правка текста: полная замена строк ссылок сообщения (позиции
   * пересчитываются), Δ = new − old. Возвращает Δ для stats.
   */
  async replaceLinks(
    tx: TransactionClient,
    message: LinkMessageContext,
    urls: string[],
  ): Promise<number> {
    const removed = await tx.messageLink.deleteMany({ where: { messageId: message.id } });
    const added = urls.length;
    if (added > 0) {
      await tx.messageLink.createMany({
        data: urls.map((url, position) => ({
          messageId: message.id,
          conversationId: message.conversationId,
          threadRootId: message.threadRootId,
          position,
          url,
          authorId: message.authorId,
          createdAt: message.createdAt,
        })),
      });
    }
    return added - removed.count;
  }

  /** Удаление сообщения: чистка строк ссылок, возвращает их число (Δ −). */
  async deleteLinksByMessage(tx: TransactionClient, messageId: string): Promise<number> {
    const removed = await tx.messageLink.deleteMany({ where: { messageId } });
    return removed.count;
  }

  // ===== Обслуживание счётчиков =====

  /**
   * Применение Δ к stats-строке беседы (атомарный upsert-инкремент;
   * statement-level — по одному UPDATE на операцию, не на строку: паттерн
   * PostgreSQL counter cache без row-триггеров). Нулевая Δ — no-op.
   */
  async applyDelta(
    tx: TransactionClient,
    conversationId: string,
    delta: VaultDelta,
  ): Promise<void> {
    if (
      delta.image === 0 &&
      delta.video === 0 &&
      delta.audio === 0 &&
      delta.document === 0 &&
      delta.link === 0
    )
      return;
    await tx.$executeRaw`
      INSERT INTO conversation_vault_stats
        (conversation_id, image_count, video_count, audio_count, document_count, link_count)
      VALUES (${conversationId}::uuid, ${delta.image}::int, ${delta.video}::int,
              ${delta.audio}::int, ${delta.document}::int, ${delta.link}::int)
      ON CONFLICT (conversation_id) DO UPDATE SET
        image_count = conversation_vault_stats.image_count + EXCLUDED.image_count,
        video_count = conversation_vault_stats.video_count + EXCLUDED.video_count,
        audio_count = conversation_vault_stats.audio_count + EXCLUDED.audio_count,
        document_count = conversation_vault_stats.document_count + EXCLUDED.document_count,
        link_count = conversation_vault_stats.link_count + EXCLUDED.link_count
    `;
  }

  /** Живые вложения сообщений по витринным категориям (mime-классификация),
   *  сгруппированные по сообщению (Δ копий forward, Δ удаления). */
  async attachmentKindsByMessages(
    tx: TransactionClient,
    messageIds: string[],
  ): Promise<Map<string, VaultAttachmentDelta>> {
    const result = new Map<string, VaultAttachmentDelta>();
    if (messageIds.length === 0) return result;
    const rows = await tx.$queryRaw<
      {
        message_id: string;
        image: bigint;
        video: bigint;
        audio: bigint;
        document: bigint;
      }[]
    >(Prisma.sql`
      SELECT message_id,
        COUNT(*) FILTER (WHERE kind = 'image') AS image,
        COUNT(*) FILTER (WHERE kind = 'video' OR (kind = 'file' AND mime LIKE 'video/%')) AS video,
        COUNT(*) FILTER (WHERE kind = 'file' AND mime LIKE 'audio/%') AS audio,
        COUNT(*) FILTER (WHERE kind = 'file'
          AND mime NOT LIKE 'video/%' AND mime NOT LIKE 'audio/%') AS document
      FROM message_attachments
      WHERE message_id = ANY(${messageIds}::uuid[]) AND kind IN ('image', 'video', 'file')
      GROUP BY message_id
    `);
    for (const row of rows) {
      result.set(row.message_id, {
        image: Number(row.image),
        video: Number(row.video),
        audio: Number(row.audio),
        document: Number(row.document),
      });
    }
    return result;
  }

  // ===== Операции жизненного цикла сообщения (вызовы из транзакций
  // send/edit/delete/forward — держат проекцию и счётчики консистентными) =====

  /** Отправка: строки ссылок нового текста + Δ по составу вложений. */
  async applyMessageSent(
    tx: TransactionClient,
    message: LinkMessageContext,
    attachments: readonly { kind: string; mime: string }[],
    text: string,
  ): Promise<void> {
    const delta = emptyVaultDelta();
    for (const attachment of attachments) {
      const kind = vaultKindOf(attachment.mime, attachment.kind);
      if (kind) delta[kind] += 1;
    }
    delta.link = await this.insertLinks(tx, message, extractMessageUrls(text));
    await this.applyDelta(tx, message.conversationId, delta);
  }

  /** Удаление (надгробие/бесследно): чистка ссылок + Δ по живому составу. */
  async applyMessageDeleted(
    tx: TransactionClient,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const removedLinks = await this.deleteLinksByMessage(tx, messageId);
    const kinds =
      (await this.attachmentKindsByMessages(tx, [messageId])).get(messageId) ??
      emptyAttachmentDelta();
    await this.applyDelta(tx, conversationId, {
      image: -kinds.image,
      video: -kinds.video,
      audio: -kinds.audio,
      document: -kinds.document,
      link: -removedLinks,
    });
  }

  /** Правка: замена строк ссылок (при смене текста) + Δ состава вложений. */
  async applyMessageEdited(
    tx: TransactionClient,
    message: LinkMessageContext & { text: string },
    body: { text: string },
    change: { changed: boolean; delta: VaultAttachmentDelta },
  ): Promise<void> {
    const textChanged = message.text !== body.text;
    const linkDelta = textChanged
      ? await this.replaceLinks(tx, message, extractMessageUrls(body.text))
      : 0;
    await this.applyDelta(tx, message.conversationId, { ...change.delta, link: linkDelta });
  }

  /** Пересылка: копии несут текст (ссылки — в проекцию) и категории вложений
   *  оригиналов (комментарий-строка — без sourceId, только её ссылки). */
  async applyForwardCopies(
    tx: TransactionClient,
    conversationId: string,
    copies: readonly { message: LinkMessageContext; text: string; sourceId?: string }[],
  ): Promise<void> {
    const sourceKinds = await this.attachmentKindsByMessages(
      tx,
      copies.flatMap((copy) => (copy.sourceId ? [copy.sourceId] : [])),
    );
    const delta = emptyVaultDelta();
    for (const copy of copies) {
      const kinds = copy.sourceId ? sourceKinds.get(copy.sourceId) : undefined;
      if (kinds) {
        delta.image += kinds.image;
        delta.video += kinds.video;
        delta.audio += kinds.audio;
        delta.document += kinds.document;
      }
      delta.link += await this.insertLinks(tx, copy.message, extractMessageUrls(copy.text));
    }
    await this.applyDelta(tx, conversationId, delta);
  }
}
