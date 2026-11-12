import { Inject, Injectable } from '@nestjs/common';
import { Permission, type AuthUser } from '@nodus/contracts';

import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../../core/ports/org-structure.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import { TaskDeciders } from './task-deciders.service.js';
import { PressRepository } from '../press/press.repository.js';

/** Кто смотрит: id + права (из JWT) + подчинённые по оргструктуре +
 *  множества проектов (Р3: видимые — задачи открытых и моих секретных). */
export interface Viewer {
  id: string;
  permissions: readonly string[];
  subordinateIds: readonly string[];
  visibleProjectIds: readonly string[];
  hiddenProjectIds: readonly string[];
  /** Задачи, где актор — решающий текущего шага (#433). Необязательно:
   *  старые фикстуры и тесты не обязаны заполнять. */
  deciderTaskIds?: readonly string[];
  /** Задачи с ожидающей/возвращённой отметкой сбора (#434): сотрудник не
   *  участник задачи, но обязан видеть карточку, чтобы нажать кнопку. */
  pressTaskIds?: readonly string[];
}

function involves(userIds: readonly string[]): Prisma.TaskWhereInput[] {
  return [
    { creatorId: { in: [...userIds] } },
    { assigneeId: { in: [...userIds] } },
    { participants: { some: { userId: { in: [...userIds] } } } },
  ];
}

/** Гейт «не из скрытых секретных проектов»: null — скрытых нет, фильтр не
 *  нужен. Ветка `IS NULL` обязательна: SQL `NULL NOT IN (...)` ложен, без
 *  неё задачи без проекта пропадают (ловушка Р3). */
function notHiddenProjectIds(hidden: readonly string[]): Prisma.TaskWhereInput | null {
  if (hidden.length === 0) return null;
  return { OR: [{ projectId: null }, { projectId: { notIn: [...hidden] } }] };
}

/**
 * Единственная функция видимости задач (мини-спека #37) — на ВСЕ чтения:
 * список, деталь, ветка, поиск, счётчики, bulk. Видят: участники (постановщик,
 * ответственный, соисполнители, наблюдатели), их руководители по оргструктуре,
 * задачи видимых проектов (открытые + секретные моего участия, #52 Р3),
 * обладатели task.view_all — все задачи, кроме секретных проектов без своего
 * участия (админы секретных не видят, вердикт 29.10). scope=mine — только
 * собственное участие. Подчинённые секретные проекты не раскрывают: их
 * ветка гейтится скрытыми проектами.
 *
 * Конфиденциальные задачи (#461, Р5) видят ТОЛЬКО участники: ветки
 * руководителей, видимых проектов и task.view_all гейтятся
 * `confidential = false`, прямое участие (mine) — нет. Поручения из
 * конфиденциального письма ставит #463; поле до тех пор не пишется.
 */
export function visibleTasksWhere(
  viewer: Viewer,
  scope: 'mine' | 'all',
  opts: { includeDeleted?: boolean } = {},
): Prisma.TaskWhereInput {
  // `includeDeleted` — только для «была видима до удаления» (#631 Р5):
  // плашка «запись удалена» участнику, без оракула для постороннего.
  const alive: Prisma.TaskWhereInput = opts.includeDeleted ? {} : { deletedAt: null };
  const mine = involves([viewer.id]);
  const gate = notHiddenProjectIds(viewer.hiddenProjectIds);
  // Конфиденциальное вне прямого участия не раскрывается ни оргструктурой,
  // ни проектом, ни task.view_all (#461, Р5; вердикт В3 — «никто, даже админ»).
  const openOnly: Prisma.TaskWhereInput = { confidential: false };
  // «Моё участие» тоже гейтится скрытыми секретными: исключённый из проекта
  // (removeManual, open→secret) не сохраняет доступ к его задачам через
  // роль постановщика/ответственного (вердикт 29.10).
  const mineGated: Prisma.TaskWhereInput = gate ? { AND: [{ OR: mine }, gate] } : { OR: mine };
  // Участник сбора (#434): карточка нужна, чтобы нажать свою кнопку. Явный
  // источник может быть и вне ролей задачи; скрытый секретный проект закрыт
  // той же щелью. В «Мои задачи» ветка тоже нужна — иначе внешний сотрудник
  // не найдёт запрос, пока идёт сбор.
  const pressIds = viewer.pressTaskIds ?? [];
  // Внешний участник сбора видит карточку для нажатия, но конфиденциальная
  // задача (#461) остаётся только участникам — свою видимость они получают
  // веткой mineGated, а не этой щелью.
  const pressBranch: Prisma.TaskWhereInput | null =
    pressIds.length > 0
      ? { AND: [{ id: { in: [...pressIds] } }, openOnly, ...(gate ? [gate] : [])] }
      : null;
  if (scope === 'mine') {
    return pressBranch ? { ...alive, OR: [mineGated, pressBranch] } : { ...alive, ...mineGated };
  }
  const or: Prisma.TaskWhereInput[] = [mineGated];
  // Решающий видит задачу, даже не участвуя (#433): только не конфиденциальную
  // и не из скрытого секретного проекта — те же гейты, что у руководителей.
  const deciderIds = viewer.deciderTaskIds ?? [];
  const deciderBranch: Prisma.TaskWhereInput | null =
    deciderIds.length > 0
      ? { AND: [{ id: { in: [...deciderIds] } }, openOnly, ...(gate ? [gate] : [])] }
      : null;
  if (viewer.subordinateIds.length > 0) {
    const subordinateTasks: Prisma.TaskWhereInput = { OR: involves(viewer.subordinateIds) };
    // Подчинённый — участник секретного проекта не раскрывает его задачи
    // начальнику: ветка гейтится скрытыми проектами (Т1) и конфиденциальными.
    or.push({ AND: [subordinateTasks, openOnly, ...(gate ? [gate] : [])] });
  }
  if (viewer.visibleProjectIds.length > 0) {
    or.push({ AND: [{ projectId: { in: [...viewer.visibleProjectIds] } }, openOnly] });
  }
  if (deciderBranch) or.push(deciderBranch);
  if (pressBranch) or.push(pressBranch);
  if (viewer.permissions.includes(Permission.TASK_VIEW_ALL)) {
    // Не ранний return: task.view_all не открывает чужие секретные проекты
    // (Т1) и конфиденциальные задачи (#461) — гейты остаются и у админа.
    // СВОЁ участие сохраняется отдельной веткой: участник конфиденциальной
    // задачи видит её и с task.view_all (иначе деталь/чат отдают 404).
    const rest = gate ? { AND: [gate, openOnly] } : openOnly;
    return {
      ...alive,
      OR: [
        mineGated,
        rest,
        ...(deciderBranch ? [deciderBranch] : []),
        ...(pressBranch ? [pressBranch] : []),
      ],
    };
  }
  return { ...alive, OR: or };
}

@Injectable()
export class ViewerResolver {
  constructor(
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly deciders: TaskDeciders,
    private readonly press: PressRepository,
  ) {}

  async resolve(user: { id: AuthUser['id']; permissions: readonly string[] }): Promise<Viewer> {
    const [subordinateIds, scope, deciderTaskIds, pressTaskIds] = await Promise.all([
      this.org.subordinateIds(user.id),
      this.projects.viewScopeFor(user),
      this.deciders.taskIdsFor(user.id),
      this.press.waitingTaskIds(user.id),
    ]);
    return {
      id: user.id,
      permissions: user.permissions,
      subordinateIds,
      visibleProjectIds: scope.visibleProjectIds,
      hiddenProjectIds: scope.hiddenProjectIds,
      deciderTaskIds,
      pressTaskIds,
    };
  }
}
