import { Inject, Injectable } from '@nestjs/common';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';
import type {
  CustomFieldRef,
  ProjectDetail,
  ProjectListItem,
  ProjectMyMembership,
  ProjectTypeRef,
  ProjectVisibility,
  ProjectStatus,
  UserRef,
} from '@nodus/contracts';

import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../crm/ports/counterparty-reader.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import {
  FORMULA_CELLS,
  type FormulaCells,
  type FormulaHostState,
} from '../custom-fields/ports/formula-cells.port.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import {
  myMembership,
  projectAccess,
  type MembershipRow,
  type ProjectFacts,
} from './project-access.js';
import type { ProjectRow } from './projects.repository.js';

export interface ProjectViewer {
  id: string;
  permissions: readonly string[];
}

/** Строка журнала/карточки без ссылок (состав — отдельным запросом). */
export interface ProjectDtoInput {
  row: ProjectRow;
  participants: readonly MembershipRow[];
  viewer: ProjectViewer;
}

function toFacts(row: ProjectRow): ProjectFacts {
  return {
    managerId: row.managerId,
    assistantIds: Array.isArray(row.assistantIds) ? (row.assistantIds as string[]) : [],
    visibility: row.visibility as ProjectVisibility,
    status: row.status as ProjectStatus,
  };
}

/**
 * Гидратация DTO проектов: ссылки сотрудников/заказчика, моё участие и
 * права. Рефы собираются пачками через порты (I3): USER_PROFILE_READER,
 * COUNTERPARTY_READER, CUSTOM_FIELD_REGISTRY.
 */
@Injectable()
export class ProjectDtoMapper {
  constructor(
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    private readonly nodes: ProjectNodesRepository,
    @Inject(TASK_PROJECT_READER) private readonly taskReader: TaskProjectReader,
    // Формульное состояние ячеек карточки (#632, Р9): значок fx/ошибка.
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
  ) {}

  async toListItems(inputs: ProjectDtoInput[]): Promise<ProjectListItem[]> {
    if (inputs.length === 0) return [];
    const userIds = new Set<string>();
    for (const { row, participants } of inputs) {
      userIds.add(row.managerId);
      userIds.add(row.creatorId);
      for (const id of toFacts(row).assistantIds) userIds.add(id);
      for (const id of [...new Set(participants.map((p) => p.userId))].slice(0, 5)) userIds.add(id);
    }
    const states = await this.formulas.stateFor(
      'project',
      inputs.map(({ row }) => row.id),
      undefined,
      new Map(inputs.map(({ row }) => [row.id, row.typeId])),
    );
    // Заказчик — по ЭФФЕКТИВНОМУ значению: формула типа может считать его,
    // и тогда в сырой строке его нет (иначе client=null при видимой колонке).
    const effectiveOf = (row: ProjectDtoInput['row']) => ({
      ...(row.customFields as Record<string, unknown>),
      ...((states.get(row.id)?.values ?? {}) as Record<string, unknown>),
    });
    const clientIds = [
      ...new Set(
        inputs.map((i) => clientOf(effectiveOf(i.row))).filter((id): id is string => id !== null),
      ),
    ];
    const [userRefs, clientRefs] = await Promise.all([
      this.profiles.findRefs([...userIds]),
      this.counterparties.refs(clientIds),
    ]);
    const users = new Map(userRefs.map((ref) => [ref.id, ref]));
    const clients = new Map(clientRefs.map((ref) => [ref.id, ref]));
    // Ссылки — по эффективным значениям (формулы типа считаются на чтении):
    // ref-значение формулы получает имя в колонке журнала проектов.
    const attributeRefs = await this.customFields.refsMany(
      inputs.map(
        ({ row }) =>
          ({
            ...(row.customFields as Record<string, never>),
            ...((states.get(row.id)?.values ?? {}) as Record<string, never>),
          }) as never,
      ),
      inputs[0]!.viewer,
    );
    return inputs.map(({ row, participants, viewer }) =>
      this.listItem(row, participants, viewer, users, clients, {
        refs: attributeRefs,
        ...(states.has(row.id) ? { state: states.get(row.id)! } : {}),
      }),
    );
  }

