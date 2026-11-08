import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  ErrorCode,
  type AuthUser,
  type ExecuteLetterTransitionResult,
  type ExecuteTransitionBody,
  type WorkflowTransition,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import { LettersQueryService } from '../letters/letters-query.service.js';

/**
 * Переходы письма (#55, Р1/Р3): кнопки движка и исполнение в транзакции.
 * Повторная регистрация — 409 `LETTER_ALREADY_REGISTERED` с номером: движок
 * видит «уже не из «Нового»» и отвечает «переход не разрешён», сервис
 * перечитывает письмо и объясняет причину человеку. Страховка в адаптере —
 * 409, если номер пришёл зарегистрированному (маршрут с возвратом в «Новое»).
 */
@Injectable()
export class LetterTransitionsService {
  constructor(
    private readonly query: LettersQueryService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
  ) {}

  async available(user: AuthUser, letterId: string): Promise<WorkflowTransition[]> {
    await this.query.visibleRow(user, letterId);
    return this.txRunner.run((tx) =>
      this.engine.available(tx, letterId, 'letter', {
        id: user.id,
        permissions: user.permissions,
      }),
    );
  }

  async execute(
    user: AuthUser,
    letterId: string,
    transitionId: string,
    body: ExecuteTransitionBody,
  ): Promise<ExecuteLetterTransitionResult> {
    await this.query.visibleRow(user, letterId);
    try {
      await this.txRunner.run(async (tx) => {
        const execution = await this.engine.execute(
          tx,
          letterId,
          'letter',
          { id: user.id, permissions: user.permissions },
          { transitionId },
          {
            form: body.form,
            override: body.override,
            reason: body.reason,
            confirmEmptyNumberParts: body.confirmEmptyNumberParts,
          },
        );
        // Событие закрытия без регистрации дублируется сервисом (адаптер уже
        // его шлёт) — здесь только аудит-след причины в журнале переходов.
        void execution;
      });
    } catch (error) {
      throw await this.explain(user, letterId, body, error);
    }
    const [letter, transitions] = await Promise.all([
      this.query.detail(user, letterId),
      this.available(user, letterId),
    ]);
    return { letter, transitions };
  }

  /** Понятная ошибка вместо «переход не разрешён» для повторной регистрации. */
  private async explain(
    user: AuthUser,
    letterId: string,
    body: ExecuteTransitionBody,
    error: unknown,
  ): Promise<unknown> {
    if (!(error instanceof DomainException)) return error;
    if (error.code !== ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED) return error;
    if (!body.form?.registration) return error;
    const row = await this.query.visibleRow(user, letterId);
    if (!row.registeredAt || !row.regNumber) return error;
    return new DomainException(
      ErrorCode.LETTER_ALREADY_REGISTERED,
      'Letter is already registered',
      { regNumber: row.regNumber },
    );
  }

  /** Событие смены стадии доступно и без переходов (мост чата, #463). */
  static readonly stageChangedEvent = CORRESPONDENCE_EVENTS.LETTER_STAGE_CHANGED;
}
