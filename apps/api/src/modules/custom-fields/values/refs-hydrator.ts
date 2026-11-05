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
import { TASK_REF_READER, type TaskRefReader } from '../../tasks/ports/task-ref-reader.port.js';
import {
  LETTER_REF_READER,
  type LetterRefReader,
} from '../../correspondence/ports/letter-ref-reader.port.js';
import { NODE_REF_READER, type NodeRefReader } from '../../projects/ports/node-ref-reader.port.js';

/**
 * Ссылки для показа значений (#431 Р6; #631 Р5 — задачи/письма/папки):
 * деталь сущности несёт `customFieldRefs`, чтобы карточка не ходила в
 * справочники за каждым именем. Пачки по видам ссылок, дедуп `kind:id`.
 *
 * `name: null` — «Запись недоступна»: невидимые актёру цели (проекты,
 * конфиденциальные задачи/письма) и удалённые записи; удалённая цель —
 * ещё и `archived: true` («запись удалена», значение не инвалидируется).
 * Архивные читаются с пометкой `archived`. Цвет — только у вариантов
 * списков (Р6 #631).
 */
@Injectable()
export class CustomFieldRefsHydrator {
  constructor(
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(TASK_REF_READER) private readonly tasks: TaskRefReader,
    @Inject(LETTER_REF_READER) private readonly letters: LetterRefReader,
    @Inject(NODE_REF_READER) private readonly nodes: NodeRefReader,
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
    const taskIds = new Set<string>();
    const letterIds = new Set<string>();
    const nodeIds = new Set<string>();

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
          case 'task':
            taskIds.add(String(value));
            break;
          case 'letter':
            letterIds.add(String(value));
            break;
          case 'node':
            nodeIds.add(String(value));
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
      taskRefs,
      letterRefs,
      nodeRefs,
      visibleTasks,
      visibleLetters,
      visibleNodes,
    ] = await Promise.all([
      this.users.findRefs([...userIds], tx),
      this.users.filterActiveUserIds([...userIds], tx),
      this.org.departmentRefs([...departmentIds], tx),
      this.dictionaries.itemRefs([...itemIds], tx),
      this.counterparties.refs([...counterpartyIds]),
      Promise.all([...counterpartyIds].map((id) => this.counterparties.activeRef(id))),
      actor ? this.projects.refsFor(actor, [...projectIds]) : Promise.resolve([]),
      this.tasks.refs([...taskIds]),
      this.letters.refs([...letterIds]),
      this.nodes.refs([...nodeIds]),
      actor
        ? this.visibleOf(taskIds, (id) => this.tasks.visibleFor(id, actor))
        : Promise.resolve(new Set<string>()),
      actor
        ? this.visibleOf(letterIds, (id) => this.letters.visibleFor(id, actor))
        : Promise.resolve(new Set<string>()),
      actor
        ? this.visibleOf(nodeIds, (id) => this.nodes.visibleFor(id, actor))
        : Promise.resolve(new Set<string>()),
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
        color: item.color ?? null,
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
    // Задачи/письма/папки (Р5 #631): имя — только видимые актёру; удалённая
    // цель — name null + archived (история значения живёт).
    const taskById = new Map(taskRefs.map((ref) => [ref.id, ref]));
    for (const id of taskIds) {
      const task = taskById.get(id);
      const visible = task !== undefined && !task.deleted && visibleTasks.has(id);
      add({
        kind: 'task',
        id,
        name: visible ? task!.name : null,
        avatarUrl: null,
        archived: task?.deleted ?? false,
      });
    }
    const letterById = new Map(letterRefs.map((ref) => [ref.id, ref]));
    for (const id of letterIds) {
      const letter = letterById.get(id);
      const visible = letter !== undefined && !letter.deleted && visibleLetters.has(id);
      add({
        kind: 'letter',
        id,
        name: visible ? letter!.name : null,
        avatarUrl: null,
        archived: letter?.deleted ?? false,
      });
    }
    const nodeById = new Map(nodeRefs.map((ref) => [ref.id, ref]));
    for (const id of nodeIds) {
      const node = nodeById.get(id);
      const visible = node !== undefined && visibleNodes.has(id);
      add({
        kind: 'node',
        id,
        name: visible ? node!.name : null,
        avatarUrl: null,
        archived: node === undefined,
      });
    }

    return [...refs.values()];
  }

  /** Параллельная видимость ссылок одного вида (пачка мелких проверок). */
  private async visibleOf(
    ids: ReadonlySet<string>,
    visibleFor: (id: string) => Promise<boolean>,
  ): Promise<Set<string>> {
    const checks = await Promise.all([...ids].map((id) => visibleFor(id)));
    return new Set([...ids].filter((_, index) => checks[index]));
  }
}