  async toDetail(input: ProjectDtoInput): Promise<ProjectDetail> {
    const { row, participants, viewer } = input;
    const observerIds = [
      ...new Set(
        participants.filter((entry) => entry.source === 'observer').map((entry) => entry.userId),
      ),
    ];
    const facts = toFacts(row);
    const states = await this.formulas.stateFor(
      'project',
      [row.id],
      undefined,
      new Map([[row.id, row.typeId]]),
    );
    const state = states.get(row.id);
    // Эффективные значения: формулы типа/вида считаны на чтении (Р6).
    const effective = {
      ...(row.customFields as Record<string, never>),
      ...((state?.values ?? {}) as Record<string, never>),
    } as Record<string, never>;
    const userIds = new Set<string>([row.managerId, row.creatorId, ...facts.assistantIds]);
    for (const id of [...new Set(participants.map((entry) => entry.userId))].slice(0, 5)) {
      userIds.add(id);
    }
    const clientId = clientOf(effective);
    const [refs, creatorRefs, observerRefs, userRefs, clientRefs] = await Promise.all([
      this.customFields.refs(effective, viewer),
      this.profiles.findRefs([row.creatorId]),
      this.profiles.findRefs(observerIds),
      this.profiles.findRefs([...userIds]),
      clientId ? this.counterparties.refs([clientId]) : Promise.resolve([]),
    ]);
    const users = new Map(userRefs.map((ref) => [ref.id, ref]));
    const clients = new Map(clientRefs.map((ref) => [ref.id, ref]));
    const item = this.listItem(row, participants, viewer, users, clients, {
      refs,
      ...(state ? { state } : {}),
    });
    const membership = myMembership(participants, viewer.id);
    // Сводка структуры (#467): дефолт вкладки — «Структура», когда есть
    // узлы с прямыми задачами-детьми (вердикт 07.11). Узлов нет — второй
    // запрос не нужен.
    const nodeCount = await this.nodes.countByProject(row.id);
    const hasTaskNodes = nodeCount > 0 ? await this.taskReader.hasNodeTasks(row.id) : false;
    return {
      ...item,
      description: row.description,
      creator:
        creatorRefs[0] ??
        ({ id: row.creatorId, displayName: '', avatarUrl: null } satisfies UserRef),
      observers: observerIds.map(
        (id) =>
          observerRefs.find((ref) => ref.id === id) ??
          ({ id, displayName: '', avatarUrl: null } satisfies UserRef),
      ),
      startDate: row.startedAt?.toISOString().slice(0, 10) ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      // Карточка требует значения и ссылки явно (деталь ≠ список).
      customFields: effective,
      customFieldRefs: [...refs],
      ...(state ? { customFieldFormulas: state.formulas } : {}),
      access: projectAccess(toFacts(row), membership, viewer.permissions),
      structureSummary: { nodeCount, hasTaskNodes },
      createdAt: row.createdAt.toISOString(),
    };
  }

  private listItem(
    row: ProjectRow,
    participants: readonly MembershipRow[],
    viewer: ProjectViewer,
    users: Map<string, UserRef>,
    clients: Map<string, { id: string; name: string }>,
    attributes?: { refs: readonly CustomFieldRef[]; state?: FormulaHostState },
  ): ProjectListItem {
    const facts = toFacts(row);
    const membership: ProjectMyMembership = myMembership(participants, viewer.id);
    const roster = participants.filter((entry) => entry.source !== 'observer');
    const fallback = (id: string): UserRef => ({ id, displayName: '', avatarUrl: null });
    // Эффективные значения: формулы типа/вида считаны на чтении (Р6) —
    // системный «Шифр»/«Заказчик» тоже может быть формулой.
    const values = {
      ...(row.customFields as Record<string, never>),
      ...((attributes?.state?.values ?? {}) as Record<string, never>),
    };
    return {
      id: row.id,
      code: codeOf(values),
      name: row.name,
      color: row.color as ProjectListItem['color'],
      manager: row.managerId ? (users.get(row.managerId) ?? fallback(row.managerId)) : null,
      assistants: facts.assistantIds.map((id) => users.get(id) ?? fallback(id)),
      myMembership: membership,
      visibility: facts.visibility,
      status: facts.status,
      type: row.type ? ({ id: row.type.id, name: row.type.name } satisfies ProjectTypeRef) : null,
      portfolio: row.portfolio ? { id: row.portfolio.id, name: row.portfolio.name } : null,
      client: (() => {
        const clientId = clientOf(values);
        return clientId ? (clients.get(clientId) ?? null) : null;
      })(),
      // «Участники» — roster БЕЗ наблюдателей: наблюдатель видит проект без
      // прав правки и живёт отдельным полем карточки (вердикт 07.11.2026).
      membersCount: new Set(roster.map((p) => p.userId)).size,
      membersPreview: [...new Set(roster.map((p) => p.userId))]
        .slice(0, 5)
        .map((id) => users.get(id) ?? fallback(id)),
      endDate: row.endsAt?.toISOString().slice(0, 10) ?? null,
      activityAt: row.updatedAt.toISOString(),
      // Атрибуты строки журнала (#632, Р9): значения с формулами типа,
      // ссылки и формульное состояние — колонки без отдельных запросов.
      ...(attributes
        ? {
            customFields: values,
            customFieldRefs: [...attributes.refs],
            ...(attributes.state ? { customFieldFormulas: attributes.state.formulas } : {}),
          }
        : {}),
    };
  }
}

/** Шифр проекта из значений атрибутов (системный «Шифр», Р9 #631). */
function codeOf(customFields: unknown): string | null {
  if (customFields === null || typeof customFields !== 'object') return null;
  const value = (customFields as Record<string, unknown>)[SYSTEM_FIELD_IDS.projectCode];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Заказчик проекта из значений атрибутов (системный «Заказчик», Р9 #631). */
function clientOf(customFields: unknown): string | null {
  if (customFields === null || typeof customFields !== 'object') return null;
  const value = (customFields as Record<string, unknown>)[SYSTEM_FIELD_IDS.projectClient];
  return typeof value === 'string' && value !== '' ? value : null;
}
