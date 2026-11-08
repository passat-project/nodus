import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldValues } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type {
  WorkflowActor,
  WorkflowActorSubject,
  WorkflowEntityAdapter,
  WorkflowEntityStage,
  WorkflowFormApplied,
  WorkflowGateFacts,
  WorkflowStageChangeMeta,
} from '../../../core/ports/workflow-entity.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { LettersRepository } from '../letters/letters.repository.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import type { NumberTarget } from '../../custom-fields/ports/number-host.port.js';
import { CORRESPONDENCE_EVENTS } from '@nodus/contracts';
import { LetterFormApplier } from './letter-form.applier.js';
import { LetterStageMover } from './letter-stage.mover.js';

/** Пачка фонового переноса писем (как у задач: своя транзакция на пачку). */
const MIGRATION_BATCH = 50;

/**
 * Адаптер письма для движка «Процессы» (#55, Р1/Р6, ADR-0024): движок не
 * знает таблиц писем — роли, факты и запись смены стадии отдаёт этот класс.
 * Гейтов у писем в #55 нет (факты нейтральные), роли — регистратор, адресат,
 * участник обсуждения и автор (только у исходящих).
 */
@Injectable()
export class LetterWorkflowAdapter implements WorkflowEntityAdapter {
  static readonly workflowCategory = 'letter';
  readonly category = 'letter';

  constructor(
    private readonly letters: LettersRepository,
    private readonly applier: LetterFormApplier,
    private readonly mover: LetterStageMover,
    private readonly txRunner: TransactionRunner,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly events: EventBus,
  ) {}

  async lock(tx: TransactionClient, letterId: string): Promise<void> {
    await this.letters.lock(tx, letterId);
  }

  async subject(
    tx: TransactionClient,
    letterId: string,
    actor: WorkflowActor,
  ): Promise<WorkflowActorSubject> {
    const letter = await this.letters.findDetailById(letterId, tx);
    if (!letter) throw DomainException.notFound('Letter not found');
    const participants = await this.letters.participants(letterId);
    const roles = new Set<string>();
    if (letter.registrarId === actor.id) roles.add('registrar');
    if (letter.addresseeId === actor.id) roles.add('addressee');
    if (participants.some((p) => p.userId === actor.id)) roles.add('participant');
    if (letter.direction === 'outgoing' && letter.createdBy === actor.id) roles.add('author');
    const definitions = await this.customFields.definitions(
      { target: { kind: 'process_type', id: letter.typeId } },
      tx,
    );
    return {
      workflowId: letter.workflowId,
      typeId: letter.typeId,
      stageId: letter.stageId,
      roles,
      bypassConditions: false,
      canOverrideGates: false,
      actsWithoutConditions: false,
      facts: this.factsOf(
        letter.stageId,
        letter.customFields,
        definitions.map((d) => d.id),
      ),
    };
  }

  async applyForm(
    tx: TransactionClient,
    letterId: string,
    actor: WorkflowActor,
    input: { registration?: unknown },
  ): Promise<WorkflowFormApplied> {
    const letter = await this.letters.findDetailById(letterId, tx);
    if (!letter) throw DomainException.notFound('Letter not found');
    return this.applier.apply(tx, letter, actor, input);
  }

  async applyStage(
    tx: TransactionClient,
    letterId: string,
    target: WorkflowEntityStage,
    actorId: string | null,
    meta: WorkflowStageChangeMeta,
  ): Promise<void> {
    const letter = await this.letters.findDetailById(letterId, tx);
    if (!letter) throw DomainException.notFound('Letter not found');
    await this.mover.apply(tx, letter, target, actorId, meta);
  }

  countByStages(stageIds: readonly string[]): Promise<Record<string, number>> {
    return this.letters.countByStages(stageIds);
  }

  /** Перенос писем архивированной стадии (публикация/смена группы стадии). */
  async migrateStage(fromStageId: string, toStage: WorkflowEntityStage): Promise<number> {
    let moved = 0;
    let afterId: string | null = null;
    for (;;) {
      const batch = await this.letters.byStagePage(fromStageId, afterId, MIGRATION_BATCH);
      if (batch.length === 0) return moved;
      for (const row of batch) {
        await this.txRunner.run(async (tx) => {
          const letter = await this.letters.findDetailById(row.id, tx);
          if (!letter || letter.stageId !== fromStageId) return;
          // Имя исходной стадии не передаём: у миграции его нет под рукой,
          // а UUID в поле имени попал бы в историю (код-ревью #55).
          await this.mover.apply(tx, letter, toStage, null, {
            transitionId: null,
            cause: 'workflow_migration',
            transitionName: 'Перенос статуса',
          });
        });
        moved += 1;
      }
      afterId = batch[batch.length - 1]!.id;
      if (batch.length < MIGRATION_BATCH) return moved;
    }
  }

  restateStage(stageId: string, systemState: string): Promise<number> {
    return this.letters.restateStage(stageId, systemState);
  }

  /** Факты писем (#55): гейтов нет — значения нейтральные; атрибуты живые. */
  private factsOf(
    stageId: string,
    customFields: unknown,
    activeCustomFieldIds: readonly string[],
  ): WorkflowGateFacts {
    return {
      stageId,
      acceptRequired: false,
      creatorIsAssignee: false,
      openSubtasks: 0,
      reviewSubtasks: 0,
      checklistDone: 0,
      checklistTotal: 0,
      spentMinutes: 0,
      description: '',
      deadline: null,
      assigneeId: null,
      plannedMinutes: null,
      hasResult: false,
      resultFileCount: 0,
      customFields: (customFields ?? {}) as CustomFieldValues,
      activeCustomFieldIds: new Set(activeCustomFieldIds),
    };
  }

  async numberTarget(tx: TransactionClient, letterId: string): Promise<NumberTarget> {
    const letter = await this.letters.findDetailById(letterId, tx);
    if (!letter) throw DomainException.notFound('Letter not found');
    const contexts = letter.projectId
      ? await this.projects.numberContext([letter.projectId], [], tx)
      : { projects: [], nodes: [] };
    const project = contexts.projects[0];
    return {
      host: 'letter',
      typeId: letter.typeId,
      folders: [],
      projectId: project?.id ?? null,
      portfolioId: project?.portfolioId ?? null,
      projectTypeId: project?.typeId ?? null,
      parentTaskId: null,
      sources: {
        self: (letter.customFields ?? {}) as Record<string, unknown>,
        project: project?.values ?? null,
      },
    };
  }

  async applyNumbers(
    tx: TransactionClient,
    letterId: string,
    actorId: string,
    numbers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const letter = await this.letters.findDetailById(letterId, tx);
    if (!letter) return;
    const next = { ...((letter.customFields ?? {}) as Record<string, unknown>), ...numbers };
    await this.letters.update(tx, letterId, { customFields: next as never });
    await this.events.emit(
      tx,
      CORRESPONDENCE_EVENTS.LETTER_UPDATED,
      {
        letterId,
        changes: Object.entries(numbers).map(([fieldId, display]) => ({
          field: `cf.${fieldId}`,
          from: null,
          to: display,
        })),
      },
      { actorId, aggregateType: 'letter', aggregateId: letterId },
    );
  }
}
