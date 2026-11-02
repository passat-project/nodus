import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldDefinition, CustomFieldRef, CustomFieldValues } from '@nodus/contracts';
import { isCustomFieldValueFilled } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../../core/ports/org-structure.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import {
  PROJECT_READER,
  type ProjectActor,
  type ProjectReader,
} from '../../projects/ports/project-reader.port.js';

/**
 * Ссылки для показа значений (#431, Р6): деталь сущности несёт
 * `customFieldRefs`, чтобы карточка не ходила в справочники за каждым именем.
 * Пачки по видам ссылок (сотрудники, подразделения, элементы справочников и
 * валюта денег, контрагенты), дедуп по `kind:id`.
 *
 * `name: null` — «Запись недоступна»: невидимые актёру проекты (#52) и
 * удалённые записи. Архивные читаются с пометкой `archived`.
 */
@Injectable()
export class CustomFieldRefsHydrator {
  constructor(
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  async hydrate(
    definitions: ReadonlyArray<Pick<CustomFieldDefinition, 'id' | 'type'>>,
    values: CustomFieldValues,
    /** Актёр запроса (#52): ссылки-проекты показываются только видимые
     *  актёру; служебные вызовы (редактор определений) — без имён. */
    actor: ProjectActor | undefined,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]> {
    return this.hydrateMany(definitions, [values], actor, tx);
  }

  /** Пачка по списку карт значений (#556, Р4): id собираются одним проходом,
   *  запросы к справочникам — по одной пачке на вид ссылки (дедуп `kind:id`). */
  async hydrateMany(
    definitions: ReadonlyArray<Pick<CustomFieldDefinition, 'id' | 'type'>>,
    valuesList: readonly CustomFieldValues[],
    actor: ProjectActor | undefined,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]> {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const userIds = new Set<string>();
    const departmentIds = new Set<string>();
    const itemIds = new Set<string>();
    const counterpartyIds = new Set<string>();
    const projectIds = new Set<string>();

    const scalarIds = (value: unknown): string[] =>
      Array.isArray(value) ? (value as string[]) : [String(value)];

    for (const values of valuesList) {
      for (const [fieldId, value] of Object.entries(values)) {
        const definition = byId.get(fieldId);
        if (!definition || !isCustomFieldValueFilled(value)) continue;
        switch (definition.type) {
          case 'user':
          case 'users':
            for (const id of scalarIds(value)) userIds.add(id);
            break;
          case 'department':
            departmentIds.add(String(value));
            break;
          case 'enum':
          case 'multienum':
            for (const id of scalarIds(value)) itemIds.add(id);
            break;
          case 'money':
            itemIds.add((value as { currencyId: string }).currencyId);
            break;
          case 'counterparty':
            counterpartyIds.add(String(value));
            break;
          case 'project':
            projectIds.add(String(value));
            break;
          default:
            break;
        }
      }
    }

    const [
      userRefs,
      activeUserIds,
      departments,
      items,
      counterpartyRefs,
      activeCounterparties,
      projectRefs,
    ] = await Promise.all([
      this.users.findRefs([...userIds], tx),
      this.users.filterActiveUserIds([...userIds], tx),
      this.org.departmentRefs([...departmentIds], tx),
      this.dictionaries.itemRefs([...itemIds], tx),
      this.counterparties.refs([...counterpartyIds]),
      Promise.all([...counterpartyIds].map((id) => this.counterparties.activeRef(id))),
      actor ? this.projects.refsFor(actor, [...projectIds]) : Promise.resolve([]),
    ]);

    const refs = new Map<string, CustomFieldRef>();
    const add = (ref: CustomFieldRef): void => {
      refs.set(`${ref.kind}:${ref.id}`, ref);
    };

    const activeUsers = new Set(activeUserIds);
    for (const user of userRefs) {
      add({
        kind: 'user',
        id: user.id,
        name: user.displayName,
        avatarUrl: user.avatarUrl,
        archived: !activeUsers.has(user.id),
      });
    }
    for (const department of departments) {
      add({
        kind: 'department',
        id: department.id,
        name: department.name,
        avatarUrl: null,
        archived: !department.isActive,
      });
    }
    for (const item of items) {
      add({
        kind: 'dictionary_item',
        id: item.id,
        name: item.name,
        avatarUrl: null,
        archived: !item.isActive,
      });
    }
    const activeCounterpartyIds = new Set(
      activeCounterparties.filter((ref) => ref !== null).map((ref) => ref.id),
    );
    for (const counterparty of counterpartyRefs) {
      add({
        kind: 'counterparty',
        id: counterparty.id,
        name: counterparty.name,
        avatarUrl: null,
        archived: !activeCounterpartyIds.has(counterparty.id),
      });
    }
    // Проекты (#52 Р13): имя — только видимое актёру; невидимый и без
    // актёра — «Запись недоступна» (name null), значение не теряется.
    const projectById = new Map(projectRefs.map((ref) => [ref.id, ref]));
    for (const id of projectIds) {
      const project = projectById.get(id);
      add({
        kind: 'project',
        id,
        name: project?.name ?? null,
        avatarUrl: null,
        archived: false,
      });
    }

    return [...refs.values()];
  }
}
