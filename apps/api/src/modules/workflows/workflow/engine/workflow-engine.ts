/* eslint-disable nodus-internal/max-lines-warn -- движок перехода (#630): план номеров кнопки — до применения окна */
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  lockFieldFilled,
  matchesDecider,
  windowWritableKeys,
  type ProcessCategory,
  type TransitionFormInput,
  type WorkflowAction,
  type WorkflowTransition,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type {
  WorkflowActor,
  WorkflowActorSubject,
  WorkflowFormApplied,
  WorkflowFormMeta,
  WorkflowGateFacts,
  WorkflowStageChangeMeta,
} from '../../../../core/ports/workflow-entity.port.js';
import type {
  TransitionChoice,
  TransitionExecution,
  WorkflowEnginePort,
} from '../../ports/workflow-engine.port.js';
import { NumberSeriesService } from '../../numbering/number-series.service.js';
import {
  NUMBER_ISSUE,
  type NumberIssue,
  type NumberPlan,
  type NumberingFailure,
} from '../../../custom-fields/ports/number-issue.port.js';
import {
  effectiveTargetId,
  evaluateValidators,
  matchesChoice,
  outgoingTransitions,
  type TargetContext,
  type TransitionDef,
} from '../transition-rules.js';
import { approverContext } from './approver-context.js';
import {
  canShow,
  actionOptions,
  transitionOptions,
  vacancyReasons,
} from './transition-availability.js';
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
    @Inject(NUMBER_ISSUE) private readonly numberIssue: NumberIssue,
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

  /** Действия текущего статуса для панели карточки (#633): видимые актору,
   *  свои раньше «из любого»; окно — если включено. */
  async availableActions(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
  ): Promise<WorkflowAction[]> {
    const { workflow, subject } = await this.context(tx, entityId, category, actor);
    return actionOptions(workflow, subject);
  }

  async execute(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
    choice: TransitionChoice,
    opts: {
      override?: boolean;
      reason?: string;
      form?: TransitionFormInput;
      confirmEmptyNumberParts?: boolean;
    } = {},
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
      .filter((t) => canShow(t, subject0))
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
    const applied = await this.applyForm(
      adapter,
      category,
      tx,
      entityId,
      actor,
      picked,
      opts.form,
      subject0.facts,
    );
    // Замки нажатой кнопки (#496, Р4): «Закрепить после нажатия» — в той же
    // транзакции, что и переход; откат перехода откатывает и замок. Замки
    // выключенного окна не действуют (В13) — как и в проверке документа.
    if (picked.form?.enabled && picked.form.locks?.length) {
      await adapter.applyLocks?.(tx, entityId, actor.id, picked.form.locks, {
        transitionId: picked.id,
        transitionName: picked.name,
      });
    }
    // Гейты видят факты после окна; условия «кто» — по состоянию до окна.
    const subject1 = exec.hasApplied(applied)
      ? await this.subjectWithPermissions(tx, entityId, category, actor)
      : subject0;
    // Роли/права — до окна (окно не делает актора утверждающим), факты — после.
    const targetCtx1 = approverContext(workflow, {
      ...subject1,
      roles: subject0.roles,
      permissions: subject0.permissions,
      // Решающие (#433): состояние ДО окна — окно не делает актора решающим
      // и не снимает вакансию.
      deciderFacts: subject0.deciderFacts,
      vacantDeciderTransitionIds: subject0.vacantDeciderTransitionIds,
    });
    // Выбранная кнопка — первой: DnD предпочёл кандидата без обязательного
    // окна, и гейты не должны «переиграть» выбор на другую кнопку.
    const ordered = [picked, ...candidates.filter((t) => t.id !== picked.id)];
    const scored = ordered.map((t) => ({
      t,
      reasons: [...evaluateValidators(t.rules, subject1.facts), ...vacancyReasons(t, subject1)],
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
    // Пост-функция «Присвоить номер» с полем-счётчиком (#630): план ВСЕХ
    // номеров ИСПОЛНЯЕМОЙ кнопки — после окна (его значения видны вставкам),
    // до смены стадии. Нет места/пустая вставка — 409, действие откатывается.
    const numberPlan = await this.planNumbers(tx, adapter, entityId, pick.t, opts, actor);
    // Пост-действие «Присвоить номер» (#55, Р1): номер выдаётся в этой же
    // транзакции ДО смены стадии — откат перехода не сдвигает счётчик.
    const numbering = await exec.assignNumber(this.numbers, tx, subject1, pick.t);
    const assignedNumbers = numberPlan.ok ? await numberPlan.issue(tx, entityId) : {};
    if (numberPlan.ok && Object.keys(assignedNumbers).length > 0) {
      await adapter.applyNumbers?.(tx, entityId, actor.id, assignedNumbers);
    }
    const recordId = randomUUID();
    const fromStage =
      workflow.stages.find((s) => s.id === subject0.stageId) ??
      (await this.workflows.findStageById(subject0.stageId, tx));
    await adapter.applyStage(tx, entityId, target, actor.id, {
      transitionId: pick.t.id,
      cause: 'transition',
      overriddenGates: pick.reasons.map((r) => r.kind),
      overrideReason: pick.reasons.length > 0 ? opts.reason?.trim() : undefined,
      wasDeciderOfTransition:
        subject0.deciderFacts !== undefined &&
        pick.t.rules.conditions.some(
          (condition) =>
            condition.kind === 'decider_in' &&
            matchesDecider(condition.source, subject0.deciderFacts!),
        ),
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
    return {
      stage: target,
      recordId,
      ...(Object.keys(assignedNumbers).length > 0
        ? {
            assignedNumbers: Object.entries(assignedNumbers).map(([fieldId, display]) => ({
              fieldId,
              display,
            })),
          }
        : {}),
    };
  }

  /**
   * Нажатие действия (#633): окно и запись в журнал, статус НЕ меняется.
   * Шаги (каталог ядра) в этой версии ещё не исполняются — действие с шагами
   * отклоняется явно, чтобы не было «нажал — и ничего» (STOP-условие плана).
   */
  async pressAction(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
    actionId: string,
    opts: { form?: TransitionFormInput } = {},
  ): Promise<{
    actionName: string;
    stageName: string;
    recordId: string;
    fields: Record<string, unknown>;
    commentLabel?: string;
    result?: { resultId: string; fileCount: number; messageCount: number };
  }> {
    const adapter = this.adapters.get(category);
    await adapter.lock(tx, entityId);
    const subject = await this.subjectWithPermissions(tx, entityId, category, actor);
    const workflow = await this.workflows.load(subject.workflowId, tx);
    const action = workflow.actions.find(
      (a) => a.id === actionId && (a.stageId === null || a.stageId === subject.stageId),
    );
    if (!action || !canShow(action, subject)) {
      throw new DomainException(ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED, 'Action not allowed');
    }
    if ((action.steps as unknown[]).length > 0) {
      throw new DomainException(ErrorCode.WORKFLOW_INVALID, 'Action steps are not supported yet');
    }
    // Окно действия — та же граница, что у перехода: состав ввода сверяется
    // с настройкой окна (иначе обязательные разделы обходились бы пустым
    // телом, а лишние поля писались мимо окна).
    const asTransition = action as unknown as TransitionDef;
    this.assertFormAllowed(asTransition, opts.form);
    const applied = await this.applyForm(
      adapter,
      category,
      tx,
      entityId,
      actor,
      asTransition,
      opts.form,
      subject.facts,
    );
    // Гейты — ПОСЛЕ окна (как у перехода): данные, которые закрывают условие
    // (итог, время, поля), пишет само окно. Перечитываем субъект в той же
    // транзакции; отказ откатит окно вместе с записью.
    const subjectAfter = await this.subjectWithPermissions(tx, entityId, category, actor);
    const gateReasons = evaluateValidators(action.rules, subjectAfter.facts);
    if (gateReasons.length > 0) {
      throw new DomainException(ErrorCode.WORKFLOW_TRANSITION_BLOCKED, 'Action gates not passed', {
        reasons: gateReasons,
      });
    }
    if (action.form.enabled && action.form.locks?.length) {
      await adapter.applyLocks?.(tx, entityId, actor.id, action.form.locks, {
        transitionId: action.id,
        transitionName: action.name,
      });
    }
    const recordId = randomUUID();
    await this.records.insert(tx, {
      id: recordId,
      entityKind: category,
      entityId,
      transitionId: null,
      actionId: action.id,
      fromStageId: subject.stageId,
      toStageId: subject.stageId,
      actorId: actor.id,
      rule: null,
      recordKind: 'action',
      participantId: null,
      comment: opts.form?.comment ?? null,
      resultId: applied.result?.resultId ?? null,
      fields: applied.fields,
      timeEntryId: applied.timeEntryId,
    });
    return {
      actionName: action.name,
      stageName: this.stage(workflow, subject.stageId).name,
      recordId,
      fields: applied.fields,
      ...(exec.commentLabelOf(asTransition)
        ? { commentLabel: exec.commentLabelOf(asTransition) }
        : {}),
      ...(applied.result ? { result: applied.result } : {}),
    };
  }

  /** План номеров кнопки: только `assign_number {fieldId}`, только поля без
   *  номера (кто первым заполнил — тот выдал). Письмо-серия — отдельный путь
   *  `exec.assignNumber` (без fieldId). */
  private async planNumbers(
    tx: TransactionClient,
    adapter: ReturnType<WorkflowEntityRegistry['get']>,
    entityId: string,
    picked: TransitionDef,
    opts: { confirmEmptyNumberParts?: boolean },
    actor: WorkflowActor,
  ): Promise<NumberPlan> {
    const fieldIds = picked.rules.postFunctions
      .filter(
        (pf): pf is { kind: 'assign_number'; fieldId: string } =>
          pf.kind === 'assign_number' && pf.fieldId !== undefined,
      )
      .map((pf) => pf.fieldId);
    if (fieldIds.length === 0 || !adapter.numberTarget)
      return { ok: true, issue: async () => ({}) };
    const target = await adapter.numberTarget(tx, entityId, actor);
    const empty = fieldIds.filter((fieldId) => {
      const value = target.sources.self[fieldId];
      return value === undefined || value === null || value === '';
    });
    if (empty.length === 0) return { ok: true, issue: async () => ({}) };
    const plan = await this.numberIssue.plan(tx, empty, target, {
      hostKind: target.host,
      source: 'transition',
      sourceLabel: picked.name,
      confirmEmpty: opts.confirmEmptyNumberParts === true,
    });
    if (!plan.ok) throw numberingException(plan.failure);
    return plan;
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
    facts: WorkflowGateFacts,
  ): Promise<WorkflowFormApplied> {
    if (!form || Object.keys(form).length === 0) return exec.EMPTY_APPLIED;
    const meta = this.formMeta(t, facts);
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
          return adapter.applyForm(tx, entityId, actor, rest, meta);
        }
      }
    }
    return adapter.applyForm(tx, entityId, actor, form, meta);
  }

  /** Ключи окна, которые оно пишет мимо замка записи (#496, Р4, В10):
   *  настроенный раздел «Поля» и пустые поля из условия «Заполнены поля».
   *  Факты — состояние ДО окна (окно не даёт права писать закреплённое). */
  private formMeta(t: TransitionDef, facts: WorkflowGateFacts): WorkflowFormMeta {
    const { sections } = windowOf(t.form, t.rules);
    return {
      writableKeys: windowWritableKeys(sections, (key) => lockFieldFilled(key, facts)),
    };
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
    return matchesChoice(t, choice, subject.facts, workflow.stages, ctx, (id) =>
      this.stage(workflow, id),
    );
  }

  private options(
    workflow: LoadedWorkflow,
    subject: EngineSubject,
    ctx: TargetContext,
  ): WorkflowTransition[] {
    return transitionOptions(workflow, subject, ctx, (id) => this.stage(workflow, id));
  }

  /** Условия «кто» без обхода, вакансия и видимость кнопки — в
   *  transition-availability.ts (#433): движок только применяет. */

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

/** 409 выдачи номера: тот же формат `details`, что у мок-мира и API. */
function numberingException(failure: NumberingFailure): DomainException {
  if (failure.kind === 'empty') {
    return new DomainException(ErrorCode.NUMBER_SEGMENT_EMPTY, 'Number has an empty part', {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      segments: failure.segments,
      example: failure.example,
    });
  }
  return new DomainException(
    ErrorCode.NUMBER_CONTAINER_MISSING,
    `Number is not issued («${failure.fieldName}»)`,
    {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      reason: failure.reason,
      index: failure.index,
      name: failure.name,
    },
  );
}
