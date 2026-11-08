import { Inject, Injectable } from '@nestjs/common';
import type { NumberContainer, NumberContainerHit, NumberContainerRef } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  FIELD_BINDING_TARGET_READER,
  type FieldBindingTargetReader,
} from '../../projects/ports/field-binding-targets.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';
import type { NumberActor } from '../ports/number-host.port.js';
import { NUMBER_HOST_REGISTRY, type NumberHostRegistry } from '../ports/number-host.port.js';
import { CustomFieldRefsHydrator } from '../values/refs-hydrator.js';

/**
 * Значения условий счёта глазами человека (#630): имя и путь записи, флаг
 * «скрыт» (секретный проект — имя не раскрывается) и «удалена» (пустую
 * папку можно удалить, счёт остаётся в истории). Таблицы чужих модулей
 * читаются портами — своих имён модуль атрибутов не придумывает.
 */
@Injectable()
export class NumberRefService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    @Inject(FIELD_BINDING_TARGET_READER) private readonly targets: FieldBindingTargetReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(NUMBER_HOST_REGISTRY) private readonly hosts: NumberHostRegistry,
    private readonly hydrator: CustomFieldRefsHydrator,
  ) {}

  /** Строки условий счёта в порядке правила. */
  async refs(
    tx: TransactionClient,
    hits: readonly NumberContainerHit[],
    containers: readonly NumberContainer[],
    actor: NumberActor,
  ): Promise<NumberContainerRef[]> {
    const [nodeKinds, projectTypes, definitions] = await Promise.all([
      this.targets.nodeKinds(),
      this.targets.projectTypes(),
      this.definitions.list(tx),
    ]);
    const kindById = new Map(nodeKinds.map((kind) => [kind.id, kind.name]));
    const typeById = new Map(projectTypes.map((type) => [type.id, type.name]));
    const definitionByNumber = new Map(definitions.map((row) => [row.number, row]));
    const out: NumberContainerRef[] = [];
    for (const [index, hit] of hits.entries()) {
      const container = containers[index];
      switch (hit.entity) {
        case 'node':
        case 'project':
        case 'portfolio':
        case 'task': {
          const ref = await this.hosts.resolveRef(tx, hit, actor);
          out.push(ref ?? missing(hit, nameOfEntity(hit.entity)));
          break;
        }
        case 'project_type':
          out.push({
            entity: hit.entity,
            id: hit.id,
            name: typeById.get(hit.id) ?? 'Тип проекта',
            path: [],
            hidden: false,
            deleted: !typeById.has(hit.id),
          });
          break;
        case 'type': {
          const [type] = await this.catalog.typeRefs([hit.id]);
          out.push({
            entity: hit.entity,
            id: hit.id,
            name: type?.name ?? kindById.get(hit.id) ?? typeById.get(hit.id) ?? 'Тип записи',
            path: [],
            hidden: false,
            deleted: !type && !kindById.has(hit.id) && !typeById.has(hit.id),
          });
          break;
        }
        case 'value': {
          const definition =
            container?.kind === 'field' ? definitionByNumber.get(container.fieldNumber) : undefined;
          const [ref] = definition
            ? await this.hydrator.hydrateMany(
                [{ id: definition.id, type: definition.type as never }],
                [{ [definition.id]: hit.id }],
                actor,
                tx,
              )
            : [];
          out.push({
            entity: hit.entity,
            id: hit.id,
            name: ref?.name ?? 'Значение',
            path: [],
            hidden: false,
            deleted: ref === undefined,
          });
          break;
        }
      }
    }
    return out;
  }

  /** Имя условия для текста отказа: вид папки («Комплект») или поле. */
  async conditionName(
    tx: TransactionClient,
    containers: readonly NumberContainer[],
    index: number,
  ): Promise<string> {
    const container = containers[index];
    if (!container) return '';
    if (container.kind === 'folder') {
      const kinds = await this.targets.nodeKinds();
      return kinds.find((kind) => kind.id === container.nodeKindId)?.name ?? '';
    }
    if (container.kind === 'field') {
      const definitions = await this.definitions.list(tx);
      return definitions.find((row) => row.number === container.fieldNumber)?.name ?? '';
    }
    return '';
  }
}

function missing(hit: NumberContainerHit, name: string): NumberContainerRef {
  return { entity: hit.entity, id: hit.id, name, path: [], hidden: false, deleted: true };
}

function nameOfEntity(entity: NumberContainerHit['entity']): string {
  switch (entity) {
    case 'node':
      return 'Папка';
    case 'project':
      return 'Проект';
    case 'portfolio':
      return 'Портфель';
    case 'task':
      return 'Задача';
    default:
      return 'Значение';
  }
}
