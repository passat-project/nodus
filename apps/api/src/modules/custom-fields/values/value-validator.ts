import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from '@nodus/contracts';
import { customFieldValueSchemaOf, CUSTOM_FIELD_LIMITS } from '@nodus/contracts';

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
  PROJECT_READER,
  type ProjectActor,
  type ProjectReader,
} from '../../projects/ports/project-reader.port.js';
import {
  TASK_REF_READER,
  type TaskRefReader,
  type TaskRefViewer,
} from '../../tasks/ports/task-ref-reader.port.js';
import {
  LETTER_REF_READER,
  type LetterRefReader,
  type LetterRefViewer,
} from '../../correspondence/ports/letter-ref-reader.port.js';
import { NODE_REF_READER, type NodeRefReader } from '../../projects/ports/node-ref-reader.port.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import { checkOne } from './reference-check.js';

/** Что валидатору нужно знать об определении (DTO или строка репозитория). */
export type DefinitionFacts = Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>;

/** Причина отказа значения (Р2): код читает интерфейс, текст — i18n веба.
 *  `not_in_type` — атрибут не привязан к месту сущности (#631, Р3). */
export type CustomFieldIssueReason =
  'unknown' | 'invalid' | 'not_found' | 'inactive' | 'not_in_type';

export interface CustomFieldIssue {
  fieldId: string;
  reason: CustomFieldIssueReason;
  message: string;
}

/** Справочник валют — системный код (Р10). */
const CURRENCY_CODE = 'currency';

/**
 * Проверка значений атрибутов (#431, Р1/Р2; #631 — без областей и ссылок
 * на записи) — единственная точка серверной валидации. Грамматика типа
 * живёт в контрактах (`customFieldValueSchemaOf`), здесь — ссылки: активный
 * сотрудник, действующее подразделение, активный вариант справочника,
 * валюта из `currency`, действующий контрагент, видимый проект, задача/
 * письмо/папка (Р5: только видимые актёру — скрытый = несуществующий,
 * без оракула секретности). Ссылки читаются портами пачками (I3): только
 * по изменившимся значениям.
 */
@Injectable()
export class CustomFieldValueValidator {
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

  /**
   * Проверяет значения. Пустой список определений — быстрый выход без
   * обращений к портам. `actor` — обязательный источник видимости ссылок
   * (проекты/задачи/письма/папки); без актёра (умолчания, глобальные
   * значения) ссылки-записи не принимаются — это всегда ручной ввод.
   */
  async validate(
    definitions: ReadonlyArray<DefinitionFacts>,
    values: CustomFieldValues,
    tx?: TransactionClient,
    actor?: ProjectActor,
  ): Promise<CustomFieldIssue[]> {
    const entries = Object.entries(values);
    if (entries.length === 0) return [];
    if (entries.length > CUSTOM_FIELD_LIMITS.changes) {
      return [{ fieldId: '', reason: 'invalid', message: 'more than 50 fields' }];
    }

    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const issues: CustomFieldIssue[] = [];
    const accepted: Array<{ definition: DefinitionFacts; value: CustomFieldValue }> = [];

    for (const [fieldId, value] of entries) {
      const definition = byId.get(fieldId);
      if (!definition) {
        issues.push({ fieldId, reason: 'unknown', message: 'Unknown custom field' });
        continue;
      }
      if (!customFieldValueSchemaOf(definition).safeParse(value).success) {
        issues.push({ fieldId, reason: 'invalid', message: 'Value does not match field type' });
        continue;
      }
      accepted.push({ definition, value });
    }

    issues.push(...(await this.checkReferences(accepted, tx, actor)));
    return issues;
  }

