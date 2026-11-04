import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CRM_EVENTS,
  ErrorCode,
  type AuthUser,
  type CounterpartyBulkAction,
  type CounterpartyBulkResult,
  type CounterpartyCard,
  type CreateCounterpartyBody,
  type UpdateCounterpartyBody,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { CounterpartiesQueryService } from './counterparties-query.service.js';
import {
  CounterpartiesRepository,
  type CounterpartyRow,
  type CounterpartyWriteData,
} from './counterparties.repository.js';

/** Нарушение уникального индекса (УНП) — Prisma P2002. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

function unpTaken(row: CounterpartyRow): DomainException {
  return new DomainException(ErrorCode.CRM_UNP_TAKEN, 'Counterparty with this UNP already exists', {
    counterpartyId: row.id,
    shortName: row.shortName,
    archived: row.archivedAt !== null,
  });
}

function archivedConflict(id: string): DomainException {
  return new DomainException(ErrorCode.CRM_COUNTERPARTY_ARCHIVED, 'Counterparty is archived', {
    counterpartyId: id,
  });
}

/** Поля, которые вообще можно править (белый список контракта). */
function writeDataOf(dto: UpdateCounterpartyBody): Partial<CounterpartyWriteData> {
  const data: Partial<CounterpartyWriteData> = {};
  if (dto.fullName !== undefined) data.fullName = dto.fullName;
  if (dto.shortName !== undefined) data.shortName = dto.shortName;
  if (dto.unp !== undefined) data.unp = dto.unp;
  if (dto.address !== undefined) data.address = dto.address;
  if (dto.email !== undefined) data.email = dto.email;
  if (dto.phone !== undefined) data.phone = dto.phone;
  return data;
}

/**
 * Мутации справочника контрагентов: создание (в т.ч. «на лету»), правка
 * реквизитов, архив и возврат. Каждая — транзакция + outbox-событие (I9);
 * аудит — контроллером (@Audit). Удаления нет — архивация (ADR-0033).
 */
