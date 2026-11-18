import { Inject, Injectable } from '@nestjs/common';
import { Permission, type AuthUser, type SearchSourceType } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { FeatureFlagService } from '../../core/feature-flags/feature-flag.service.js';
import {
  CHAT_MEMBERSHIP_READER,
  type ChatMembershipReader,
} from '../chat/membership-reader.port.js';
import { PROJECT_READER, type ProjectReader } from '../projects/ports/project-reader.port.js';
import {
  TASK_VIEWER_READER,
  type TaskSearchScope,
  type TaskViewerReader,
} from '../tasks/ports/task-viewer.port.js';

/** Контекст pre-filter: SQL по алиасу `doc` + включённые типы. */
export interface SearchVisibility {
  /** SQL-условие видимости строки проекции (алиас таблицы — `doc`). */
  sql: Prisma.Sql;
  enabledTypes: SearchSourceType[];
}

/** Типы источников по фичефлагу модуля; сотрудники — ядро (право решает). */
const TYPE_BY_FLAG: ReadonlyArray<{ type: SearchSourceType; flag: string }> = [
  { type: 'task', flag: 'tasks' },
  { type: 'letter', flag: 'correspondence' },
  { type: 'message', flag: 'chat' },
  { type: 'project', flag: 'projects' },
];

/**
 * Pre-filter видимости (#952, Р4): наборы берутся у модулей-владельцев
 * портами (никаких копий правил в SQL, кроме формул строки проекции), и
 * применяются ДО ранжирования и лимита — «пустой выдачи после отсева» не
 * бывает. Golden-матрица `test/integration/search.integration.test.ts` сверяет
 * формулы с `visibleTasksWhere`, `canViewLetter`, `readableConversationIds` и
 * `viewScopeFor`.
 *
 * Формулы строки (семантика полей — `search-source.port.ts`):
 * - задача: участие ∪ (не конфиденциальная ∧ (ветка подчинённых ∪ видимый
 *   проект ∪ решающий ∪ сбор отметок ∪ task.view_all)); ветви вне «моего
 *   участия» гейтятся скрытыми секретными проектами — как `visibleTasksWhere`;
 * - письмо: зарегистрированное (или право регистрации) ∧ (не конфиденциальное
 *   или участник/регистратор/адресат/право `correspondence.view_confidential`);
 * - сообщение: только читаемые беседы (членство без hidden ∪ чаты задач, где
 *   пользователь решающий и задача ему видима);
 * - проект: множество видимых проектов; сотрудник: `directory.read`.
 */
@Injectable()
export class SearchVisibilityService {
  constructor(
    private readonly flags: FeatureFlagService,
    @Inject(TASK_VIEWER_READER) private readonly tasks: TaskViewerReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(CHAT_MEMBERSHIP_READER) private readonly chat: ChatMembershipReader,
  ) {}

  async build(actor: AuthUser): Promise<SearchVisibility> {
    const enabled = await this.enabledTypes();
    const [taskScope, projectScope, readableConversations] = await Promise.all([
      enabled.includes('task') || enabled.includes('project')
        ? this.tasks.resolve(actor)
        : Promise.resolve(null),
      enabled.includes('task') || enabled.includes('project')
        ? this.projects.viewScopeFor(actor)
        : Promise.resolve(null),
      enabled.includes('message')
        ? this.chat.readableConversationIds(actor.id)
        : Promise.resolve<string[]>([]),
    ]);
    return {
      enabledTypes: enabled,
      sql: this.buildSql(actor, {
        enabled,
        taskScope,
        visibleProjectIds: projectScope?.visibleProjectIds ?? [],
        hiddenProjectIds: projectScope?.hiddenProjectIds ?? [],
        readableConversations,
      }),
    };
  }

  private async enabledTypes(): Promise<SearchSourceType[]> {
    const enabled: SearchSourceType[] = ['employee'];
    for (const { type, flag } of TYPE_BY_FLAG) {
      if (await this.flags.isEnabled(flag)) enabled.push(type);
    }
    return enabled;
  }

  private buildSql(
    actor: AuthUser,
    ctx: {
      enabled: SearchSourceType[];
      taskScope: TaskSearchScope | null;
      visibleProjectIds: readonly string[];
      hiddenProjectIds: readonly string[];
      readableConversations: readonly string[];
    },
  ): Prisma.Sql {
    const hasDirectoryRead = actor.permissions.includes(Permission.DIRECTORY_READ);
    const canRegister = actor.permissions.includes(Permission.CORRESPONDENCE_REGISTER);
    const canViewConfidential = actor.permissions.includes(
      Permission.CORRESPONDENCE_VIEW_CONFIDENTIAL,
    );
    const projectVisible = this.uuidIn('doc.project_id', ctx.visibleProjectIds);
    const conversationReadable = this.uuidIn('doc.conversation_id', ctx.readableConversations);

    // Скрытые секретные проекты гейтят ветви вне «моего участия» — буквально
    // как `notHiddenProjectIds` в visibleTasksWhere (NULL NOT IN — ловушка).
    const hiddenGate =
      ctx.hiddenProjectIds.length === 0
        ? Prisma.sql`TRUE`
        : Prisma.sql`(doc.project_id IS NULL OR doc.project_id <> ALL(${[...ctx.hiddenProjectIds]}::uuid[]))`;
    const me = Prisma.sql`ARRAY[${actor.id}]::uuid[]`;
    const task = ctx.taskScope;
    const taskBranches = task
      ? Prisma.sql`(
          (doc.participant_ids @> ${me} AND ${hiddenGate})
          OR (
            doc.confidential = false
            AND ${hiddenGate}
            AND (
              ${this.uuidIn('doc.source_id', task.deciderTaskIds)}
              OR ${this.uuidIn('doc.source_id', task.pressTaskIds)}
              OR ${this.uuidIn('doc.participant_ids', task.subordinateIds, '&&')}
              ${task.viewAll ? Prisma.sql`OR TRUE` : Prisma.empty}
            )
          )
          OR (doc.confidential = false AND ${projectVisible})
        )`
      : Prisma.sql`FALSE`;

    return Prisma.sql`(
      (doc.acl_kind = 'portal' AND ${hasDirectoryRead ? Prisma.sql`TRUE` : Prisma.sql`FALSE`})
      OR (doc.acl_kind = 'project' AND ${projectVisible})
      OR (doc.acl_kind = 'conversation' AND ${conversationReadable})
      OR (
        doc.acl_kind = 'letter'
        AND (${canRegister ? Prisma.sql`TRUE` : Prisma.sql`doc.registered`})
        AND (
          doc.confidential = false
          OR ${canViewConfidential ? Prisma.sql`TRUE` : Prisma.sql`FALSE`}
          OR doc.author_id = ${actor.id}::uuid
          OR doc.participant_ids @> ${me}
        )
      )
      OR (doc.acl_kind = 'task' AND ${taskBranches})
    )`;
  }

  /** `col = ANY($ids)` или FALSE для пустого набора (`op='&&'` — пересечение
   *  массива с массивом: ветка «участник из подчинённых»). */
  private uuidIn(column: string, ids: readonly string[], op: '=' | '&&' = '='): Prisma.Sql {
    if (ids.length === 0) return Prisma.sql`FALSE`;
    const raw = Prisma.raw(column);
    return op === '&&'
      ? Prisma.sql`${raw} && ${this.uuidArray(ids)}`
      : Prisma.sql`${raw} = ANY(${this.uuidArray(ids)})`;
  }

  private uuidArray(ids: readonly string[]): Prisma.Sql {
    return Prisma.sql`ARRAY[${Prisma.join(ids)}]::uuid[]`;
  }
}
