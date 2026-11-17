import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@nodus/contracts';
import {
  ASSISTANT_LIMITS,
  ErrorCode,
  TERMINAL_RUN_STATUSES,
  type AssistantRun,
} from '@nodus/contracts';
import { takeUntil, timer, type Observable } from 'rxjs';

import { DomainException } from '../../core/errors/domain-exception.js';
import { AgentRunnerService } from './agent/agent-runner.service.js';
import { AssistantRepository } from './assistant.repository.js';
import { toRunDto } from './assistant.serializers.js';
import { RunBusService, type RunEvent } from './run-bus.service.js';

/**
 * Прогоны (ADR-0043 п. 6): статус, поток SSE и отмена. Владение — только
 * свои прогоны; чужой — 404.
 */
@Injectable()
export class AssistantRunsService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly bus: RunBusService,
    private readonly runner: AgentRunnerService,
  ) {}

  async get(user: AuthUser, runId: string): Promise<AssistantRun> {
    const row = await this.repo.findRun(user.id, runId);
    if (!row) throw DomainException.notFound('Прогон не найден');
    return toRunDto(row);
  }

  /**
   * Поток прогона: восстановление по `Last-Event-ID` + живые события.
   * Прогон чужой или несуществующий — 404 до открытия потока.
   */
  async stream(user: AuthUser, runId: string, lastEventId: number): Promise<Observable<RunEvent>> {
    const row = await this.repo.findRun(user.id, runId);
    if (!row) throw DomainException.notFound('Прогон не найден');
    const status = toRunDto(row).status;
    const stream = this.bus.stream(
      runId,
      Number.isFinite(lastEventId) ? Math.max(0, lastEventId) : 0,
      { terminal: TERMINAL_RUN_STATUSES.includes(status) },
    );
    // Страховка от «висящего» потока: прогон живёт не дольше maxRunSeconds,
    // плюс запас на последние записи. Брошенное соединение не держит воркер.
    return stream.pipe(takeUntil(timer((ASSISTANT_LIMITS.maxRunSeconds + 30) * 1_000)));
  }

  /**
   * Отмена: живой прогон останавливает `AbortController` (провайдер и
   * инструменты), зарезервированное продолжение пачки закрывается вместе с
   * текущим, завершённый — конфликт состояния. Зависший после перезапуска
   * прогон (нет в памяти) закрывается записью в БД.
   */
  async cancel(user: AuthUser, runId: string): Promise<AssistantRun> {
    const row = await this.repo.findRun(user.id, runId);
    if (!row) throw DomainException.notFound('Прогон не найден');
    if (TERMINAL_RUN_STATUSES.includes(toRunDto(row).status)) {
      throw new DomainException(ErrorCode.ASSISTANT_RUN_ALREADY_FINISHED, 'Прогон уже завершён');
    }
    // Резерв продолжения: его нет в памяти раннера, но пачка уже захвачена —
    // без этой ветки «Стоп» оставлял бы `continued` с мёртвым runId.
    const cancelledQueued = await this.repo.cancelQueuedRun(runId);
    if (!cancelledQueued) {
      if (!this.runner.cancel(runId)) {
        await this.repo.updateRun(runId, {
          status: 'cancelled',
          finishedAt: new Date(),
          errorCode: 'cancelled',
          errorMessage: 'Прогон остановлен сотрудником',
        });
      }
      // Остановка ответа останавливает и отложенное продолжение пачки.
      await this.repo.cancelQueuedRuns(row.sessionId);
    }
    return toRunDto((await this.repo.findRun(user.id, runId)) ?? row);
  }
}

/** Лимит прогона в секундах — для README/настроек (без квот, ADR-0044 п. 8). */
export const ASSISTANT_RUN_LIMITS = {
  maxRunSeconds: ASSISTANT_LIMITS.maxRunSeconds,
  maxSteps: ASSISTANT_LIMITS.maxSteps,
} as const;