  /** Ссылочная часть: одна пачка на вид ссылки, затем сверка. */
  private async checkReferences(
    accepted: ReadonlyArray<{ definition: DefinitionFacts; value: CustomFieldValue }>,
    tx?: TransactionClient,
    actor?: ProjectActor,
  ): Promise<CustomFieldIssue[]> {
    const userIds = new Set<string>();
    const departmentIds = new Set<string>();
    const itemIds = new Set<string>();
    const currencyIds = new Set<string>();
    const counterpartyIds = new Set<string>();
    const projectIds = new Set<string>();
    const taskIds = new Set<string>();
    const letterIds = new Set<string>();
    const nodeIds = new Set<string>();

    const scalarIds = (value: CustomFieldValue): string[] =>
      Array.isArray(value) ? value : [String(value)];

    for (const { definition, value } of accepted) {
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
          currencyIds.add((value as { currencyId: string }).currencyId);
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

    if (
      userIds.size === 0 &&
      departmentIds.size === 0 &&
      itemIds.size === 0 &&
      currencyIds.size === 0 &&
      counterpartyIds.size === 0 &&
      projectIds.size === 0 &&
      taskIds.size === 0 &&
      letterIds.size === 0 &&
      nodeIds.size === 0
    ) {
      return []; // ссылок нет — порты не нужны
    }

    // Видимость ссылок-записей актёру (#52 Р13, Р5 #631): без актёра
    // значения-записи не принимаются (умолчания и глобальные значения —
    // не ручной ввод актёра; их ссылки не записи).
    const recordKinds = ['task', 'letter', 'node', 'project'] as const;
    if (
      recordKinds.some((kind) => accepted.some(({ definition }) => definition.type === kind)) &&
      !actor
    ) {
      return accepted
        .filter(({ definition }) => (recordKinds as readonly string[]).includes(definition.type))
        .map(({ definition }) => ({
          fieldId: definition.id,
          reason: 'not_found' as const,
          message: 'Record not found or not visible',
        }));
    }

    const [
      userRefs,
      activeUserIds,
      departments,
      items,
      currencies,
      counterparties,
      visibleProjects,
      visibleTasks,
      visibleLetters,
      visibleNodes,
    ] = await Promise.all([
      this.users.findRefs([...userIds], tx),
      this.users.filterActiveUserIds([...userIds], tx),
      this.org.departmentRefs([...departmentIds], tx),
      this.dictionaries.itemRefs([...itemIds], tx),
      this.dictionaries.itemRefs([...currencyIds], tx),
      Promise.all([...counterpartyIds].map((id) => this.counterparties.activeRef(id))),
      this.visibleProjectIds(actor),
      this.visibleOf(taskIds, (id) => this.tasks.visibleFor(id, actor!)),
      this.visibleOf(letterIds, (id) => this.letters.visibleFor(id, actor!)),
      this.visibleOf(nodeIds, (id) => this.nodes.visibleFor(id, actor!)),
    ]);

    // Валюта — элемент ИМЕННО системного справочника `currency` (Р10):
    // id чужого справочника значением денег не принимается.
    const currencyDictionaries = await this.dictionaries.dictionaryRefs(
      [...new Set(currencies.map((row) => row.dictionaryId))],
      tx,
    );
    const currencyDictionaryIds = new Set(
      currencyDictionaries.filter((row) => row.code === CURRENCY_CODE).map((row) => row.id),
    );

    const knownUsers = new Set(userRefs.map((ref) => ref.id));
    const activeUsers = new Set(activeUserIds);
    const departmentById = new Map(departments.map((row) => [row.id, row]));
    const itemById = new Map(items.map((row) => [row.id, row]));
    const currencyById = new Map(
      currencies
        .filter((row) => currencyDictionaryIds.has(row.dictionaryId))
        .map((row) => [row.id, row]),
    );
    const activeCounterparties = new Set(
      counterparties.filter((ref) => ref !== null).map((ref) => ref.id),
    );

    const facts = {
      scalarIds,
      knownUsers,
      activeUsers,
      departmentById,
      itemById,
      currencyById,
      activeCounterparties,
      visibleProjects,
      visibleTasks,
      visibleLetters,
      visibleNodes,
    };

    const issues: CustomFieldIssue[] = [];
    for (const { definition, value } of accepted) {
      const issue = checkOne({ definition, value, ...facts });
      if (issue) issues.push({ fieldId: definition.id, ...issue });
    }
    return issues;
  }

  private async visibleProjectIds(actor: ProjectActor | undefined): Promise<ReadonlySet<string>> {
    if (!actor) return new Set();
    const scope = await this.projects.viewScopeFor(actor);
    return new Set(scope.visibleProjectIds);
  }

  /** Параллельная видимость ссылок одного вида (пачка мелких проверок). */
  private async visibleOf(
    ids: ReadonlySet<string>,
    visibleFor: (id: string) => Promise<boolean>,
  ): Promise<ReadonlySet<string>> {
    const checks = await Promise.all([...ids].map((id) => visibleFor(id)));
    return new Set([...ids].filter((_, index) => checks[index]));
  }
}

/** Зритель ссылки для порта (те же поля, что ProjectActor). */
export type { TaskRefViewer, LetterRefViewer };
