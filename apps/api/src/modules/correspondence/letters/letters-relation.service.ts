import { Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  ErrorCode,
  type AuthUser,
  type LetterDetail,
  type LetterRelationCreateBody,
  type LetterRelationKind,
  type LetterRelationReason,
  type LetterTreeResponse,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { canRegisterLetters, canViewLetter } from '../access/letter-access.js';
import { LetterRelationsRepository } from './letter-relations.repository.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';
import { LettersTreeService } from './letters-tree.service.js';

/** Кап подъёма по цепочке при проверке цикла (защита от испорченных данных). */
const MAX_CYCLE_WALK = 64;

function relationFail(reason: LetterRelationReason): never {
  throw new DomainException(ErrorCode.LETTER_RELATION_INVALID, 'Letter relation is invalid', {
    field: 'relatedLetterId',
    reason,
  });
}

/**
 * Связи писем (#461, Р1/Р1а): «ответ на» и «вложено в» ставит, заменяет и
 * снимает только канцелярия (В2). Цель — живое зарегистрированное письмо,
 * видимое актору; цикл запрещён (подъём по обоим видам связей в транзакции
 * с блокировкой пары писем), самосвязь — тоже. Повтор той же цели —
 * идемпотентный успех; другая цель при существующей связи того вида — 422
 * `already_linked`, пока клиент не попросит `replace` (delete+insert одной
 * транзакцией, история — `replaced`). Снятие идемпотентно (204).
 */
@Injectable()
export class LettersRelationService {
  constructor(
    private readonly repo: LettersRepository,
    private readonly relations: LetterRelationsRepository,
    private readonly query: LettersQueryService,
    private readonly tree: LettersTreeService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
  ) {}

  treeOf(user: AuthUser, letterId: string): Promise<LetterTreeResponse> {
    return this.tree.tree(user, letterId);
  }

  async link(
    user: AuthUser,
    letterId: string,
    body: LetterRelationCreateBody,
  ): Promise<LetterDetail> {
    await this.query.visibleRow(user, letterId);
    if (!canRegisterLetters(user)) {
      throw DomainException.forbidden('Letter registration permission required');
    }
    const target = await this.targetOf(user, body.relatedLetterId);
    if (target.id === letterId) relationFail('cycle');

    await this.txRunner.run(async (tx) => {
      // Порядок блокировок — по id (deadlock-free): встречные связи A→B и
      // B→A сериализуются, вторая транзакция видит свежую цепочку.
      await this.relations.lockLetters(tx, [letterId, target.id]);
      if (await this.reaches(tx, target.id, letterId)) relationFail('cycle');
      const existing = await this.relations.relationOf(tx, letterId, body.kind);
      if (existing?.relatedLetterId === target.id) return;
      if (existing && !body.replace) relationFail('already_linked');
      const action = existing ? 'replaced' : 'linked';
      if (existing) await this.relations.replaceRelation(tx, existing.id, target.id);
      else {
        await this.relations.linkRelation(tx, {
          letterId,
          relatedLetterId: target.id,
          kind: body.kind,
          source: 'manual',
        });
      }
      await this.eventBus.emit(
        tx,
        CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED,
        { letterId, relatedLetterId: target.id, kind: body.kind, action },
        { actorId: user.id, aggregateType: 'letter', aggregateId: letterId },
      );
    });
    return this.query.detail(user, letterId);
  }

  /** Снятие связи: канцелярия, в том числе авто-связь (обещание #56 —
   *  ошибочную склейку можно убрать); несуществующая связь — тоже 204. */
  async unlink(user: AuthUser, letterId: string, relationId: string): Promise<void> {
    await this.query.visibleRow(user, letterId);
    if (!canRegisterLetters(user)) {
      throw DomainException.forbidden('Letter registration permission required');
    }
    await this.txRunner.run(async (tx) => {
      await this.relations.lockLetters(tx, [letterId]);
      const link = await this.relations.relationById(tx, letterId, relationId);
      if (!link) return;
      await this.relations.unlinkRelation(tx, relationId);
      await this.eventBus.emit(
        tx,
        CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED,
        {
          letterId,
          relatedLetterId: link.relatedLetterId,
          kind: link.kind as LetterRelationKind,
          action: 'unlinked',
        },
        { actorId: user.id, aggregateType: 'letter', aggregateId: letterId },
      );
    });
  }

  /** Цель связи: живое зарегистрированное письмо, видимое актору (поиск и
   *  так отдаёт только видимое — проверка дублирует правило). */
  private async targetOf(user: AuthUser, id: string) {
    const row = await this.repo.findDetailById(id);
    if (!row || row.deletedAt !== null) relationFail('not_found');
    const participants = row.confidential
      ? new Set((await this.repo.participants(id)).map((participant) => participant.userId))
      : undefined;
    if (!canViewLetter(user, row, participants)) relationFail('not_found');
    if (row.registeredAt === null) relationFail('not_registered');
    return row;
  }

  /** Достижим ли `targetId`, поднимаясь от `from` по родителям обоих видов:
   *  связь `targetId → … → letterId` замкнула бы круг. */
  private async reaches(tx: TransactionClient, from: string, targetId: string): Promise<boolean> {
    if (from === targetId) return true;
    const visited = new Set([from]);
    let frontier = [from];
    for (let step = 0; step < MAX_CYCLE_WALK && frontier.length > 0; step += 1) {
      const links = await this.relations.parentLinks(frontier, tx);
      const next: string[] = [];
      for (const link of links) {
        if (link.relatedLetterId === targetId) return true;
        if (visited.has(link.relatedLetterId)) continue;
        visited.add(link.relatedLetterId);
        next.push(link.relatedLetterId);
      }
      frontier = next;
    }
    return false;
  }
}
