import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ProcessCategory,
  type TransitionFormInput,
  type WorkflowTransition,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type {
  WorkflowActor,
  WorkflowActorSubject,
  WorkflowFormApplied,
  WorkflowStageChangeMeta,
} from '../../../../core/ports/workflow-entity.port.js';
import type {
  TransitionChoice,
  TransitionExecution,
  WorkflowEnginePort,
} from '../../ports/workflow-engine.port.js';
import { NumberSeriesService } from '../../numbering/number-series.service.js';
import {
  effectiveTargetId,
  evaluateValidators,
  outgoingTransitions,
  passesConditions,
  type TargetContext,
  type TransitionDef,
} from '../transition-rules.js';
import { approverContext } from './approver-context.js';
import * as exec from './transition-execution-helpers.js';
import { checkFormInput, windowOf } from '../transition-form.js';
import { WorkflowEntityRegistry } from './entity-adapter.registry.js';
import { TransitionRecordsRepository } from './transition-records.repository.js';
import { WorkflowRepository, type LoadedWorkflow, type StageRow } from '../workflow.repository.js';

/**
 * Движок маршрутов «Процессов» (ADR-0020/ADR-0024): доступные переходы
 * (кнопки с причинами блокировки, показом и итогом цели) и выполнение
 * перехода в транзакции вызывающего — блокировка сущности, условия, окно
 * перехода (#380), гейты (обход — флаг адаптера + причина), смена стадии
 * адаптером, запись общего журнала `transition_records`. Движок не знает ни
 * таблиц сущностей, ни их прав и ролей: всё это отдаёт адаптер (порт
 * `WorkflowEntityAdapter`). Журнал пишет движок — таблица модуля «Процессы».
 */
/** Субъект адаптера + права актора: движок заполняет `permissions` сам —
 *  условия `permission` проверяются одинаково в `available` и `execute`. */
