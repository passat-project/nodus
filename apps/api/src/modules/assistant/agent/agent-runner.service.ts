import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ASSISTANT_LIMITS, ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { AssistantRepository } from '../assistant.repository.js';
import { AiSettingsService } from '../providers/ai-settings.service.js';
import {
  LlmProviderError,
  type LlmMessage,
  type LlmToolCall,
} from '../providers/llm-provider.port.js';
import { RunBusService } from '../run-bus.service.js';
import { buildCatalog, hotTools } from '../tools/catalog.js';
import type {
  AssistantToolDefinition,
  ScreenContext,
  ToolContext,
} from '../tools/tool-definition.js';
import { toLlmTools } from '../tools/tool-schema.js';
import { ToolExecutorService } from '../tools/tool-executor.service.js';
import { toLlmHistory } from './history.js';
import { buildSystemPrompt, companyToday } from './system-prompt.js';

/** Параметры прогона: всё, что нужно циклу, передаётся явно. */
export interface RunParams {
  runId: string;
  sessionId: string;
  userId: string;
  /** `Bearer …` сотрудника — живёт только в памяти прогона (не в БД). */
  authorization: string;
  permissions: readonly string[];
  features: readonly string[];
  screen: ScreenContext;
}

/** Активный прогон: отмена и таймаут различаются причиной. */
interface ActiveRun {
  controller: AbortController;
  reason: 'user' | 'timeout' | null;
}

/**
 * Агентный цикл прогона (ADR-0043 п. 6): системный промпт → вызов модели →
 * вызовы инструментов от имени сотрудника → повтор до финального текста.
 *
 * Предохранители (квот нет — решение владельца): `maxSteps`, `maxRunSeconds`,
 * лимит результата инструмента и истории. Отмена и таймаут ведут к
 * сохранению ЧАСТИЧНОГО текста: сотрудник не теряет уже прочитанное.
 *
 * Размышления модели (`reasoning`) собираются отдельным каналом и
 * сохраняются в сообщении: интерфейс показывает их под шевроном.
 */
