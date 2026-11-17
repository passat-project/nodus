import { Injectable } from '@nestjs/common';
import { DIRECTORY_EVENTS, ErrorCode } from '@nodus/contracts';
import type {
  CreatePositionDto,
  OrgUnitKind,
  Position,
  ReassignPositionDto,
  UpdatePositionDto,
} from '@nodus/contracts';

import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { PositionsRepository } from './positions.repository.js';

/**
 * Должности: справочник (I15), удаление жёсткое (вердикт владельца 17.11.2026):
 * строка исчезает, имя снова свободно. Перед удалением (#768): на должности не
 * должно оставаться сотрудников — их переназначают на другую должность того же
 * вида. Переназначаются ВСЕ сотрудники, включая уволенных (вердикт 13.11.2026:
 * отдельного архива должностей у уволенных нет), поэтому висячих ссылок не
 * остаётся. Должность больше не источник решающего (#806).
 */
@Injectable()
export class PositionsService {
  constructor(
    private readonly positions: PositionsRepository,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
  ) {}

  list(kind: OrgUnitKind): Promise<Position[]> {
    return this.positions.findAllByKind(kind);
  }

  async create(dto: CreatePositionDto, actorId: string): Promise<Position> {
    return this.tx.run(async (tx) => {
      // Дубли по имени проверяем без учёта регистра (вердикт 13.11.2026):
      // раньше совпадение выходило системной ошибкой P2002 без объяснения.
      const same = await this.positions.findByName(dto.name, dto.kind, tx);
      if (same) {
        throw new DomainException(ErrorCode.DIRECTORY_POSITION_EXISTS, 'Position already exists', {
          positionId: same.id,
        });
      }
      const created = await this.positions.create(dto, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.POSITION_CREATED,
        { positionId: created.id, kind: created.kind },
        { actorId, aggregateType: 'position', aggregateId: created.id },
      );
      return created;
    });
  }

  async update(id: string, dto: UpdatePositionDto, actorId: string): Promise<Position> {
    const before = await this.positions.findById(id);
    if (!before) throw DomainException.notFound('Position not found');
    return this.tx.run(async (tx) => {
      if (dto.name !== undefined) {
        const same = await this.positions.findByName(dto.name, before.kind, tx);
        if (same && same.id !== id) {
          throw new DomainException(
            ErrorCode.DIRECTORY_POSITION_EXISTS,
            'Position already exists',
            { positionId: same.id },
          );
        }
      }
      const updated = await this.positions.update(id, dto, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.POSITION_UPDATED,
        { positionId: id, changedFields: Object.keys(dto) },
        { actorId, aggregateType: 'position', aggregateId: id },
      );
      return updated;
    });
  }

  /** Переназначение всех сотрудников должности, включая уволенных (#768). */
  async reassign(id: string, dto: ReassignPositionDto, actorId: string): Promise<void> {
    if (dto.targetId === id) this.failReference('targetId', 'self');
    const before = await this.positions.findById(id);
    if (!before) throw DomainException.notFound('Position not found');

    await this.tx.run(async (tx) => {
      // Один порядок захватов у source/target — встречные переназначения
      // (A→B и B→A) не дают дедлок.
      await this.positions.lockMany([id, dto.targetId], tx);
      const source = await this.positions.findById(id, tx);
      if (!source) throw DomainException.notFound('Position not found');
      const target = await this.positions.findById(dto.targetId, tx);
      if (!target) this.failReference('targetId', 'not_found');
      if (target.kind !== source.kind) this.failReference('targetId', 'kind_mismatch');

      const reassigned = await this.positions.reassignHolders(id, target.id, source.kind, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.POSITION_UPDATED,
        { positionId: id, changedFields: ['holders'], targetId: target.id, reassigned },
        { actorId, aggregateType: 'position', aggregateId: id },
      );
    });
  }

  /** Удаление жёсткое (вердикт 17.11.2026): сотрудников (включая уволенных)
   *  сначала переназначают, затем строка исчезает — имя снова свободно.
   *  Несуществующая строка — 404 (повторное удаление идемпотентностью не
   *  прикрываем: клиент должен увидеть, что должности уже нет). */
  async delete(id: string, actorId: string): Promise<void> {
    await this.tx.run(async (tx) => {
      if (!(await this.positions.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Position not found');
      }
      const locked = await this.positions.findById(id, tx);
      if (!locked) throw DomainException.notFound('Position not found');
      const holders = await this.positions.countHolders(id, locked.kind, tx);
      if (holders > 0) {
        throw new DomainException(ErrorCode.DIRECTORY_POSITION_IN_USE, 'Position has holders', {
          positionId: id,
          reason: 'holders',
          holders,
        });
      }
      await this.positions.remove(id, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.POSITION_DELETED,
        { positionId: id, kind: locked.kind },
        { actorId, aggregateType: 'position', aggregateId: id },
      );
    });
  }

  private failReference(field: string, reason: 'not_found' | 'kind_mismatch' | 'self'): never {
    throw new DomainException(
      ErrorCode.DIRECTORY_REFERENCE_INVALID,
      'Position reference is invalid',
      {
        field,
        reason,
      },
    );
  }
}
