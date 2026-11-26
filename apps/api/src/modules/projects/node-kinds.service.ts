import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  PROJECT_EVENTS,
  normalizeNodeKindCapabilities,
  type NodeKind,
  type NodeKindCreateBody,
  type NodeKindForm,
  type NodeKindUpdateBody,
  formSlots,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';

/**
 * Справочник видов папок (#556, Р7): логика создания/правки/архивации —
 * здесь, контроллер тонкий (аудит и OpenAPI). Все мутации — в транзакции под
 * advisory-локом `nodus:node_kinds`: уникальность имени и
 * чтение-изменение-запись конфигурации сериализуются; событие
 * `project.node_kind_changed` — outbox в той же транзакции (I9, Р10).
 *
 * Форма вида проверяется по реестру атрибутов портала (Р3): слот —
 * существующее определение, не глобальная переменная. Слот задаёт видимость;
 * привязка «атрибут × вид» синхронизируется формой (`syncPlaceBindings`).
 */
@Injectable()
export class NodeKindsService {
  constructor(
    private readonly kinds: NodeKindsRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
  ) {}

  list(): Promise<NodeKind[]> {
    return this.kinds.list();
  }

  async create(dto: NodeKindCreateBody, actorId: string): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      // Основа копии (#857): только живой вид — как у типов процессов
      // (архивный сначала восстанавливают, 404 без спецкода).
      const source = dto.base?.kind === 'copy' ? await this.liveBase(tx, dto.base.kindId) : null;
      if (source) {
        // Реестр атрибутов → формы видов (#646): копия пишет слоты основы в
        // привязки — лок как при правке формы.
        await this.registry.lockRegistry(tx);
      }
      await this.kinds.lockForms(tx);
      if (await this.kinds.nameTaken(dto.name, null, tx)) throw nameTaken(dto.name);
      if (source) await this.assertForm(tx, source.form);
      const created = await this.kinds.create(tx, {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        // Копия работает как оригинал: форма и возможности едут вместе
        // (#857); возможности уже нормализованы чтением DTO.
        ...(source
          ? {
              config: {
                form: structuredClone(source.form),
                capabilities: [...source.capabilities],
              },
            }
          : {}),
      });
      if (source) {
        const slots = formSlots(source.form).map((slot) => slot.fieldId);
        await this.registry.syncPlaceBindings({ kind: 'node_kind', id: created.id }, slots, [], tx);
      }
      await this.emit(
        tx,
        created.id,
        'created',
        source ? ['name', 'icon', 'color', 'form', 'capabilities'] : ['name', 'icon', 'color'],
        actorId,
      );
      return created;
    });
  }

  async update(id: string, dto: NodeKindUpdateBody, actorId: string): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      // Реестр атрибутов → формы видов (#646): удаление определения между
      // проверкой формы и записью привязок иначе даёт P2003 → 400.
      await this.registry.lockRegistry(tx);
      await this.kinds.lockForms(tx);
      const current = await this.kinds.findById(id, tx);
      if (!current) throw DomainException.notFound('Node kind not found');
      if (dto.name !== undefined && (await this.kinds.nameTaken(dto.name, id, tx))) {
        throw nameTaken(dto.name);
      }
      if (dto.form !== undefined) {
        await this.assertForm(tx, dto.form);
        // Слот — привязка (Р3): добавленный слот привязывает, снятый —
        // снимает; привязки без слотов (посев/диалог) не трогаются (#646).
        const previous = formSlots(current.form).map((slot) => slot.fieldId);
        const next = formSlots(dto.form).map((slot) => slot.fieldId);
        await this.registry.syncPlaceBindings(
          { kind: 'node_kind', id },
          next,
          previous.filter((fieldId) => !next.includes(fieldId)),
          tx,
        );
      }

      const updated = await this.kinds.update(tx, id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.form !== undefined || dto.capabilities !== undefined
          ? {
              config: {
                form: dto.form ?? current.form,
                capabilities:
                  dto.capabilities !== undefined
                    ? normalizeNodeKindCapabilities(dto.capabilities)
                    : current.capabilities,
              },
            }
          : {}),
      });
      if (!updated) throw DomainException.notFound('Node kind not found');
      await this.emit(tx, id, 'updated', Object.keys(dto), actorId);
      return updated;
    });
  }

  async archive(id: string, actorId: string): Promise<NodeKind> {
    return this.setArchived(id, true, actorId);
  }

  async restore(id: string, actorId: string): Promise<NodeKind> {
    return this.setArchived(id, false, actorId);
  }

  private async setArchived(id: string, archived: boolean, actorId: string): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      await this.kinds.lockForms(tx);
      const updated = await this.kinds.setArchived(tx, id, archived);
      if (!updated) throw DomainException.notFound('Node kind not found');
      await this.emit(tx, id, archived ? 'archived' : 'restored', ['archivedAt'], actorId);
      return updated;
    });
  }

  /** Основа копии (#857): живой вид; отсутствующий или архивный — 404
   *  (зеркало `copyBase` типов процессов). */
  private async liveBase(tx: TransactionClient, kindId: string): Promise<NodeKind> {
    const base = await this.kinds.findById(kindId, tx);
    if (!base || base.archivedAt) throw DomainException.notFound('Base node kind not found');
    return base;
  }

  /** Слоты формы — существующие определения (глобального hidden нет, О2
   *  #631: видимость регулирует слот). Слот создаёт привязку, но привязка
   *  без слота законна — форма синхронизирует только дельту слотов (Р3). */
  private async assertForm(tx: TransactionClient, form: NodeKindForm): Promise<void> {
    const definitions = await this.registry.definitions({}, tx);
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const issues: { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] = [];
    for (const slot of formSlots(form)) {
      const definition = byId.get(slot.fieldId);
      if (!definition) issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
      else if (definition.isCompany) {
        issues.push({ fieldId: slot.fieldId, reason: 'not_bindable' });
      }
    }
    if (issues.length > 0) {
      throw new DomainException(
        ErrorCode.PROJECT_NODE_KIND_FORM_INVALID,
        'Node kind form is invalid',
        { fieldIds: issues, reason: issues[0]!.reason },
      );
    }
  }

  private async emit(
    tx: TransactionClient,
    kindId: string,
    change: 'created' | 'updated' | 'archived' | 'restored',
    fields: string[],
    actorId: string,
  ): Promise<void> {
    await this.eventBus.emit(
      tx,
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId, change, fields },
      { actorId, aggregateType: 'node_kind', aggregateId: kindId },
    );
  }
}

function nameTaken(name: string): DomainException {
  return new DomainException(
    ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN,
    'Node kind name is already taken',
    { name },
  );
}
