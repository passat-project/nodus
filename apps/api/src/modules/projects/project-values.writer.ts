import { Inject, Injectable } from '@nestjs/common';
import { PROJECT_EVENTS, type CustomFieldValue, type CustomFieldValues } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { projectAudience } from './project-audience.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';
import { eventValue, valuesOf } from './project-structure.values.js';

/**
 * Писатель значений формул проекта и папки (#632, Р4/Р5): единственная точка
 * материализации результата — merge ОДНОГО ключа `custom_fields` под локом
 * строки (проект — `FOR UPDATE`, папка — advisory-лок структуры + лок узла),
 * проверка значения — порт реестра в режиме `trusted` (видимость источников
 * уже отфильтрована резолверами Р7, пользователя у пересчёта нет).
 *
 * Событие хоста эмитится штатным payload (`project.updated` с `cf.<id>`,
 * `project.node_updated` с `customFieldChanges`) — каскад пересчёта идёт теми
 * же событиями, что у обычной правки, и затухает на неизменившихся
 * значениях (шум-контроль Р4). Возврат `false` — значение не изменилось.
 */
@Injectable()
export class ProjectValuesWriter {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly participants: ProjectParticipantsRepository,
    private readonly eventBus: EventBus,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
  ) {}

  /** Замок проекта в порядке «хост → ячейки»: его берут и save формулы, и
   *  пересчёт ДО записи `formula_cells`, иначе конкурентный PATCH ловит 40P01.
   *  Возвращает свежую строку под `FOR UPDATE` — гарды мутаций перепроверяют
   *  по ней архив и руководство (#705). */
  async lockProject(
    tx: TransactionClient,
    projectId: string,
  ): Promise<{ id: string; visibility: string; status: string } | null> {
    return this.projects.lockForUpdate(tx, projectId);
  }

  /** Замок папки (структура проекта → строка узла) — тот же порядок, что у
   *  PATCH папки. */
  async lockNode(tx: TransactionClient, projectId: string, nodeId: string): Promise<void> {
    await this.nodes.lockStructure(tx, projectId);
    await this.nodes.lockNode(tx, projectId, nodeId);
  }

  /** Значение формулы в атрибутах проекта (Р4): `false` — без изменений. */
  async writeProject(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    fieldId: string,
    value: CustomFieldValue | null,
  ): Promise<boolean> {
    if (!(await this.lockProject(tx, projectId))) return false;
    const fresh = await this.projects.findById(projectId, tx);
    if (!fresh) return false;
    const prepared = await this.registry.prepareUpdate(
      {
        current: (fresh.customFields ?? {}) as CustomFieldValues,
        patch: { [fieldId]: value },
        actor: systemActor(actorId, fresh.creatorId),
        target: { kind: 'project_type', id: fresh.typeId },
        trusted: true,
      },
      tx,
    );
    if (prepared.changes.length === 0) return false;
    const next = await this.projects.update(tx, projectId, {
      customFields: prepared.next as Prisma.InputJsonValue,
    });
    await this.eventBus.emit(
      tx,
      PROJECT_EVENTS.UPDATED,
      {
        projectId,
        fields: prepared.changes.map((change) => `cf.${change.fieldId}`),
        // Пересчёт формулы — не правка человека: история пометит строку
        // «Автоматически» (#699).
        automatic: true,
        // Аудитория — состояние ПОСЛЕ правки и в той же tx (#646).
        audience: await projectAudience(this.participants, next, tx),
      },
      { actorId, aggregateType: 'project', aggregateId: projectId },
    );
    return true;
  }

  /** Значение формулы в атрибутах папки (Р4): `false` — без изменений.
   *  `includeActor=false` — каскадный пересчёт: актёр-триггер не входит
   *  в аудиторию node_updated, если не видит проект (security #632). */
  async writeNode(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    nodeId: string,
    fieldId: string,
    value: CustomFieldValue | null,
    opts: { includeActor?: boolean } = {},
  ): Promise<boolean> {
    await this.lockNode(tx, projectId, nodeId);
    const node = await this.nodes.findInProject(projectId, nodeId, tx);
    if (!node) return false;
    const prepared = await this.registry.prepareUpdate(
      {
        current: valuesOf(node),
        patch: { [fieldId]: value },
        actor: systemActor(actorId, null),
        target: { kind: 'node_kind', id: node.kindId },
        trusted: true,
      },
      tx,
    );
    if (prepared.changes.length === 0) return false;
    await this.nodes.update(tx, nodeId, {
      customFields: prepared.next as Prisma.InputJsonValue,
    });
    const project = await this.projects.findById(projectId, tx);
    await this.eventBus.emit(
      tx,
      PROJECT_EVENTS.NODE_UPDATED,
      {
        projectId,
        nodeId,
        fields: prepared.changes.map((change) => `cf.${change.fieldId}`),
        customFieldChanges: prepared.changes.map((change) => ({
          fieldId: change.fieldId,
          from: eventValue(change.from),
          to: eventValue(change.to),
        })),
        // Адресная рассылка участникам проекта (#632): без аудитории gateway
        // молча выбрасывает событие — правка атрибутов папки и пересчёт её
        // формул не видны никому (дерево и формулы наследников до F5).
        // Актёр — только при прямой правке: каскадный пересчёт от чужой
        // правки не раскрывает ему проект (security #632).
        ...(project
          ? {
              audience: [
                ...new Set([
                  ...(await projectAudience(this.participants, project, tx)),
                  ...(opts.includeActor === false || !actorId ? [] : [actorId]),
                ]),
              ],
            }
          : {}),
      },
      { actorId, aggregateType: 'project_node', aggregateId: nodeId },
    );
    return true;
  }
}

/** Системный актёр записи формулы: у пересчёта пользователя нет (Р4). */
function systemActor(
  actorId: string | null,
  fallbackId: string | null,
): { id: string; permissions: readonly string[] } {
  return { id: actorId ?? fallbackId ?? '00000000-0000-0000-0000-000000000000', permissions: [] };
}