@Injectable()
export class AgentRunnerService {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly repo: AssistantRepository,
    private readonly settings: AiSettingsService,
    private readonly executor: ToolExecutorService,
    private readonly bus: RunBusService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentRunnerService.name);
  }

  /** Запуск без ожидания: HTTP-ответ уже ушёл (202), результат — в SSE. */
  start(params: RunParams): void {
    void this.execute(params).catch((error: unknown) => {
      this.logger.error({ err: error, runId: params.runId }, 'Agent run crashed');
    });
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Отмена сотрудником: откладываем причину, чтобы отличить от таймаута. */
  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.reason = 'user';
    run.controller.abort();
    return true;
  }

  private async execute(params: RunParams): Promise<void> {
    const active: ActiveRun = { controller: new AbortController(), reason: null };
    this.active.set(params.runId, active);
    const timer = setTimeout(() => {
      active.reason = 'timeout';
      active.controller.abort();
    }, ASSISTANT_LIMITS.maxRunSeconds * 1_000);

    let messageId: string | null = null;
    let text = '';
    let reasoning = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    try {
      await this.bus.open(params.runId);
      const message = await this.repo.createMessage({
        sessionId: params.sessionId,
        runId: params.runId,
        role: 'assistant',
      });
      messageId = message.id;

      const resolved = await this.settings.resolveForRun();
      await this.repo.updateRun(params.runId, {
        status: 'running',
        startedAt: new Date(),
        providerId: resolved.providerId,
        modelId: resolved.modelId,
      });
      await this.bus.publish(params.runId, 'run.started', {
        messageId: message.id,
        model: resolved.modelId,
      });

      const history = await this.repo.recentMessages(
        params.sessionId,
        ASSISTANT_LIMITS.maxHistoryMessages,
      );
      const priorMessages = toLlmHistory(history.filter((row) => row.id !== message.id));
      const catalog = buildCatalog({ permissions: params.permissions, features: params.features });
      const prompt = buildSystemPrompt({
        today: companyToday(new Date(), 'Europe/Minsk'),
        hotTools: hotTools(catalog),
        hasHiddenTools: catalog.length > hotTools(catalog).length,
        instructions: resolved.instructions,
      });
      const messages: LlmMessage[] = [{ role: 'system', content: prompt }, ...priorMessages];

      /** Активный набор инструментов: горячая полка + найденные tools.search. */
      const activeTools = new Set(hotTools(catalog).map((tool) => tool.id));
      const toolContext: ToolContext = {
        authorization: params.authorization,
        screen: params.screen,
        available: catalog,
        activate: (ids) => {
          for (const id of ids) activeTools.add(id);
        },
      };

      for (let step = 1; ; step += 1) {
        if (step > ASSISTANT_LIMITS.maxSteps) {
          throw new AssistantRunError('max_steps', 'Превышен максимум шагов прогона', true);
        }
        if (active.controller.signal.aborted) throw abortReason(active);

        const tools = toLlmTools(catalog.filter((tool) => activeTools.has(tool.id)));
        const calls: LlmToolCall[] = [];
        let stepText = '';

        for await (const event of resolved.provider.streamChat({
          model: resolved.modelId,
          messages,
          tools,
          extra: resolved.model.extra,
          signal: active.controller.signal,
        })) {
          // Отмена проверяется на каждом событии, а не только силами
          // провайдера: «Стоп» обязан остановить и медленный поток.
          if (active.controller.signal.aborted) throw abortReason(active);
          if (event.type === 'text.delta') {
            text += event.text;
            stepText += event.text;
            this.bus.publishDelta(params.runId, 'message.delta', event.text);
          } else if (event.type === 'reasoning.delta') {
            reasoning += event.text;
            this.bus.publishDelta(params.runId, 'reasoning.delta', event.text);
          } else if (event.type === 'tool_call') {
            calls.push(event.call);
          } else if (event.type === 'usage') {
            inputTokens = addTokens(inputTokens, event.inputTokens);
            outputTokens = addTokens(outputTokens, event.outputTokens);
          }
        }

        if (calls.length === 0) break;

        // Модель попросила действия: её сообщение с tool_calls — в историю.
        messages.push({
          role: 'assistant',
          content: stepText.trim() ? stepText : null,
          tool_calls: calls,
        });
        await this.runToolCalls(
          params.runId,
          message.id,
          calls,
          catalog,
          activeTools,
          toolContext,
          messages,
        );
      }

      await this.repo.finishMessage(message.id, {
        text,
        reasoning: reasoning || null,
        errorCode: null,
      });
      await this.repo.updateRun(params.runId, {
        status: 'completed',
        finishedAt: new Date(),
        inputTokens,
        outputTokens,
      });
      await this.bus.publish(params.runId, 'message.completed', {
        messageId: message.id,
        text,
        reasoning: reasoning || null,
      });
      await this.bus.publish(params.runId, 'run.completed', { inputTokens, outputTokens });
    } catch (error) {
      await this.failRun({
        params,
        active,
        error,
        messageId,
        text,
        reasoning,
        inputTokens,
        outputTokens,
      });
    } finally {
      clearTimeout(timer);
      this.active.delete(params.runId);
      this.bus.close(params.runId);
    }
  }

  /**
   * Пакет вызовов инструментов: сначала все в статусе «выполняется» (UI видит
   * ход одновременно), затем результаты — параллельно, пачками по
   * `maxParallelToolCalls`, порядок строк детерминирован порядком модели.
   */
  private async runToolCalls(
    runId: string,
    messageId: string,
    calls: readonly LlmToolCall[],
    catalog: readonly AssistantToolDefinition[],
    activeTools: Set<string>,
    context: ToolContext,
    messages: LlmMessage[],
  ): Promise<void> {
    const prepared: {
      call: LlmToolCall;
      tool: AssistantToolDefinition | null;
      toolCallId: string;
      input: unknown;
    }[] = [];
    for (const [index, call] of calls.entries()) {
      const tool = catalog.find((item) => item.id === call.function.name) ?? null;
      const args = parseArgs(call.function.arguments);
      const toolCallId = await this.repo.createToolCall({
        runId,
        messageId,
        seq: index,
        toolId: call.function.name,
        title: tool?.title ?? call.function.name,
        args,
      });
      await this.bus.publish(runId, 'tool.started', {
        toolCallId,
        toolId: call.function.name,
        title: tool?.title ?? call.function.name,
        args,
      });
      prepared.push({ call, tool, toolCallId, input: args });
    }

    const results = new Map<string, string>();
    for (
      let offset = 0;
      offset < prepared.length;
      offset += ASSISTANT_LIMITS.maxParallelToolCalls
    ) {
      const batch = prepared.slice(offset, offset + ASSISTANT_LIMITS.maxParallelToolCalls);
      await Promise.all(
        batch.map(async (item) => {
          const startedAt = Date.now();
          const execution = item.tool
            ? await this.executor.execute(item.tool, item.input, context)
            : {
                ok: false as const,
                errorCode: 'ASSISTANT_TOOL_UNKNOWN',
                message: 'Такого действия нет в каталоге',
              };
          const durationMs = Date.now() - startedAt;
          const resultText = execution.ok
            ? execution.text
            : `Ошибка (${execution.errorCode}): ${execution.message}`;
          await this.repo.finishToolCall(item.toolCallId, {
            status: execution.ok ? 'done' : 'error',
            resultPreview: clipPreview(resultText),
            durationMs,
            errorCode: execution.ok ? null : execution.errorCode,
            href: execution.ok ? (execution.entity?.href ?? null) : null,
            hrefLabel: execution.ok ? (execution.entity?.label ?? null) : null,
          });
          await this.bus.publish(runId, 'tool.finished', {
            toolCallId: item.toolCallId,
            toolId: item.call.function.name,
            status: execution.ok ? 'done' : 'error',
            resultPreview: clipPreview(resultText),
            durationMs,
            errorCode: execution.ok ? null : execution.errorCode,
            href: execution.ok ? (execution.entity?.href ?? null) : null,
            hrefLabel: execution.ok ? (execution.entity?.label ?? null) : null,
          });
          results.set(item.call.id, resultText);
        }),
      );
    }

    // Активный набор мог расшириться через tools.search — новый шаг увидит его.
    for (const item of prepared) {
      messages.push({
        role: 'tool',
        tool_call_id: item.call.id,
        content: results.get(item.call.id) ?? 'Нет результата',
      });
    }
    void activeTools;
  }

  /** Единая точка фиксации сбоя: статус прогона, частичный текст, событие. */
  private async failRun(input: {
    params: RunParams;
    active: ActiveRun;
    error: unknown;
    messageId: string | null;
    text: string;
    reasoning: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }): Promise<void> {
    const { params, active, error } = input;
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
    } else if (error instanceof DomainException) {
      code =
        error.code === ErrorCode.ASSISTANT_PROVIDER_NOT_CONFIGURED ? 'no_provider' : 'internal';
      message = error.message;
    } else {
      code = 'internal';
      message = 'Внутренняя ошибка ассистента';
      this.logger.error({ err: error, runId: params.runId }, 'Agent run failed');
    }

    if (cancelled && !timedOut) {
      if (input.messageId) {
        await this.repo.finishMessage(input.messageId, {
          text: input.text,
          reasoning: input.reasoning || null,
          errorCode: null,
        });
      }
      await this.repo.updateRun(params.runId, {
        status: 'cancelled',
        finishedAt: new Date(),
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
      });
      await this.bus.publish(params.runId, 'run.cancelled', {});
      return;
    }

    if (input.messageId) {
      await this.repo.finishMessage(input.messageId, {
        text: input.text,
        reasoning: input.reasoning || null,
        errorCode: code,
      });
    }
    await this.repo.updateRun(params.runId, {
      status: 'failed',
      finishedAt: new Date(),
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      errorCode: code,
      errorMessage: message,
    });
    await this.bus.publish(params.runId, 'run.error', { code, message, retryable });
  }
}

/** Ошибка прогона с кодом для интерфейса (лимит шагов и подобные). */
class AssistantRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'AssistantRunError';
  }
}

function abortReason(active: ActiveRun): Error {
  return new AssistantRunError(
    active.reason === 'timeout' ? 'timeout' : 'cancelled',
    active.reason === 'timeout' ? 'Прогон превысил время' : 'Прогон остановлен',
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted/i.test(error.message))
  );
}

function addTokens(current: number | null, delta: number | null): number | null {
  if (delta === null) return current;
  return (current ?? 0) + delta;
}

/** Аргументы вызова: строку JSON от модели разбираем молча (мусор → пусто). */
function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/** Краткий результат для карточки в ленте (полный текст — только модели). */
function clipPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 400 ? `${normalized.slice(0, 400)}…` : normalized;
}