type EngineSubject = WorkflowActorSubject & { permissions: readonly string[] };
@Injectable()
export class WorkflowEngine implements WorkflowEnginePort {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly adapters: WorkflowEntityRegistry,
    private readonly records: TransitionRecordsRepository,
    private readonly numbers: NumberSeriesService,
  ) {}

  async available(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
  ): Promise<WorkflowTransition[]> {
    const { workflow, subject } = await this.context(tx, entityId, category, actor);
    return this.options(workflow, subject, approverContext(workflow, subject));
  }

  async execute(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
    choice: TransitionChoice,
    opts: { override?: boolean; reason?: string; form?: TransitionFormInput } = {},
  ): Promise<TransitionExecution> {
    const adapter = this.adapters.get(category);
    await adapter.lock(tx, entityId);
    const subject0 = await this.subjectWithPermissions(tx, entityId, category, actor);
    const workflow = await this.workflows.load(subject0.workflowId, tx);
    const targetCtx = approverContext(workflow, subject0);
    const candidates = outgoingTransitions(
      workflow.transitions,
      subject0.facts,
      workflow.stages,
      targetCtx,
    )
      .filter((t) => passesConditions(t.rules, subject0))
      .filter((t) => this.matches(t, choice, subject0, workflow, targetCtx));
    if (candidates.length === 0) {
      // Имя текущего статуса — клиент собирает понятную строку (I15):
      // «Из статуса «В работе» так перейти нельзя» (перенос в «Моём плане»).
      const from = workflow.stages.find((s) => s.id === subject0.stageId);
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
        'Transition not allowed',
        {
          ...(from ? { fromStageName: from.name } : {}),
        },
      );
    }

    const picked = this.pick(candidates, choice, opts.form);
    const applied = await this.applyForm(adapter, category, tx, entityId, actor, picked, opts.form);
    // Гейты видят факты после окна; условия «кто» — по состоянию до окна.
    const subject1 = exec.hasApplied(applied)
      ? await this.subjectWithPermissions(tx, entityId, category, actor)
      : subject0;
    // Роли/права — до окна (окно не делает актора утверждающим), факты — после.
    const targetCtx1 = approverContext(workflow, {
      ...subject1,
      roles: subject0.roles,
      permissions: subject0.permissions,
    });
    // Выбранная кнопка — первой: DnD предпочёл кандидата без обязательного
    // окна, и гейты не должны «переиграть» выбор на другую кнопку.
    const ordered = [picked, ...candidates.filter((t) => t.id !== picked.id)];
    const scored = ordered.map((t) => ({
      t,
      reasons: evaluateValidators(t.rules, subject1.facts),
    }));
    const pick = scored.find((s) => s.reasons.length === 0) ?? scored[0]!;
    if (pick.reasons.length > 0) this.assertOverride(pick.reasons, subject1, opts);
    const targetFacts = {
      ...subject1.facts,
      creatorIsAssignee: subject0.facts.creatorIsAssignee,
    };
    const target = this.stage(
      workflow,
      effectiveTargetId(pick.t, targetFacts, workflow.stages, targetCtx1),
    );
    // Пост-действие «Присвоить номер» (#55, Р1): номер выдаётся в этой же
    // транзакции ДО смены стадии — откат перехода не сдвигает счётчик.
    const numbering = await exec.assignNumber(this.numbers, tx, subject1, pick.t);
    const recordId = randomUUID();
    const fromStage =
      workflow.stages.find((s) => s.id === subject0.stageId) ??
      (await this.workflows.findStageById(subject0.stageId, tx));
    await adapter.applyStage(tx, entityId, target, actor.id, {
      transitionId: pick.t.id,
      cause: 'transition',
      overriddenGates: pick.reasons.map((r) => r.kind),
      overrideReason: pick.reasons.length > 0 ? opts.reason?.trim() : undefined,
      recordId,
      transitionName: pick.t.name,
      fromStageName: fromStage?.name,
      comment: opts.form?.comment,
      commentLabel: exec.commentLabelOf(pick.t),
      result: applied.result ?? undefined,
      ...(numbering ? { numbering } : {}),
    } satisfies WorkflowStageChangeMeta);
    await this.records.insert(tx, {
      id: recordId,
      entityKind: category,
      entityId,
      transitionId: pick.t.id,
      fromStageId: subject0.stageId,
      toStageId: target.id,
      actorId: actor.id,
      rule: null,
      recordKind: 'transition',
      participantId: null,
      comment: opts.form?.comment ?? null,
      resultId: applied.result?.resultId ?? null,
      fields: numbering
        ? { ...applied.fields, number: { from: null, to: numbering.display } }
        : applied.fields,
      timeEntryId: applied.timeEntryId,
    });
    return { stage: target, recordId };
  }

  /** Выбор кнопки: явная — она; DnD/«Мой план» — первая без обязательного
   *  окна, иначе 422 (жест не открывает окно). */
  private pick(
    candidates: TransitionDef[],
    choice: TransitionChoice,
    form: TransitionFormInput | undefined,
  ): TransitionDef {
    if ('transitionId' in choice) {
      const picked = candidates[0]!;
      this.assertFormAllowed(picked, form);
      return picked;
    }
    const ordered = [...candidates].sort(
      (a, b) => Number(exec.requiresWindow(a)) - Number(exec.requiresWindow(b)),
    );
    const picked = ordered[0]!;
    if (exec.requiresWindow(picked)) {
      const { sections } = windowOf(picked.form, picked.rules);
      const { missing } = checkFormInput(sections, {});
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
        'Transition window is required',
        { transitionId: picked.id, missing, unexpected: [] },
      );
    }
    return picked;
  }

  private assertFormAllowed(t: TransitionDef, form: TransitionFormInput | undefined): void {
    const { sections } = windowOf(t.form, t.rules);
    const { missing, unexpected } = checkFormInput(sections, form ?? {});
    if (missing.length > 0 || unexpected.length > 0) {
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
        'Transition window input does not match its form',
        { transitionId: t.id, missing, unexpected },
      );
    }
  }

  private async applyForm(
    adapter: ReturnType<WorkflowEntityRegistry['get']>,
    category: ProcessCategory,
    tx: TransactionClient,
    entityId: string,
    actor: WorkflowActor,
    t: TransitionDef,
    form: TransitionFormInput | undefined,
  ): Promise<WorkflowFormApplied> {
    if (!form || Object.keys(form).length === 0) return exec.EMPTY_APPLIED;
    // Раздел «Трудозатраты» режима «если ещё не списаны»: сервер решает по
    // факту, а не по вере клиента (запись времени не задваивается).
    if (form.time && t.form?.enabled) {
      const section = t.form.sections.find((s) => s.kind === 'time');
      if (section?.kind === 'time' && section.mode === 'if_empty') {
        const subject = await this.subjectWithPermissions(tx, entityId, category, actor);
        if (subject.facts.spentMinutes > 0) {
          const rest = { ...form };
          delete rest.time;
          if (Object.keys(rest).length === 0) return exec.EMPTY_APPLIED;
          return adapter.applyForm(tx, entityId, actor, rest);
        }
      }
    }
    return adapter.applyForm(tx, entityId, actor, form);
  }

  private assertOverride(
    reasons: { kind: string }[],
    subject: WorkflowActorSubject,
    opts: { override?: boolean; reason?: string },
  ): void {
    if (!opts.override) {
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
        'Transition gates not passed',
        {
          reasons,
        },
      );
    }
    if (!subject.canOverrideGates) {
      throw DomainException.forbidden('Gate override requires task.override_gate');
    }
    if (!opts.reason?.trim()) {
      throw new DomainException(
        ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED,
        'Override reason required',
      );
    }
  }

  private matches(
    t: TransitionDef,
    choice: TransitionChoice,
    subject: WorkflowActorSubject,
    workflow: LoadedWorkflow,
    ctx: TargetContext,
  ): boolean {
    if ('transitionId' in choice) return t.id === choice.transitionId;
    const target = effectiveTargetId(t, subject.facts, workflow.stages, ctx);
    if ('stageId' in choice) return target === choice.stageId;
    const stage = this.stage(workflow, target);
    if (stage.systemState !== choice.systemState) return false;
    // Итог колонки (#402): «Завершённые» не подменяются «Отменой».
    return (stage.outcome ?? null) === choice.outcome;
  }

  private options(
    workflow: LoadedWorkflow,
    subject: EngineSubject,
    ctx: TargetContext,
  ): WorkflowTransition[] {
    return outgoingTransitions(workflow.transitions, subject.facts, workflow.stages, ctx)
      .filter((t) => passesConditions(t.rules, subject))
      .map((t) => {
        const target = this.stage(
          workflow,
          effectiveTargetId(t, subject.facts, workflow.stages, ctx),
        );
        return {
          id: t.id,
          name: t.name,
          toStageId: target.id,
          toStageName: target.name,
          toStageState: target.systemState as WorkflowTransition['toStageState'],
          toStageOutcome: (target.outcome ?? null) as WorkflowTransition['toStageOutcome'],
          toStageColor: target.color as WorkflowTransition['toStageColor'],
          toStageOrder: target.sortOrder,
          display: t.display,
          intent: t.intent,
          blockedBy: evaluateValidators(t.rules, subject.facts),
          canOverride: subject.canOverrideGates,
          form: t.form?.enabled ? t.form : null,
          validators: t.rules.validators,
        };
      });
  }

  private stage(workflow: LoadedWorkflow, id: string): StageRow {
    const stage = workflow.stages.find((s) => s.id === id);
    if (!stage) throw DomainException.notFound('Stage not found');
    return stage;
  }

  private async context(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
  ): Promise<{ workflow: LoadedWorkflow; subject: EngineSubject }> {
    const subject = await this.subjectWithPermissions(tx, entityId, category, actor);
    return { workflow: await this.workflows.load(subject.workflowId, tx), subject };
  }

  /** Субъект адаптера + права актора: условия `permission` проверяет движок,
   *  и в `available`, и в `execute` — иначе кнопка видна, а нажатие падает. */
  private async subjectWithPermissions(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
  ): Promise<EngineSubject> {
    const subject = await this.adapters.get(category).subject(tx, entityId, actor);
    return { ...subject, permissions: actor.permissions };
  }
}
