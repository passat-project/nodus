import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type CreateDepartmentDto,
  type DepartmentNode,
  type OrgUnitKind,
  type UpdateDepartmentDto,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { DepartmentsRepository, type DepartmentRow } from './departments.repository.js';
import { deputyIdsOf, toNode, uniqueIds } from './departments.node.js';
import { ManagerDerivationService } from './manager-derivation.service.js';
import { RoleAudienceRepository } from './role-audience.repository.js';
import { UsersRepository } from './users.repository.js';
import {
  assertDistinctLeaders,
  clearDeputiesElsewhere,
  clearHeadElsewhere,
  transferLeaders,
  withHeadConflict,
  type LeadersDeps,
} from './departments-leaders.js';

/**
 * Оргструктура: дерево подразделений (управленческое и юридическое).
 * Узел — руководитель (head) и заместители (deputies, #817; их несколько).
 * Перенос подразделения меняет роли сотрудников поддерева — под bind #490.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly departments: DepartmentsRepository,
    private readonly users: UsersRepository,
    private readonly guard: RoleAssignmentGuard,
    private readonly references: ReferenceGuard,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly audience: RoleAudienceRepository,
    private readonly managers: ManagerDerivationService,
  ) {}

  /** Дерево: корни — parentId null; сортировка sortOrder+name на каждом уровне. */
  async getTree(kind: OrgUnitKind): Promise<DepartmentNode[]> {
    const rows = await this.departments.findAllByKind(kind);
    const byParent = new Map<string | null, DepartmentRow[]>();
    for (const row of rows) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row);
      byParent.set(row.parentId, list);
    }
    const build = (parentId: string | null): DepartmentNode[] =>
      (byParent.get(parentId) ?? []).map((row) => toNode(row, build(row.id)));
    return build(null);
  }

  async getById(id: string): Promise<DepartmentNode> {
    const row = await this.departments.findById(id);
    if (!row) {
      throw DomainException.notFound('Department not found');
    }
    return toNode(row, []);
  }

  async create(dto: CreateDepartmentDto, actor: AuthUser): Promise<DepartmentNode> {
    const deputies = uniqueIds(dto.deputyIds);
    // #946/#817: глава и заместители — разные люди (одно место — одна роль).
    assertDistinctLeaders(dto.headId, deputies);
    if (dto.parentId) {
      await this.ensureExists(dto.parentId);
    }
    return this.tx.run(async (tx) => {
      // #946: назначение главы/замов сериализуется advisory-локом дерева —
      // иначе встречные назначения одного сотрудника оставят роли в двух узлах.
      // Лок берём для обеих структур: уникальность главы общая (#817).
      // #1028: создание management-корня тоже под локом — иначе два
      // параллельных POST создали бы два «главных» узла.
      if (
        (dto.kind === 'management' && dto.parentId === null) ||
        dto.headId ||
        deputies.length > 0
      ) {
        await this.departments.lockTree(tx);
      }
      // Ссылки оргструктуры (#441): руководитель/замы — только активные
      // сотрудники, родитель — подразделение того же вида структуры. Внутри
      // транзакции — без окна TOCTOU между проверкой и записью. Замок
      // родителя сериализует с архивацией (непустой узел не архивируется).
      if (dto.parentId) {
        await this.departments.lockForUpdate(dto.parentId, tx);
      }
      await this.references.ensureActiveUser(dto.headId, 'headId', tx);
      await this.references.ensureActiveUsers(deputies, 'deputyIds', tx);
      await this.references.ensureDepartment(dto.parentId, dto.kind, 'parentId', tx);
      // #1028: корень управленческой структуры один — главная карточка
      // компании (#982). Раньше правило держал только PATCH.
      if (
        dto.kind === 'management' &&
        dto.parentId === null &&
        (await this.departments.countRoots('management', tx)) > 0
      ) {
        throw new DomainException(
          ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
          'Management department root already exists',
          { kind: dto.kind, reason: 'second_root' },
        );
      }
      const fields = { ...dto };
      delete (fields as { deputyIds?: unknown }).deputyIds;
      // #817: снимаем роль главы с других узлов ДО записи нового head_id —
      // иначе уникальный индекс отклонит INSERT и клиент получит 409.
      // Индекс общий для обеих структур: юридическая карточка тоже занимает
      // «единственное место» руководителя, хотя сотрудника не переводит.
      if (dto.headId) {
        await clearHeadElsewhere(this.leaderDeps(), null, dto.headId, actor, tx);
      }
      const created = await withHeadConflict(() =>
        this.departments.create(fields as typeof dto, tx),
      );
      // #946: назначение главы/замов переводит сотрудников в это подразделение
      // в той же транзакции (правило владельца 18.11.2026, одно место).
      if (created.kind === 'management') {
        await transferLeaders(this.leaderDeps(), created.id, dto.headId, deputies, actor, tx);
      }
      if (deputies.length > 0) {
        await clearDeputiesElsewhere(this.leaderDeps(), created.id, deputies, actor, tx);
        await this.departments.setDeputies(created.id, deputies, tx);
      }
      const row =
        deputies.length > 0
          ? ((await this.departments.findById(created.id, tx)) ?? created)
          : created;
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_CREATED,
        { departmentId: created.id, kind: created.kind, deputyIds: deputies },
        { actorId: actor.id, aggregateType: 'department', aggregateId: created.id },
      );
      return toNode(row, []);
    });
  }

  async update(id: string, dto: UpdateDepartmentDto, actor: AuthUser): Promise<DepartmentNode> {
    return this.tx.run(async (tx) => {
      // #982: управленческое подразделение не открепляется в корень — корень
      // один, главная карточка компании. Это ОТКАЗ, а не перенос: проверяем до
      // лока дерева (очередь переносов зря не сериализуем), база не меняется.
      // Юридическая структура — лес корней, там открепление законно.
      if (dto.parentId === null) {
        const node = await this.departments.findById(id, tx);
        if (!node) {
          throw DomainException.notFound('Department not found');
        }
        if (node.kind === 'management' && node.parentId !== null) {
          throw new DomainException(
            ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
            'Management department cannot be detached to root',
            { id },
          );
        }
      }
      // #544: смена parentId сериализуется advisory-локом дерева — проверка
      // цикла и мутация видят зафиксированное состояние конкурента. Строчный
      // FOR UPDATE не спасает: параллельные переносы лочат РАЗНЫЕ строки.
      // #946: тем же локом сериализуются назначения главы/зама — перевод
      // трогает строку старого узла, и встречные назначения одного сотрудника
      // в два узла иначе могли бы дать дедлок двух строк departments.
      if (dto.parentId !== undefined || dto.headId !== undefined || dto.deputyIds !== undefined) {
        await this.departments.lockTree(tx);
      }
      const current = await this.departments.findById(id, tx);
      if (!current) {
        throw DomainException.notFound('Department not found');
      }
      // Повтор правила корня (#982) на состоянии ПОСЛЕ лока: ранняя проверка —
      // быстрый путь без сериализации переносов, эта закрывает interleaving,
      // когда узел успели переставить между чтением и локом.
      if (dto.parentId === null && current.kind === 'management' && current.parentId !== null) {
        throw new DomainException(
          ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
          'Management department cannot be detached to root',
          { id },
        );
      }
      // #441: ссылки оргструктуры — руководитель/замы только активные
      // сотрудники; родитель — подразделение того же вида структуры (иначе
      // поддерево выпадает из дерева своего вида). Новый родитель берётся под
      // FOR UPDATE (порядок: дерево → родитель → узел), чтобы архивация не
      // закоммитилась между проверкой isActive и записью parentId.
      if (dto.parentId) {
        await this.departments.lockForUpdate(dto.parentId, tx);
        if (!(await this.departments.findById(dto.parentId, tx))) {
          throw DomainException.notFound('Department not found');
        }
      }
      await this.references.ensureActiveUser(dto.headId, 'headId', tx);
      await this.references.ensureDepartment(dto.parentId, current.kind, 'parentId', tx);
      // #544: цикл — под локом дерева и в той же транзакции (чтение через tx).
      let newParentChain: string[] = [];
      if (dto.parentId !== undefined && dto.parentId !== null) {
        newParentChain = await this.departments.findParentChain(dto.parentId, tx);
        if (newParentChain.includes(id)) {
          throw new DomainException(ErrorCode.CONFLICT, 'Department tree cycle', {
            id,
            parentId: dto.parentId,
          });
        }
      }
      // bind (#490): перенос меняет роли сотрудников поддерева. Снимок «до» —
      // до смены родителя; отказ проверки после мутации откатывает перенос.
      // Строка под `FOR UPDATE`, состояние перечитывается в транзакции:
      // параллельный перенос коммитится до нас — решение о снимке принимается
      // по зафиксированному parentId, а не по чтению вне транзакции.
      if (!(await this.departments.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Department not found');
      }
      const locked = (await this.departments.findById(id, tx)) ?? current;
      const nextDeputies = dto.deputyIds === undefined ? null : uniqueIds(dto.deputyIds);
      if (nextDeputies !== null) {
        const currentIds = new Set(deputyIdsOf(locked));
        await this.references.ensureActiveUsers(
          nextDeputies.filter((deputyId) => !currentIds.has(deputyId)),
          'deputyIds',
          tx,
        );
      }
      // #946: в архивный узел не назначают — перевод вёл бы сотрудника в
      // подразделение вне активного дерева (мимо ReferenceGuard активности).
      if (
        !locked.isActive &&
        (dto.headId != null || (nextDeputies !== null && nextDeputies.length > 0))
      ) {
        throw new DomainException(ErrorCode.CONFLICT, 'Department is archived', {
          departmentId: id,
          reason: 'archived',
        });
      }
      // #946/#817: глава и замы — разные люди; проверка по ИТОГОВОМУ состоянию
      // (присланное поле + текущее) — частичная правка не должна оставить
      // одного человека в двух ролях одного узла.
      assertDistinctLeaders(
        dto.headId !== undefined ? dto.headId : locked.headId,
        nextDeputies ?? deputyIdsOf(locked),
      );
      const beforeByIds = await this.escalationSnapshot(id, locked, dto, tx);
      const oldParentId = locked.parentId;
      const fields = { ...dto };
      delete (fields as { deputyIds?: unknown }).deputyIds;
      // #817: прежний узел теряет сотрудника-главу ДО записи нового head_id —
      // уникальный индекс не даст сохранить второго главу, даже если перевод
      // в целевой узел окажется no-op (он уже там). Правило общее для структур.
      if (dto.headId) {
        await clearHeadElsewhere(this.leaderDeps(), id, dto.headId, actor, tx);
      }
      let updated = await withHeadConflict(() => this.departments.update(id, fields, tx));
      // #946: назначенные глава/замы — члены ЭТОГО подразделения. Перевод идёт
      // ДО setDeputies: он снимает прежнюю роль/строку зама в старом узле, иначе
      // UNIQUE(user_id) в department_deputies отклонит вставку (409 у клиента).
      if (locked.kind === 'management') {
        await transferLeaders(this.leaderDeps(), id, dto.headId, nextDeputies ?? [], actor, tx);
      }
      if (nextDeputies !== null) {
        await clearDeputiesElsewhere(this.leaderDeps(), id, nextDeputies, actor, tx);
        await this.departments.setDeputies(id, nextDeputies, tx);
        updated = (await this.departments.findById(id, tx)) ?? updated;
      }
      // #923: руководитель сотрудника — производное поле от дерева. Смена
      // главы/замов/родителя меняет ближайшего главу у сотрудников поддерева —
      // пересчитываем в той же транзакции, до события и bind-проверки.
      if (dto.headId !== undefined || dto.deputyIds !== undefined || dto.parentId !== undefined) {
        await this.managers.recomputeDepartments([id], tx);
      }
      if (beforeByIds !== null) {
        await this.guard.assertNoEscalationForUsers(
          actor,
          [...beforeByIds.keys()],
          beforeByIds,
          tx,
        );
      }
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
        { departmentId: id, changedFields: Object.keys(dto) },
        { actorId: actor.id, aggregateType: 'department', aggregateId: id },
      );
      if (beforeByIds !== null) {
        // Перенос меняет действующие роли сотрудников поддерева: привязки к
        // старым management-предкам перестают действовать, к новым — начинают.
        // Аудитория уже посчитана снимком «до»; отзыв — в той же транзакции
        // (#866): выданные токены не должны жить до истечения TTL.
        const oldChain = oldParentId ? await this.departments.findParentChain(oldParentId, tx) : [];
        const movedParents = [...new Set([...oldChain, ...newParentChain])].filter(
          (departmentId) =>
            !(oldChain.includes(departmentId) && newParentChain.includes(departmentId)),
        );
        const roleIds = await this.audience.roleIdsOfDepartments(movedParents, tx);
        await this.emitAccessChanged(tx, roleIds, [...beforeByIds.keys()], actor.id);
      }
      return toNode(updated, []);
    });
  }

  /** Архивация (не удаление — связи сотрудников и история сохраняются, I15).
   *  Непустой узел не архивируется (409 `has_children`): активные дети
   *  archived-родителя выпадают из дерева вида (родитель не в выборке, а дети
   *  не корни) — сначала архивируются/переносятся дети. Замок строки
   *  сериализует с созданием ребёнка (create лочит родителя до проверки). */
  async archive(id: string, actorId: string): Promise<void> {
    await this.ensureExists(id);
    await this.tx.run(async (tx) => {
      if (!(await this.departments.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Department not found');
      }
      const node = await this.departments.findById(id, tx);
      if (!node) {
        throw DomainException.notFound('Department not found');
      }
      // #1028: главную карточку компании не архивируем (вердикт 12.11) —
      // правило жило только в UI, сервер обязан отказать (I8).
      if (node.kind === 'management' && node.parentId === null) {
        throw new DomainException(
          ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
          'Management department root cannot be archived',
          { id, reason: 'root' },
        );
      }
      if ((await this.departments.countActiveChildren(id, tx)) > 0) {
        throw new DomainException(ErrorCode.CONFLICT, 'Department has active children', {
          departmentId: id,
          reason: 'has_children',
        });
      }
      // Архивация убирает узел из management-дерева: привязанные к нему роли
      // перестают действовать на сотрудников поддерева. Аудитория считается
      // ДО мутации — после неё узел неактивен и в роль уже не входит (#866).
      const roleIds = await this.audience.roleIdsOfDepartments([id], tx);
      const userIds = await this.audience.departmentUserIds(id, tx);
      await this.departments.update(id, { isActive: false }, tx);
      // #923: члены архивного узла больше не находят главу в нём — ближайший
      // глава переезжает к родительскому подразделению.
      await this.managers.recomputeDepartments([id], tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_ARCHIVED,
        { departmentId: id },
        { actorId, aggregateType: 'department', aggregateId: id },
      );
      await this.emitAccessChanged(tx, roleIds, userIds, actorId);
    });
  }

  /** `directory.role.access_changed` (#866): привязки ролей к подразделению
   *  изменили аудиторию — auth обесценивает access-токены сотрудников. */
  private async emitAccessChanged(
    tx: TransactionClient,
    roleIds: readonly string[],
    userIds: readonly string[],
    actorId: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    for (const roleId of roleIds) {
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
        { roleId, reason: 'membership', userIds: [...userIds] },
        { actorId, aggregateType: 'role', aggregateId: roleId },
      );
    }
  }

  /** Снимок «до» для bind-проверки (#490): сотрудники поддерева, если перенос
   *  меняет позицию узла; null — роли никого не затронут (проверка не нужна). */
  private async escalationSnapshot(
    id: string,
    current: DepartmentRow,
    dto: UpdateDepartmentDto,
    tx: TransactionClient,
  ): Promise<Map<string, string[]> | null> {
    if (dto.parentId === undefined || dto.parentId === current.parentId) return null;
    const subtree = await this.departments.findSubtreeIds(id, tx);
    const userIds = await this.users.findActiveIdsByDepartmentIds(subtree, tx);
    if (userIds.length === 0) return null;
    return this.guard.snapshotEffectiveRoles(userIds, tx);
  }

  private leaderDeps(): LeadersDeps {
    return {
      departments: this.departments,
      users: this.users,
      managers: this.managers,
      guard: this.guard,
      eventBus: this.eventBus,
    };
  }

  private async ensureExists(id: string): Promise<void> {
    if (!(await this.departments.findById(id))) {
      throw DomainException.notFound('Department not found');
    }
  }
}
