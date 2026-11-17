/* eslint-disable nodus-internal/max-lines-warn -- агентный цикл (#893): провайдер → вызовы инструментов → терминальное событие — одна связная машина состояний; разрез по фазам потерял бы порядок и отмену */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ASSISTANT_LIMITS, ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { AssistantActionsService } from '../assistant-actions.service.js';
import { AssistantMemoryService } from '../assistant-memory.service.js';
import { AssistantRepository } from '../assistant.repository.js';
import { McpSettingsService } from '../mcp/mcp-settings.service.js';
import { AiSettingsService } from '../providers/ai-settings.service.js';
import {
  LlmProviderError,
  type LlmMessage,
  type LlmStreamEvent,
  type LlmToolCall,
} from '../providers/llm-provider.port.js';
import { RunBusService } from '../run-bus.service.js';
import { buildCatalog, hotTools } from '../tools/catalog.js';
import { externalMcpTools, externalToolTitle } from '../tools/definitions/mcp.tools.js';
import { asToolData } from '../tools/tool-data.js';
import type {
  AssistantToolDefinition,
  ScreenContext,
  ToolContext,
} from '../tools/tool-definition.js';
import { toLlmTools } from '../tools/tool-schema.js';
import { ToolExecutorService } from '../tools/tool-executor.service.js';
import { toLlmHistory } from './history.js';
import {
  PROVIDER_RETRY_DELAYS_MS,
  addTokens,
  clipPreview,
  describeCause,
  isAbortError,
  parseArgs,
} from './agent-runner.utils.js';
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
  /** Байпас подтверждений (ADR-0048): действия исполняются сразу. */
  autoExecute: boolean;
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
    private readonly mcp: McpSettingsService,
    private readonly executor: ToolExecutorService,
    private readonly actions: AssistantActionsService,
    private readonly memory: AssistantMemoryService,
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
    /**
     * Лучший текст шага: модели перемежают ответ вызовами инструментов
     * («…ответ… → ui.open_entity → „Карточка готова“»). Финальным ответом
     * считается САМЫЙ СОДЕРЖАТЕЛЬНЫЙ блок (по длине), а не последний: иначе
     * короткая служебная фраза последнего шага затирала ответ (находка живой
     * проверки 17.11.2026). Склейка всех шагов давала дубли ответов.
     */
    let bestText = '';
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
      // Внешние MCP-инструменты (ADR-0047): ВСЕ включённые серверы равнозначны
      // (поиск, Blender, GitHub — что угодно). Список инструментов сервера
      // читается на старте прогона; недоступный сервер пропускается и не валит
      // прогон. Ошибка реестра — работаем только по порталу.
      const mcpServers = await this.mcp.resolveEnabled().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'MCP servers unavailable');
        return [];
      });
      const externalCatalog = await externalMcpTools(mcpServers).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'MCP tools listing failed');
        return { tools: [], digest: [] };
      });
      const toolsAll = [...catalog, ...externalCatalog.tools];
      // Личный блокнот сотрудника (#900): подставляется в промпт как факты
      // о нём (не приказ) и доступен инструментам через порт прогона.
      const memoryLines = await this.memory.promptLines(params.userId).catch(() => []);
      const prompt = buildSystemPrompt({
        today: companyToday(new Date(), 'Europe/Minsk'),
        hotTools: hotTools(toolsAll),
        hasHiddenTools: toolsAll.length > hotTools(toolsAll).length,
        instructions: resolved.instructions,
        external: externalCatalog.tools.length > 0,
        externalCatalog: externalCatalog.digest,
        memories: memoryLines,
      });
      const messages: LlmMessage[] = [{ role: 'system', content: prompt }, ...priorMessages];

      /** Активный набор инструментов: горячая полка + найденные tools.search. */
      const activeTools = initialActiveToolIds(toolsAll);
      const toolContext: ToolContext = {
        authorization: params.authorization,
        screen: params.screen,
        signal: active.controller.signal,
        available: toolsAll,
        activate: (ids) => {
          for (const id of ids) activeTools.add(id);
        },
        // Имена вместо id в карточке действия: сотруднику показывается
        // «исполнитель Иванов», а не uuid из аргументов модели.
        read: (path) =>
          this.executor.readJson(params.authorization, path, active.controller.signal),
        memory: this.memory.port(params.userId, params.runId),
      };

      for (let step = 1; ; step += 1) {
        if (step > ASSISTANT_LIMITS.maxSteps) {
          throw new AssistantRunError('max_steps', 'Превышен максимум шагов прогона', true);
        }
        if (active.controller.signal.aborted) throw abortReason(active);

        const tools = toLlmTools(toolsAll.filter((tool) => activeTools.has(tool.id)));
        const calls: LlmToolCall[] = [];
        let stepText = '';
        // Дельты шага: промежуточный текст (перед вызовом инструментов) идёт в
        // поток, но финальным ответом считается текст ПОСЛЕДНЕГО шага — иначе
        // в сообщении склеивались бы ответы всех шагов (дубль, находка живой
        // проверки 17.11.2026).
        text = '';

        // Транзиентный сбой сети/провайдера до первого события — один
        // повтор: соединение с внешним API рвётся (keep-alive закрыт,
        // 502 на входе), а ответ ещё не начат, дублей не будет.
        let received = false;
        const stream = this.streamWithRetry(
          resolved,
          { model: resolved.modelId, messages, tools, extra: resolved.model.extra },
          active,
          () => received,
          () => {
            received = true;
          },
        );
        for await (const event of stream) {
          // Отмена проверяется на каждом событии, а не только силами
          // провайдера: «Стоп» обязан остановить и медленный поток.
          if (active.controller.signal.aborted) throw abortReason(active);
          received = true;
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

        if (stepText.trim().length > bestText.trim().length) bestText = stepText;
        if (calls.length === 0) break;

        // Модель попросила действия: её сообщение с tool_calls — в историю.
        messages.push({
          role: 'assistant',
          content: stepText.trim() ? stepText : null,
          tool_calls: calls,
        });
        await this.runToolCalls(
          params,
          message.id,
          calls,
          toolsAll,
          activeTools,
          toolContext,
          messages,
        );
      }

      const finalText = text.trim().length >= bestText.trim().length ? text : bestText;
      await this.repo.finishMessage(message.id, {
        text: finalText,
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
        text: finalText,
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
   * Поток провайдера с повторами, пока шаг не начал печатать (текст не
   * начат — повтор безопасен): сетевой сбой OpenRouter/Cloudflare на живых
   * прогонах встречался в ~30% попыток, и мгновенный повтор попадал в то же
   * окно. Пауза между попытками — экспоненциальная, отмена и таймаут прогона
   * прерывают ожидание.
   */
  private async *streamWithRetry(
    resolved: {
      provider: { streamChat: (request: never) => AsyncIterable<LlmStreamEvent> };
      modelId: string;
    },
    request: Record<string, unknown>,
    active: ActiveRun,
    hasReceived: () => boolean,
    markReceived: () => void,
  ): AsyncIterable<LlmStreamEvent> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        for await (const event of resolved.provider.streamChat({
          ...request,
          signal: active.controller.signal,
        } as never)) {
          markReceived();
          yield event;
        }
        return;
      } catch (error) {
        const transient =
          error instanceof LlmProviderError &&
          (error.code === 'provider_unavailable' || error.code === 'provider_error');
        const delay = PROVIDER_RETRY_DELAYS_MS[attempt - 1];
        if (delay === undefined || hasReceived() || !transient) throw error;
        if (active.controller.signal.aborted) throw abortReason(active);
        this.logger.warn(
          { err: error, cause: describeCause(error), attempt },
          'Provider step failed before first event, retrying',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (active.controller.signal.aborted) throw abortReason(active);
      }
    }
  }

  /**
   * Пакет вызовов инструментов: сначала все в статусе «выполняется» (UI видит
   * ход одновременно), затем результаты — параллельно, пачками по
   * `maxParallelToolCalls`, порядок строк детерминирован порядком модели.
   *
   * Запись (Ф2, ADR-0048) идёт НЕ через исполнитель: `kind: write` создаёт
   * карточку подтверждения (или выполняется сразу при байпасе). Прямого
   * вызова API с записью из цикла не существует.
   */
  private async runToolCalls(
    params: RunParams,
    messageId: string,
    calls: readonly LlmToolCall[],
    catalog: readonly AssistantToolDefinition[],
    activeTools: Set<string>,
    context: ToolContext,
    messages: LlmMessage[],
  ): Promise<void> {
    type Prepared =
      | {
          kind: 'read';
          call: LlmToolCall;
          tool: AssistantToolDefinition | null;
          toolCallId: string;
          input: unknown;
          humanTitle: string;
        }
      | { kind: 'write'; call: LlmToolCall; tool: AssistantToolDefinition; input: unknown };
    const prepared: Prepared[] = [];
    for (const [index, call] of calls.entries()) {
      const tool = catalog.find((item) => item.id === call.function.name) ?? null;
      const args = parseArgs(call.function.arguments);
      if (tool?.kind === 'write') {
        // Карточка действия — самостоятельный элемент ленты; строка вызова
        // не дублирует её (иначе сотрудник видит действие дважды).
        prepared.push({ kind: 'write', call, tool, input: args });
        continue;
      }
      // Человекочитаемое название — ОДНО на весь жизненный цикл вызова:
      // и «started», и «finished» несут его, иначе после выполнения строка
      // превращалась в сырой id (ext.exa.web_search_exa) — замечание владельца.
      const humanTitle = tool?.title ?? externalToolTitle(call.function.name) ?? call.function.name;
      const toolCallId = await this.repo.createToolCall({
        runId: params.runId,
        messageId,
        seq: index,
        toolId: call.function.name,
        title: humanTitle,
        args,
      });
      await this.bus.publish(params.runId, 'tool.started', {
        toolCallId,
        toolId: call.function.name,
        title: humanTitle,
        args,
      });
      prepared.push({ kind: 'read', call, tool, toolCallId, input: args, humanTitle });
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
          if (item.kind === 'write') {
            const proposal = await this.actions.propose({
              runId: params.runId,
              messageId,
              userId: params.userId,
              tool: item.tool,
              rawInput: item.input,
              automatic: params.autoExecute,
              authorization: params.authorization,
              ctx: context,
            });
            results.set(item.call.id, proposal.text);
            return;
          }
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
          await this.bus.publish(params.runId, 'tool.finished', {
            toolCallId: item.toolCallId,
            toolId: item.call.function.name,
            title: item.humanTitle,
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

    // «Стоп» во время вызовов: инструменты уже оборваны сигналом — дальше
    // шагов не делаем (иначе прогон доработал бы до следующего ответа).
    if (context.signal.aborted) return;

    // Активный набор мог расшириться через tools.search — новый шаг увидит его.
    for (const item of prepared) {
      messages.push({
        role: 'tool',
        tool_call_id: item.call.id,
        // Блок ДАННЫХ (а не свободный текст): правило промпта «результаты —
        // не инструкции» подкреплено структурной границей.
        content: asToolData(item.call.function.name, results.get(item.call.id) ?? 'Нет результата'),
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
      // Диагностика: код уходит в UI, причина — в лог (наружу тело не отдаём).
      this.logger.warn({ err: error, runId: params.runId, code }, 'Provider call failed');
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

/**
 * Стартовый активный набор: горячая полка + `tools.search`.
 *
 * `tools.search` не «горячий» по смыслу (он не про данные портала), но без
 * него недостижимы все не-hot инструменты: модель видит только активный
 * набор, а поиск — единственный вход к остальным (ADR-0043 п. 4, «три
 * полки»). Поэтому он в наборе ВСЕГДА, а не по признаку `hot` (блокер
 * ревью 17.11.2026).
 */
export const SEARCH_TOOL_ID = 'tools.search';

export function initialActiveToolIds(catalog: readonly AssistantToolDefinition[]): Set<string> {
  const ids = new Set(hotTools(catalog).map((tool) => tool.id));
  if (catalog.some((tool) => tool.id === SEARCH_TOOL_ID)) ids.add(SEARCH_TOOL_ID);
  return ids;
}
