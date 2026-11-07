import { Inject, Injectable } from '@nestjs/common';
import {
  clearedRequiredKeys,
  CUSTOM_FIELD_LIMITS,
  effectiveCreationForm,
  ErrorCode,
  requiredCreateKeys,
  TASK_EVENTS,
  type CreationFieldKey,
  type CustomFieldValue,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { audienceIds, planHolderIds } from '../access/task-access.js';
import { ParticipantsRepository } from '../participants/participants.repository.js';
import { Placements } from '../personal/placements.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
  type RegistryFieldChange,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { TaskFactsRepository } from './task-facts.repository.js';
import { TasksRepository, type TaskFieldsPatch } from './tasks.repository.js';

/** Строка задачи для правки полей: хватает идентичности, типа (обязательные
 *  поля формы создания, #432) и текущих значений, которые пишут события
 *  (TaskListRow подходит структурно). */
export interface TaskFieldsRow {
  id: string;
  number: number;
  typeId: string;
  parentId: string | null;
  assigneeId: string;
  projectId: string | null;
  /** Текущий узел структуры (#467) — прежнее значение в событии. */
  nodeId: string | null;
}

/** Правка полей задачи в транзакции вызывающего. Ключи — только те, что
 *  реально меняются (PATCH — присланные; окно перехода — дифф, #380). */
export interface TaskFieldsWrite {
  title?: string;
  description?: string;
  priority?: string;
  plannedMinutes?: number | null;
  parentId?: string | null;
  deadline?: string | null;
  assigneeId?: string;
  /** Перенос в другой проект или отвязка (#52 Р4): валидацию привязки
   *  (видимость/состав секретного/архив) делает вызывающий ДО транзакции. */
  projectId?: string | null;
  /** Узел структуры проекта (#467): null — убрать из структуры («Без узла»);
   *  узел обязан принадлежать проекту задачи (порт, 422). В одном патче с
   *  projectId узел СБРАСЫВАЕТСЯ — узел старого проекта не переносится. */
  nodeId?: string | null;
  /** Патч кастомных атрибутов (#431): `null` удаляет ключ, проверка — порт. */
  customFields?: Record<string, CustomFieldValue | null>;
}

/**
 * Единый писатель полей задачи (#380): вынесен из TaskEditService.applyFields
 * без изменения поведения, чтобы окно перехода правила поля той же доменной
 * логикой (локи, перепривязка, смена ответственного, события), а не копией.
 * Вызывается только внутри транзакции сервиса; права проверяет вызывающий.
 */
@Injectable()
export class TaskFieldsWriter {
  constructor(
    private readonly repo: TasksRepository,
    private readonly facts: TaskFactsRepository,
    private readonly eventBus: EventBus,
    private readonly participantsRepo: ParticipantsRepository,
    private readonly placements: Placements,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(FORMULA_CELLS) private readonly formulaCells: FormulaCells,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  async apply(
    tx: TransactionClient,
    actor: { id: string; permissions: readonly string[] },
    row: TaskFieldsRow,
    patch: TaskFieldsWrite,
    fields: readonly string[],
    opts: { formulaWrite?: boolean } = {},
  ): Promise<{ customFieldChanges: RegistryFieldChange[] }> {
    const reparent = patch.parentId !== undefined;
    // Смены родителя сериализуются одной advisory-блокировкой транзакции
    // (построчные локи не ловят циклы из 4+ узлов) — и берётся она ДО замка
    // строки: единый порядок захвата во всех транзакциях, без 40P01 с
    // FK-проверкой parent_id (security-гейт #37, р.2–3). Смены редки.
    if (reparent) await this.repo.lockTree(tx);
    await this.repo.lock(tx, row.id);
    if (reparent) {
      // Права на прежнего родителя проверены по снимку до транзакции —
      // параллельная перепривязка их обесценивает: конфликт, а не обход.
      const freshParentId = await this.repo.parentIdOf(tx, row.id);
      if (freshParentId !== row.parentId) {
        throw DomainException.conflict('Task parent changed concurrently');
      }
    }
    if (patch.parentId) {
      if (await this.repo.isDescendant(tx, row.id, patch.parentId)) {
        throw new DomainException(ErrorCode.TASK_PARENT_CYCLE, 'Parent is a descendant');
      }
    }
    // Узел структуры (#467): валидна привязка только к ЭФФЕКТИВНОМУ проекту
    // патча. Совмещённый PATCH projectId+nodeId не должен валидировать узел
    // против старого проекта: иначе задача уезжает в проект B с узлом проекта
    // A (утечка агрегатов A и вечный 409 на удаление узла). Смена проекта
    // всегда обнуляет узел — перенос в узел отдельным действием после него.
    const projectChanged = patch.projectId !== undefined && patch.projectId !== row.projectId;
    const effectiveProjectId = patch.projectId !== undefined ? patch.projectId : row.projectId;
    let nodeReset = false;
    if (patch.nodeId !== undefined && patch.nodeId !== null) {
      if (!effectiveProjectId) {
        throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node is not available', {
          nodeId: patch.nodeId,
        });
      }
      // Тот же advisory-лок, что у create/move/delete узла: удаление пустого
      // узла не должно гоняться с назначением задачи (висячий node_id).
      await this.projects.lockNodeStructure(tx, effectiveProjectId);
      await this.projects.assertNodeAllowed(effectiveProjectId, patch.nodeId);
    }
    if (projectChanged) nodeReset = true;
    // Формульная запись — не ручная правка: пустой результат/ошибка ячейки
    // не должны блокировать сохранение формулы проверкой обязательных полей
    // (Р13: ошибка живёт в ячейке, а не отменяет действие).
    if (!opts.formulaWrite) await this.assertRequiredKept(row.typeId, patch);
    const data: TaskFieldsPatch = {};
    // Значения атрибутов читаются и пишутся под замком строки: параллельные
    // PATCH сливаются по ключам, а не перетирают карту целиком (#431).
    let fieldChanges: RegistryFieldChange[] = [];
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.priority !== undefined) data.priority = patch.priority as TaskFieldsPatch['priority'];
    if (patch.plannedMinutes !== undefined) data.plannedMinutes = patch.plannedMinutes;
    if (patch.parentId !== undefined) data.parentId = patch.parentId;
    if (patch.projectId !== undefined) data.projectId = patch.projectId;
    if (patch.nodeId !== undefined) data.nodeId = patch.nodeId;
    if (nodeReset) data.nodeId = null;
    if (patch.deadline !== undefined) {
      data.deadline = patch.deadline ? new Date(patch.deadline) : null;
      data.overdueNotifiedAt = null; // новый срок — новое однократное уведомление
    }
    const newAssigneeId =
      patch.assigneeId !== undefined && patch.assigneeId !== row.assigneeId
        ? patch.assigneeId
        : undefined;
    const reassigned = newAssigneeId !== undefined;
    if (newAssigneeId !== undefined) {
      data.assigneeId = newAssigneeId;
      // Новый ответственный перестаёт быть соисполнителем/наблюдателем.
      await this.participantsRepo.remove(tx, row.id, newAssigneeId);
    }
    if (patch.customFields && Object.keys(patch.customFields).length > 0) {
      const current = await this.facts.customFieldsOf(tx, row.id);
      // Тип строки — привязка атрибутов (#432, Р8): запись значения
      // непривязанного атрибута — 422 `not_in_type`, очистка разрешена.
      const prepared = await this.customFields.prepareUpdate(
        {
          current,
          patch: patch.customFields,
          actor,
          target: { kind: 'process_type', id: row.typeId },
          ...(opts.formulaWrite ? { trusted: true } : {}),
        },
        tx,
      );
      fieldChanges = prepared.changes;
      // Вписанное значение снимает формулу ячейки в той же tx (Р5 #632):
      // «зафиксировать» = вписать руками, «как у типа» = очистить значение.
      // Снимаем только РЕАЛЬНО изменённые ключи: Enter без правки (и повтор
      // того же значения из окна) формулу не отменяет.
      if (!opts.formulaWrite && prepared.changes.length > 0) {
        await this.formulaCells.release(
          tx,
          'task',
          row.id,
          prepared.changes.map((change) => change.fieldId),
        );
      }
      if (prepared.changes.length > 0) data.customFields = prepared.next;
    }
    // Формульная запись без фактических изменений не эмитит `task.updated`:
    // иначе пересчёт «значение не изменилось» запускал бы новую волну
    // пересчёта по кругу (шторм событий без роста глубины).
    if (opts.formulaWrite && fieldChanges.length === 0) return { customFieldChanges: [] };
    await this.repo.updateFields(tx, row.id, data);
    const after = await this.repo.findWithParticipants(row.id, tx);
    const base = {
      taskId: row.id,
      number: row.number,
      audience: audienceIds(after, [row.assigneeId]),
    };
    const meta = { actorId: actor.id, aggregateType: 'task', aggregateId: row.id };
    if (reassigned) {
      await this.placements.sync(tx, after, planHolderIds(after), actor.id);
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.ASSIGNED,
        {
          ...base,
          title: after.title,
          projectId: after.projectId ?? null,
          assigneeId: after.assigneeId,
          previousAssigneeId: row.assigneeId,
        },
        meta,
      );
    }
    const changedKeys = fieldChanges.map((change) => `cf.${change.fieldId}`);
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        ...base,
        // Формульная запись: клиент обязан перечитать деталь даже у автора
        // правки — пересчёт идёт ПОСЛЕ ответа мутации, и без этого карточка
        // держит старое значение до перезагрузки.
        ...(opts.formulaWrite ? { formulaWrite: true } : {}),
        fields: changedKeys.length > 0 ? [...fields, ...changedKeys] : fields,
        // Обрезка длинного текста и числа изменений — лимит события (Р12).
        ...(fieldChanges.length > 0
          ? { customFieldChanges: fieldChanges.map(eventSafeChange) }
          : {}),
        ...(patch.title !== undefined ? { title: after.title } : {}),
        ...(patch.deadline !== undefined
          ? { deadline: after.deadline?.toISOString() ?? null }
          : {}),
        // Перенос между проектами (#52 Р4): пересчёт участия живёт на обоих
        // концах — прежний проект теряет строку, новый получает.
        ...(patch.projectId !== undefined
          ? { projectId: after.projectId, previousProjectId: row.projectId }
          : {}),
        // Узел структуры (#467): перенос между узлами и сброс сменой
        // проекта несут оба значения — клиент переставляет задачу в дереве.
        ...(patch.nodeId !== undefined || nodeReset
          ? { nodeId: after.nodeId, previousNodeId: row.nodeId }
          : {}),
        // Перепривязка (#632): состав подзадач меняется у старого и нового
        // родителя — формулы-агрегаты пересчитываются по обоим. Смена
        // проекта тоже выкидывает задачу из выборки родителя (subtasks
        // фильтруются проектом) — отдаём фактического родителя.
        ...(patch.parentId !== undefined
          ? { parentId: after.parentId, previousParentId: row.parentId }
          : projectChanged
            ? { parentId: after.parentId }
            : {}),
      },
      meta,
    );
    return { customFieldChanges: fieldChanges };
  }

  /**
   * Обязательное при создании нельзя очистить (#432, Р5): срок, описание и
   * атрибуты типа проверяются общим предикатом формы — одной точкой для
   * PATCH карточки и окна перехода. Смена ответственного обязательной не
   * бывает (`requiredAllowed`), поэтому её здесь нет.
   */
  private async assertRequiredKept(typeId: string, patch: TaskFieldsWrite): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.deadline !== undefined) values.deadline = patch.deadline;
    for (const [fieldId, value] of Object.entries(patch.customFields ?? {})) {
      values[`cf.${fieldId}`] = value;
    }
    if (Object.keys(values).length === 0) return;
    const type = await this.catalog.typeById(typeId);
    if (!type) return;
    const required: CreationFieldKey[] = requiredCreateKeys(
      effectiveCreationForm(type.creationForm, type.category),
    );
    const cleared = clearedRequiredKeys(required, values);
    if (cleared.length === 0) return;
    throw new DomainException(
      ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      'Required field cannot be cleared',
      { typeId, fields: cleared, reason: 'clear' },
    );
  }
}

/** Значение в событии: длинный текст обрезается, изменений — не больше лимита. */
function eventSafeChange(change: RegistryFieldChange) {
  const clip = (value: CustomFieldValue | null): CustomFieldValue | null =>
    typeof value === 'string' && value.length > CUSTOM_FIELD_LIMITS.eventText
      ? value.slice(0, CUSTOM_FIELD_LIMITS.eventText)
      : value;
  return { fieldId: change.fieldId, from: clip(change.from), to: clip(change.to) };
}
