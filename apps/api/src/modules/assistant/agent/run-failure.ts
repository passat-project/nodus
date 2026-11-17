import type { PinoLogger } from 'nestjs-pino';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { AssistantRepository } from '../assistant.repository.js';
import { LlmProviderError } from '../providers/llm-provider.port.js';
import type { RunBusService } from '../run-bus.service.js';
import { isAbortError } from './agent-runner.utils.js';

/**
 * Терминальный сбой прогона (#893/#916): выбор кода для интерфейса,
 * сохранение частичного текста и событие журнала. Вынесено из
 * `agent-runner.service.ts` по I5; цикл отвечает за порядок шагов, а
 * «как закончился прогон» — отдельная ответственность.
 */

/** Активный прогон: отмена и таймаут различаются причиной. */
export interface ActiveRun {
  controller: AbortController;
  reason: 'user' | 'timeout' | null;
  /** Сессия нужна завершению прогона: отложенное продолжение (#916). */
  sessionId: string;
}

/** Ошибка прогона с кодом для интерфейса (лимит шагов и подобные). */
export class AssistantRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'AssistantRunError';
  }
}

export function abortReason(active: ActiveRun): Error {
  return new AssistantRunError(
    active.reason === 'timeout' ? 'timeout' : 'cancelled',
    active.reason === 'timeout' ? 'Прогон превысил время' : 'Прогон остановлен',
  );
}

/** Единая точка фиксации сбоя: статус прогона, частичный текст, событие. */
export async function failRun(input: {
  repo: AssistantRepository;
  bus: RunBusService;
  logger: PinoLogger;
  runId: string;
  active: ActiveRun;
  error: unknown;
  messageId: string | null;
  text: string;
  reasoning: string;
  inputTokens: number | null;
  outputTokens: number | null;
}): Promise<void> {
  const { repo, bus, logger, runId, active, error } = input;
  const aborted = active.controller.signal.aborted;
  const cancelled = (aborted && active.reason === 'user') || isAbortError(error);
  const timedOut = aborted && active.reason === 'timeout';

  let code: string;
  let message: string;
  let retryable = true;
  if (cancelled && !timedOut) {
    code = 'cancelled';
    message = 'Прогон остановлен сотрудником';
    retryable = false;
  } else if (timedOut) {
    code = 'timeout';
    message = 'Прогон превысил допустимое время и остановлен';
  } else if (error instanceof AssistantRunError) {
    code = error.code;
    message = error.message;
    retryable = error.retryable;
  } else if (error instanceof LlmProviderError) {
    code = error.code;
    message = error.message;
    // Диагностика: код уходит в UI, причина — в лог (наружу тело не отдаём).
    logger.warn({ err: error, runId, code }, 'Provider call failed');
  } else if (error instanceof DomainException) {
    code = error.code === ErrorCode.ASSISTANT_PROVIDER_NOT_CONFIGURED ? 'no_provider' : 'internal';
    message = error.message;
  } else {
    code = 'internal';
    message = 'Внутренняя ошибка ассистента';
    logger.error({ err: error, runId }, 'Agent run failed');
  }

  if (cancelled && !timedOut) {
    if (input.messageId) {
      await repo.finishMessage(input.messageId, {
        text: input.text,
        reasoning: input.reasoning || null,
        errorCode: null,
      });
    }
    await repo.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date(),
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    });
    await bus.publish(runId, 'run.cancelled', {});
    return;
  }

  if (input.messageId) {
    await repo.finishMessage(input.messageId, {
      text: input.text,
      reasoning: input.reasoning || null,
      errorCode: code,
    });
  }
  await repo.updateRun(runId, {
    status: 'failed',
    finishedAt: new Date(),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    errorCode: code,
    errorMessage: message,
  });
  await bus.publish(runId, 'run.error', { code, message, retryable });
}
