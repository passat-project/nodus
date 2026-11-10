import {
  checkWorkflowDocument,
  ErrorCode,
  type ProcessCategory,
  type WorkflowDocument,
  type WorkflowMigration,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type { OrgStructureReader } from '../../../../core/ports/org-structure.port.js';
import type { UserProfileReader } from '../../../../core/ports/user-profile.port.js';
import type { CustomFieldRegistry } from '../../../custom-fields/ports/custom-field-registry.port.js';
import { creationFactsOf } from './creation-facts.js';
import { customFieldFactsOf } from './custom-field-facts.js';
import { checkWorkflowFormulas, hasSlotFormulas } from './workflow-formula-checks.js';
import type { LoadedWorkflow } from '../workflow.repository.js';

/**
 * Серверные проверки публикации (#378, security-чекпоинты ревью): uuid-элементы
 * документа принадлежат этому маршруту; ссылки переходов и цели переносов —
 * живые статусы документа (новые или существующие). Клиентскому `code` сервер
 * не верит — коды читаются только из БД.
 */
export function serverChecksOf(
  loaded: LoadedWorkflow,
  document: WorkflowDocument,
  migrations: readonly WorkflowMigration[],
): void {
  const stageIds = new Set(loaded.stages.map((s) => s.id));
  const docStageIds = new Set(document.stages.map((s) => s.id));
  const foreignStages = document.stages.filter(
    (s) => !s.id.startsWith('new:') && !stageIds.has(s.id),
  );
  if (foreignStages.length > 0) {
    throw new DomainException(ErrorCode.WORKFLOW_INVALID, 'Document references foreign stages');
  }
  const foreignTransitions = document.transitions.filter(
    (t) => !t.id.startsWith('new:') && !loaded.transitions.some((live) => live.id === t.id),
  );
  if (foreignTransitions.length > 0) {
    throw new DomainException(
      ErrorCode.WORKFLOW_INVALID,
      'Document references foreign transitions',
    );
  }
  for (const t of document.transitions) {
    if (t.fromStageId !== null && !docStageIds.has(t.fromStageId)) {
      throw new DomainException(
        ErrorCode.WORKFLOW_INVALID,
        'Transition source is not a stage of the document',
      );
    }
    if (!docStageIds.has(t.toStageId)) {
      throw new DomainException(
        ErrorCode.WORKFLOW_INVALID,
        'Transition target is not a stage of the document',
      );
    }
  }
  for (const m of migrations) {
    if (!stageIds.has(m.fromStageId)) {
      throw new DomainException(
        ErrorCode.WORKFLOW_INVALID,
        'Migration source is not a stage of this workflow',
      );
    }
    if (!docStageIds.has(m.toStageId)) {
      throw new DomainException(
        ErrorCode.WORKFLOW_INVALID,
        'Migration target is not a stage of the document',
      );
    }
  }
}

/** Должности, на которые ссылаются условия решающих (#433) и источники
 *  коллективной кнопки (#434): публикация проверяет их активность/держателей. */
export function collectPositionIds(document: WorkflowDocument): string[] {
  return [
    ...new Set(
      document.transitions.flatMap((transition) => [
        ...transition.rules.conditions.flatMap((condition) =>
          condition.kind === 'decider_in' && condition.source.kind === 'position'
            ? [condition.source.positionId]
            : [],
        ),
        ...(transition.press?.sources.flatMap((source) =>
          source.kind === 'position' ? [source.positionId] : [],
        ) ?? []),
      ]),
    ),
  ];
}

/**
 * Проверка документа на публикации (#378, #431, #432, #632): схема, атрибуты
 * области, привязка к типу маршрута, живые сотрудники в пресетах формы
 * создания и формулы слотов (грамматика + типы движком). Ошибки запрещают
 * публикацию (`422 WORKFLOW_INVALID` с перечнем проблем), предупреждения —
 * нет. Вынесено из сервиса публикации: там остаётся порядок «замок → версия
 * → проверки → план → применение».
 */
export async function checkDocumentForPublish(
  deps: {
    registry: CustomFieldRegistry;
    profiles: UserProfileReader;
    org: OrgStructureReader;
  },
  ctx: {
    document: WorkflowDocument;
    category: ProcessCategory;
    typeId?: string;
    /** Все типы маршрута (#646): привязки проверяются пересечением. */
    typeIds?: readonly string[];
    /** У типа настроена серия номеров (#55): маршрут письма с
     *  `assign_number` без неё публиковать нельзя. */
    numberingConfigured?: boolean;
    tx: TransactionClient;
  },
): Promise<void> {
  const customFields = await customFieldFactsOf(deps.registry, ctx.tx, ctx.typeIds ?? ctx.typeId);
  // Цель «Присвоить номер» (#630): поле обязано быть у типа и быть счётчиком
  // с правилом серии. Без этих фактов проверка contracts — мёртвый код.
  const customFieldIds = customFields.inType ? [...customFields.inType] : undefined;
  const counterFieldIds = customFieldIds
    ? (await deps.registry.definitions({}, ctx.tx))
        .filter(
          (definition) =>
            customFieldIds.includes(definition.id) &&
            definition.type === 'counter' &&
            definition.numbering !== null,
        )
        .map((definition) => definition.id)
    : undefined;
  const creation = await creationFactsOf(
    deps.registry,
    deps.profiles,
    ctx.document.creation,
    ctx.tx,
  );
  const positionIds = collectPositionIds(ctx.document);
  const positions = await deps.org.positionFacts(positionIds, ctx.tx);
  const problems = checkWorkflowDocument(ctx.document, {
    customFields,
    category: ctx.category,
    definitions: creation.definitions,
    activeUserIds: creation.activeUserIds,
    positions,
    // Проект — plain UUID без FK: значение сохраняется и до модуля #52,
    // окно показывает подсказку «недоступно» (веб, projectsAvailable).
    projectsAvailable: true,
    numberingConfigured: ctx.numberingConfigured ?? true,
    ...(customFieldIds ? { customFieldIds } : {}),
    ...(counterFieldIds ? { counterFieldIds } : {}),
  });
  // Формулы слотов (#632, Р12; A8-1): форма AST проверена общей грамматикой,
  // типы и совместимость с типом поля выводит движок — для этого нужен реестр
  // атрибутов (номер → тип). Без формул лишнего чтения реестра нет.
  if (hasSlotFormulas(ctx.document)) {
    const definitions = await deps.registry.definitions({}, ctx.tx);
    problems.push(...checkWorkflowFormulas(ctx.document, { category: ctx.category, definitions }));
  }
  if (problems.some((problem) => problem.severity === 'error')) {
    throw new DomainException(ErrorCode.WORKFLOW_INVALID, 'Workflow document is invalid', {
      problems,
    });
  }
}

/** Полная серверная приёмка документа публикации (#433): проверки документа
 *  (включая должности решающих) + сверка ссылок с живым маршрутом. Возвращает
 *  загруженный маршрут — он нужен плану публикации. */
export async function assertPublishable(
  deps: Parameters<typeof checkDocumentForPublish>[0],
  ctx: Parameters<typeof checkDocumentForPublish>[1] & {
    migrations: readonly WorkflowMigration[];
    load: () => Promise<LoadedWorkflow>;
  },
): Promise<LoadedWorkflow> {
  await checkDocumentForPublish(deps, ctx);
  const loaded = await ctx.load();
  serverChecksOf(loaded, ctx.document, ctx.migrations);
  return loaded;
}
