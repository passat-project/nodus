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
      if (dto.form !== undefined) {
        await this.assertForm(tx, dto.form);
        // Слот — привязка (Р3): добавленный слот привязывает, снятый —
        // снимает; привязки без слотов (посев/диалог) не трогаются (#646).
        const previous = current.form.fields.map((slot) => slot.fieldId);
        const next = dto.form.fields.map((slot) => slot.fieldId);
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

  /** Слоты формы — существующие определения (глобального hidden нет, О2
   *  #631: видимость регулирует слот). Слот И ЕСТЬ привязка — форма
   *  синхронизирует привязки вида (Р3). */
  private async assertForm(tx: TransactionClient, form: NodeKindForm): Promise<void> {
    const definitions = await this.registry.definitions({}, tx);
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const issues: { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] = [];
    for (const slot of form.fields) {
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
