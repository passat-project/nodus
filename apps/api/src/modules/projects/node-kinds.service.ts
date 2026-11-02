import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  PROJECT_EVENTS,
  normalizeNodeKindCapabilities,
  type NodeKind,
  type NodeKindCreateBody,
  type NodeKindForm,
  type NodeKindUpdateBody,
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
 * Форма вида проверяется по реестру атрибутов области `node` (Р3): слот —
 * существующее определение; скрытое в «Атрибутах» определение допустимо
 * только в состоянии `hidden` и только для нового слота или смены состояния
 * (иначе скрытие атрибута заблокировало бы любую правку формы).
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
      await this.kinds.lockForms(tx);
      if (await this.kinds.nameTaken(dto.name, null, tx)) throw nameTaken(dto.name);
      const created = await this.kinds.create(tx, dto);
      await this.emit(tx, created.id, 'created', ['name', 'icon', 'color'], actorId);
      return created;
    });
  }

  async update(id: string, dto: NodeKindUpdateBody, actorId: string): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      await this.kinds.lockForms(tx);
      const current = await this.kinds.findById(id, tx);
      if (!current) throw DomainException.notFound('Node kind not found');
      if (dto.name !== undefined && (await this.kinds.nameTaken(dto.name, id, tx))) {
        throw nameTaken(dto.name);
      }
      if (dto.form !== undefined) await this.assertForm(tx, dto.form, current.form);

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

  /** Слоты формы — определения области `node`; скрытые — по правилу Р7. */
  private async assertForm(
    tx: TransactionClient,
    form: NodeKindForm,
    previous: NodeKindForm,
  ): Promise<void> {
    const definitions = await this.registry.definitions('node', {}, tx);
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const before = new Map(previous.fields.map((slot) => [slot.fieldId, slot.state]));
    const issues: { fieldId: string; reason: 'unknown_field' | 'hidden_field' }[] = [];
    for (const slot of form.fields) {
      const definition = byId.get(slot.fieldId);
      if (!definition) {
        issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
        continue;
      }
      if (definition.hidden && slot.state !== 'hidden' && before.get(slot.fieldId) !== slot.state) {
        issues.push({ fieldId: slot.fieldId, reason: 'hidden_field' });
      }
    }
    if (issues.length === 0) return;
    throw new DomainException(
      ErrorCode.PROJECT_NODE_KIND_FORM_INVALID,
      'Node kind form is invalid',
      { fieldIds: issues, reason: issues[0]!.reason },
    );
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
