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
 * Должности: справочник (I15), удаление — обратимая деактивация строки.
 * Перед удалением (#768): на должности не должно быть сотрудников — их сначала
 * переназначают на другую должность того же вида. Переназначаются ВСЕ
 * сотрудники, включая уволенных (вердикт 13.11.2026: отдельного архива
 * должностей у уволенных нет). Должность больше не источник решающего (#806) —
 * предохранитель маршрутов снят.
 */
@Injectable()
export class PositionsService {
  constructor(
    private readonly positions: PositionsRepository,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
  ) {}

  list(kind: OrgUnitKind, includeArchived = false): Promise<Position[]> {
    return this.positions.findAllByKind(kind, includeArchived);
  }

  async create(dto: CreatePositionDto, actorId: string): Promise<Position> {
    return this.tx.run(async (tx) => {
      // Дубли по имени проверяем без учёта регистра (вердикт 13.11.2026):
      // раньше совпадение выходило системной ошибкой P2002 без объяснения.
      const same = await this.positions.findByName(dto.name, dto.kind, tx);
      if (same?.isActive) {
        throw new DomainException(ErrorCode.DIRECTORY_POSITION_EXISTS, 'Position already exists', {
          positionId: same.id,
        });
      }
      if (same) {
        // Ранее удалённая (невидимая) строка с тем же именем — восстанавливаем:
        // отдельного «архива» в интерфейсе нет, дубль имени невозможен (unique).
        const restored = await this.positions.update(same.id, { isActive: true }, tx);
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.POSITION_UPDATED,
          { positionId: same.id, changedFields: ['isActive'] },
          { actorId, aggregateType: 'position', aggregateId: same.id },
        );
        return restored;
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
    const before = await this.positions.findById(id);
    if (!before) throw DomainException.notFound('Position not found');
    if (!before.isActive) throw DomainException.notFound('Position not found');
    if (dto.targetId === id) this.failReference('targetId', 'self');

    await this.tx.run(async (tx) => {
      // Один порядок захватов у source/target — встречные переназначения
      // (A→B и B→A) не дают дедлок.
      await this.positions.lockMany([id, dto.targetId], tx);
      const source = await this.positions.findById(id, tx);
      if (!source || !source.isActive) throw DomainException.notFound('Position not found');
      const target = await this.positions.findById(dto.targetId, tx);
      if (!target) this.failReference('targetId', 'not_found');
      if (!target.isActive) this.failReference('targetId', 'inactive');
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

  /** Удаление (деактивация, I15): сотрудники (включая уволенных) → строка
   *  исчезает из справочника. Маршруты должность больше не используют (#806). */
  async delete(id: string, actorId: string): Promise<void> {
    const position = await this.positions.findById(id);
    if (!position) throw DomainException.notFound('Position not found');
    if (!position.isActive) return; // повторное удаление — идемпотентно

    await this.tx.run(async (tx) => {
      if (!(await this.positions.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Position not found');
      }
      const locked = (await this.positions.findById(id, tx)) ?? position;
      if (!locked.isActive) return;
      const holders = await this.positions.countHolders(id, locked.kind, tx);
      if (holders > 0) {
        throw new DomainException(ErrorCode.DIRECTORY_POSITION_IN_USE, 'Position has holders', {
          positionId: id,
          reason: 'holders',
          holders,
        });
      }
      await this.positions.update(id, { isActive: false }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.POSITION_ARCHIVED,
        { positionId: id },
        { actorId, aggregateType: 'position', aggregateId: id },
      );
    });
  }

  private failReference(
    field: string,
    reason: 'not_found' | 'inactive' | 'kind_mismatch' | 'self',
  ): never {
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
