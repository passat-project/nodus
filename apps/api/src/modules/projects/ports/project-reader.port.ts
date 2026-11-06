import type { ProjectRef, ProjectRole } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Read-порт проектов для чужих модулей (ADR-0012, #52 Р11): задачи
 * (видимость, валидация привязок, права руководства), корреспонденция
 * (гидратация letter.project), custom-fields (значения-ссылки на проекты),
 * chat (канал проекта). Потребитель не трогает таблицы проектов (I3/I6);
 * реализация — project-reader.provider.ts, экспорт — ProjectsPortsModule.
 *
 * Порт жив и при выключенном флаге `projects` (нейтрален: пустые множества,
 * refs без строк, проверки пропускают) — задачи и письма продолжают
 * работать, I10 (паттерн counterparty-reader.port.ts).
 */
export const PROJECT_READER = Symbol('PROJECT_READER');

export interface ProjectActor {
  id: string;
  permissions: readonly string[];
}

/** Множества видимости задач (Р3): OR-ветка и гейт NOT IN. */
export interface ProjectViewScope {
  /** Открытые проекты + секретные участия актёра. */
  visibleProjectIds: string[];
  /** Секретные без участия и без project.view_secret. */
  hiddenProjectIds: string[];
}

export interface ProjectReader {
  /** Ссылки проектов, видимых актёру; невидимые — пропущены (без оракула). */
  refsFor(actor: ProjectActor, ids: readonly string[]): Promise<ProjectRef[]>;

  /** Множества видимости задач актёра; флаг выключен — оба пусты. */
  viewScopeFor(actor: ProjectActor): Promise<ProjectViewScope>;

  /** То же без TTL-кэша (#646): путь ЗАПИСИ значения-ссылки не должен
   *  принимать узел проекта, только что ушедшего в секретные, из-за
   *  5-секундного окна кэша (у задач этот путь уже обходит кэш). */
  freshViewScopeFor(actor: ProjectActor): Promise<ProjectViewScope>;

  /** Привязка задачи к проекту доступна актёру: проект существует, не в
   *  архиве и виден (открытый/участие/view_secret); иначе — 422 (#432, Р5). */
  assertTaskProjectVisible(actor: ProjectActor, projectId: string): Promise<void>;

  /** Проект пригоден для привязки письма: существует и не в архиве.
   *  Видимость актёра НЕ требуется — служебное действие канцелярии;
   *  DTO фильтрует ссылку по видимости смотрящего (Р13, #52). */
  assertProjectAttachable(projectId: string): Promise<void>;

  /** Люди задачи секретного проекта: все должны состоять в проекте (любой
   *  источник), иначе 422 (вердикт 29.10). Открытый/флаг выкл — пропуск. */
  assertMembersAllowed(projectId: string, userIds: readonly string[]): Promise<void>;

  /** Права руководства проекта на задачи (Р12): supervisor — уровень
   *  постановщика на все задачи проекта. */
  projectTaskRights(actorId: string, projectId: string): Promise<{ supervisor: boolean }>;

  /** Узел пригоден задаче этого проекта: существует и принадлежит проекту;
   *  архивный проект — 400 (структура заморожена); иначе — 422
   *  PROJECT_NODE_INVALID без оракула существования (#467). */
  assertNodeAllowed(projectId: string, nodeId: string): Promise<void>;

  /** Сериализует привязку задачи к узлу с мутациями структуры: тот же
   *  advisory-лок проекта, что create/move/delete узла (#467). Без него
   *  удаление пустого узла и параллельное назначение задачи дают висячий
   *  `tasks.node_id` — задача исчезает из дерева. */
  lockNodeStructure(tx: TransactionClient, projectId: string): Promise<void>;

  /** Видимость проекта (для гейта выноса задачи из секретного). */
  visibilityOf(projectId: string): Promise<'open' | 'secret' | null>;

  /** Роли сотрудника в проектах (#433): источник решающих «роль в проекте».
   *  `participant` объединяет `task` и `member`; нет строки — роли нет. */
  rolesIn(
    userId: string,
    projectIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<Record<string, ProjectRole[]>>;

  /** Кто держит роль в проекте (#433): обратное направление для адресатов
   *  уведомлений «Ждёт вашего решения». */
  usersWithRoles(
    projectId: string,
    roles: readonly ProjectRole[],
    tx?: TransactionClient,
  ): Promise<string[]>;
}

/**
 * Read-порт проектов для чата (Р8): канал проекта `type='project_channel'` —
 * состав = участники проекта, публикация — руководство + project.channel.post.
 */
export const PROJECT_CHAT_READER = Symbol('PROJECT_CHAT_READER');

export interface ProjectChatReader {
  /** Состав roster'а канала: уникальные участники всех источников +
   *  руководитель; null — проекта нет. */
  roster(projectId: string): Promise<{ managerId: string; memberIds: string[] } | null>;

  /** Проект виден акту (участие или view_secret) — открытие канала. */
  canView(projectId: string, actor: ProjectActor): Promise<boolean>;

  /** Право публикации в канал: руководство проекта или project.channel.post. */
  canPost(projectId: string, actor: ProjectActor): Promise<boolean>;

  /** Ссылки проектов для строк списка бесед (видимость гарантирует
   *  членство в беседе — здесь проверка не нужна). */
  refs(ids: readonly string[]): Promise<ProjectRef[]>;
}
