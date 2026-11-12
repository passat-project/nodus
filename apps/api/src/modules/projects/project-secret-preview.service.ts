import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, ProjectSecretPreview } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { assertProjectVisible, isManagement } from './project-members.access.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';

type ProjectSecretPreviewRole = ProjectSecretPreview['willBecomeMembers'][number]['roles'][number];

/**
 * Предпросмотр перевода проекта в секретный (#541, решение владельца п.4):
 * кто останется участником (носители ролей задач и решающие с ожидающим
 * действием) и кто потеряет доступ (наблюдатели задач вне состава и
 * самовступившие). Вынесено из ProjectMembersService ради лимита файла (I5).
 * Права — руководство проекта или project.manage.
 */
@Injectable()
export class ProjectSecretPreviewService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    @Inject(TASK_PROJECT_READER) private readonly tasks: TaskProjectReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  async secretPreview(user: AuthUser, projectId: string): Promise<ProjectSecretPreview> {
    await assertProjectVisible(user, projectId, this.projects, this.participants);
    const rows = await this.participants.rowsOfProject(projectId);
    if (!isManagement(rows, user)) {
      throw DomainException.forbidden('Only project management can manage members');
    }
    // viewerId фильтрует конфиденциальные задачи (#461): чужую задачу
    // руководитель не видит даже в списках; конвертация идёт без фильтра.
    const staffing = await this.tasks.staffingOf(projectId, { viewerId: user.id });
    const byUser = new Map<string, { roles: Set<ProjectSecretPreviewRole>; taskCount: number }>();
    for (const holder of staffing.holders) {
      byUser.set(holder.userId, { roles: new Set(holder.roles), taskCount: holder.taskCount });
    }
    for (const id of staffing.deciderIds) {
      const existing = byUser.get(id);
      if (existing) existing.roles.add('decider');
      else byUser.set(id, { roles: new Set(['decider']), taskCount: 0 });
    }
    const participants = new Map(rows.map((row) => [row.userId, row]));
    const lose: { userId: string; kind: 'observer' | 'joined'; taskCount: number }[] = [];
    for (const observer of staffing.observers) {
      if (!participants.has(observer.userId) && !byUser.has(observer.userId)) {
        lose.push({ userId: observer.userId, kind: 'observer', taskCount: observer.taskCount });
      }
    }
    for (const row of rows) {
      if (row.source === 'observer' && row.observerKind === 'joined' && !byUser.has(row.userId)) {
        lose.push({ userId: row.userId, kind: 'joined', taskCount: 0 });
      }
    }
    const ids = [...new Set([...byUser.keys(), ...lose.map((item) => item.userId)])];
    const refs = new Map((await this.profiles.findRefs(ids)).map((ref) => [ref.id, ref]));
    const userRef = (id: string) => refs.get(id) ?? { id, displayName: '', avatarUrl: null };
    const byName = (a: { user: { displayName: string } }, b: { user: { displayName: string } }) =>
      a.user.displayName.localeCompare(b.user.displayName, 'ru');
    return {
      willBecomeMembers: [...byUser]
        .map(([userId, value]) => ({
          user: userRef(userId),
          roles: [...value.roles],
          taskCount: value.taskCount,
        }))
        .sort(byName),
      willLoseAccess: lose
        .map((item) => ({
          user: userRef(item.userId),
          kind: item.kind,
          taskCount: item.taskCount,
        }))
        .sort(byName),
    };
  }
}