@Injectable()
export class CounterpartiesService {
  constructor(
    private readonly counterparties: CounterpartiesRepository,
    private readonly queries: CounterpartiesQueryService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CounterpartiesService.name);
  }

  async create(dto: CreateCounterpartyBody, actor: AuthUser): Promise<CounterpartyCard> {
    const data: CounterpartyWriteData = {
      shortName: dto.shortName,
      fullName: dto.fullName,
      unp: dto.unp ?? null,
      address: dto.address ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
    };
    if (data.unp) await this.assertUnpFree(data.unp);
    try {
      return await this.txRunner.run(async (tx) => {
        const created = await this.counterparties.create(data, tx);
        await this.eventBus.emit(
          tx,
          CRM_EVENTS.COUNTERPARTY_CREATED,
          { counterpartyId: created.id, shortName: created.shortName, unp: created.unp },
          { actorId: actor.id, aggregateType: 'counterparty', aggregateId: created.id },
        );
        return this.queries.buildCard(created, tx, actor);
      });
    } catch (error) {
      // Гонка двух созданий с одним УНП: unique-индекс откатил транзакцию —
      // перечитываем победителя и отдаём тот же доменный конфликт.
      if (isUniqueViolation(error) && data.unp) await this.assertUnpFree(data.unp);
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCounterpartyBody,
    actor: AuthUser,
  ): Promise<CounterpartyCard> {
    const before = await this.counterparties.findById(id);
    if (!before) throw DomainException.notFound('Counterparty not found');
    if (before.archivedAt) throw archivedConflict(id);

    const candidate = writeDataOf(dto);
    const changed = Object.entries(candidate).filter(
      ([field, value]) => before[field as keyof CounterpartyRow] !== value,
    );
    if (changed.length === 0) return this.queries.buildCard(before, undefined, actor);

    if (candidate.unp) {
      const taken = await this.counterparties.findByUnp(candidate.unp);
      if (taken && taken.id !== id) throw unpTaken(taken);
    }
    try {
      return await this.txRunner.run(async (tx) => {
        const updated = await this.counterparties.update(
          id,
          Object.fromEntries(changed) as Partial<CounterpartyWriteData>,
          tx,
        );
        await this.eventBus.emit(
          tx,
          CRM_EVENTS.COUNTERPARTY_UPDATED,
          { counterpartyId: id, fields: changed.map(([field]) => field) },
          { actorId: actor.id, aggregateType: 'counterparty', aggregateId: id },
        );
        return this.queries.buildCard(updated, tx, actor);
      });
    } catch (error) {
      if (isUniqueViolation(error) && candidate.unp) {
        const taken = await this.counterparties.findByUnp(candidate.unp);
        if (taken) throw unpTaken(taken);
      }
      throw error;
    }
  }

  /** Архив (`archived: true`) и возврат (`false`) — идемпотентно. */
  async setArchived(id: string, archived: boolean, actor: AuthUser): Promise<CounterpartyCard> {
    const before = await this.counterparties.findById(id);
    if (!before) throw DomainException.notFound('Counterparty not found');
    if ((before.archivedAt !== null) === archived) {
      return this.queries.buildCard(before, undefined, actor);
    }

    return this.txRunner.run(async (tx) => {
      const updated = await this.counterparties.setArchivedAt(id, archived ? new Date() : null, tx);
      await this.eventBus.emit(
        tx,
        archived ? CRM_EVENTS.COUNTERPARTY_ARCHIVED : CRM_EVENTS.COUNTERPARTY_RESTORED,
        { counterpartyId: id },
        { actorId: actor.id, aggregateType: 'counterparty', aggregateId: id },
      );
      return this.queries.buildCard(updated, tx, actor);
    });
  }

  /**
   * Удаление записи (вердикт владельца 25.10.2026): разрешено ТОЛЬКО без
   * связей — если на контрагента ссылаются письма или проекты, история
   * должна сохраниться, и ответ 409 `CRM_COUNTERPARTY_IN_USE` ведёт к архиву.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const before = await this.counterparties.findById(id);
    if (!before) throw DomainException.notFound('Counterparty not found');
    if (await this.counterparties.hasUsages(id)) {
      throw new DomainException(
        ErrorCode.CRM_COUNTERPARTY_IN_USE,
        'Counterparty is referenced by letters or projects',
        { counterpartyId: id },
      );
    }
    try {
      await this.txRunner.run(async (tx) => {
        await this.counterparties.deleteWithContacts(id, tx);
        await this.eventBus.emit(
          tx,
          CRM_EVENTS.COUNTERPARTY_DELETED,
          { counterpartyId: id, shortName: before.shortName },
          { actorId, aggregateType: 'counterparty', aggregateId: id },
        );
      });
    } catch (error) {
      // Гонка с проекциями связей (#55/#52): связь появилась между проверкой
      // `hasUsages` и удалением — FK ON DELETE RESTRICT вернёт P2003. Отвечаем
      // тем же 409 «есть связи, переносите в архив», а не 400/500.
      if ((error as { code?: string }).code === 'P2003') {
        throw new DomainException(
          ErrorCode.CRM_COUNTERPARTY_IN_USE,
          'Counterparty is referenced by letters or projects',
          { counterpartyId: id },
        );
      }
      throw error;
    }
  }

  /**
   * Массовые операции (до 100 записей): каждая — через тот же `setArchived`
   * (права и существование проверяются индивидуально, архив идемпотентен).
   * Частичный успех — норма, ответ по записи.
   */
  async bulk(
    ids: readonly string[],
    action: CounterpartyBulkAction,
    actor: AuthUser,
  ): Promise<CounterpartyBulkResult> {
    const results: CounterpartyBulkResult['results'] = [];
    for (const id of new Set(ids)) {
      try {
        if (action.kind === 'delete') await this.remove(id, actor.id);
        else await this.setArchived(id, action.kind === 'archive', actor);
        results.push({ counterpartyId: id, ok: true });
      } catch (error) {
        if (!(error instanceof DomainException)) {
          // Не-доменный сбой (БД и пр.) — в лог без PII, наружу только код.
          this.logger.error({ err: error, counterpartyId: id }, 'Bulk counterparty action failed');
        }
        const code = error instanceof DomainException ? error.code : ErrorCode.INTERNAL_ERROR;
        results.push({ counterpartyId: id, ok: false, code });
      }
    }
    return { results };
  }

  private async assertUnpFree(unp: string): Promise<void> {
    const existing = await this.counterparties.findByUnp(unp);
    if (existing) throw unpTaken(existing);
  }
}
