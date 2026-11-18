/* eslint-disable nodus-internal/max-lines-warn -- агентный цикл (#893): провайдер → вызовы инструментов → терминальное событие — одна связная машина состояний; разрез по фазам потерял бы порядок и отмену */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

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
import { AssistantCompactionService } from './compaction.service.js';
import { clearOldToolResults, estimateMessagesTokens } from './context-budget.js';
import {
  PROVIDER_RETRY_DELAYS_MS,
  addTokens,
  clipPreview,
  clipSafePreview,
  describeCause,
  parseArgs,
} from './agent-runner.utils.js';
import { RunCompletionNotifier } from './run-completion.js';
import {
  SEARCH_TOOL_ID,
  continuationPrompt,
  initialActiveToolIds,
  routeTools,
  routedToolsOf,
} from './run-routing.js';
import { abortReason, AssistantRunError, failRun, type ActiveRun } from './run-failure.js';
import { buildSystemPrompt, companyToday } from './system-prompt.js';

export { SEARCH_TOOL_ID, continuationPrompt, initialActiveToolIds } from './run-routing.js';

/** Результаты этих инструментов содержат персональные данные документа:
 *  в журнал прогона идёт только шапка, не текст (#922, ADR-0050). */
const PRIVATE_PREVIEW_TOOLS: ReadonlySet<string> = new Set(['files.extract_text']);

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
  /** Прогон-продолжение после решений по карточкам (#916). */
  continuation?: {
    /** Сообщение ассистента, чья пачка карточек решилась. */
    ofMessageId: string;
    /** Сколько карточек пачки ещё ждёт решения («Продолжить сейчас»). */
    pendingCards: number;
  };
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
    private readonly compaction: AssistantCompactionService,
    private readonly bus: RunBusService,
    private readonly completion: RunCompletionNotifier,
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

  /** Есть ли в сессии идущий прогон (два прогона одной сессии — конфликт). */
  isSessionActive(sessionId: string): boolean {
    for (const run of this.active.values()) {
      if (run.sessionId === sessionId) return true;
    }
    return false;
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
    const active: ActiveRun = {
      controller: new AbortController(),
      reason: null,
      sessionId: params.sessionId,
    };
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
    /**
     * Заполнение контекста — токены ПОСЛЕДНЕГО запроса, не сумма по шагам:
     * сумма отражает оплату, а не размер окна (#943). Нужна для индикатора
     * и порога сжатия истории.
     */
    let lastInputTokens: number | null = null;

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
        continuationOfMessageId: params.continuation?.ofMessageId ?? null,
      });
      await this.bus.publish(params.runId, 'run.started', {
        messageId: message.id,
        model: resolved.modelId,
      });

      const history = await this.repo.recentMessages(
        params.sessionId,
        ASSISTANT_LIMITS.maxHistoryMessages,
      );
      // Сжатая память сессии (#943): сегменты старых ответов + несжатые
      // ранние вопросы. Дальше идут последние сообщения — всегда дословно.
      const historyPrefix = await this.compaction.historyPrefix(
        params.sessionId,
        history[0] ?? null,
      );
      const priorMessages = [
        ...historyPrefix,
        ...toLlmHistory(history.filter((row) => row.id !== message.id)),
      ];
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
      // Диспетчер (#917): дешёвая модель выбирает инструменты под запрос ДО
      // основного цикла. Ошибка/таймаут — горячая полка, прогон продолжается.
      const routed = await routeTools({
        runId: params.runId,
        screen: params.screen,
        continuation: Boolean(params.continuation),
        catalog: toolsAll,
        priorMessages,
        signal: active.controller.signal,
        settings: this.settings,
        bus: this.bus,
        logger: this.logger,
      });
      // Личный блокнот сотрудника (#900): подставляется в промпт как факты
      // о нём (не приказ) и доступен инструментам через порт прогона.
      const memoryLines = await this.memory.promptLines(params.userId).catch(() => []);
      // Диспетчер выбрал инструменты — в контекст уходят ТОЛЬКО они (плюс
      // tools.search): 28 горячих схем + 7 выбранных превышали порог
      // деградации выбора (~30). Без диспетчера — горячая полка.
      const selected = routedToolsOf(toolsAll, routed);
      const immediate = selected.length > 0 ? selected : hotTools(toolsAll);
      const prompt = buildSystemPrompt({
        today: companyToday(new Date(), 'Europe/Minsk'),
        hotTools: immediate,
        hasHiddenTools: toolsAll.length > immediate.length,
        instructions: resolved.instructions,
        external: externalCatalog.tools.length > 0,
        externalCatalog: externalCatalog.digest,
        memories: memoryLines,
        continuation: Boolean(params.continuation),
      });
      const messages: LlmMessage[] = [{ role: 'system', content: prompt }, ...priorMessages];
      if (params.continuation) {
        // Продолжение — не новый вопрос сотрудника: служебное уведомление
        // даёт модели повод ответить, а сводка решений уже в истории.
        messages.push({ role: 'user', content: continuationPrompt(params.continuation) });
      }

      /** Активный набор: выбранные диспетчером либо горячая полка + search. */
      const activeTools =
        routed.length > 0
          ? new Set([...routed.map((tool) => tool.id), SEARCH_TOOL_ID])
          : initialActiveToolIds(toolsAll);
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
            if (event.inputTokens !== null) lastInputTokens = event.inputTokens;
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
        // Старые результаты инструментов — главный источник шума в прогоне:
        // чистим, сохраняя последние и валидность пар tool_calls/tool (#943).
        const cleared = clearOldToolResults(messages);
        if (cleared > 0) {
          this.logger.info({ runId: params.runId, cleared }, 'Old tool results cleared');
        }
      }

      const finalText = text.trim().length >= bestText.trim().length ? text : bestText;
      const contextTokens = lastInputTokens ?? estimateMessagesTokens(messages);
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
        contextTokens,
      });
      await this.bus.publish(params.runId, 'message.completed', {
        messageId: message.id,
        text: finalText,
        reasoning: reasoning || null,
      });
      await this.bus.publish(params.runId, 'run.completed', {
        inputTokens,
        outputTokens,
        contextTokens,
      });
      // Сжатие — после ответа: сотрудник не ждёт модель-суммаризатор.
      this.compaction.scheduleAfterRun(params.sessionId, contextTokens);
    } catch (error) {
      await failRun({
        repo: this.repo,
        bus: this.bus,
        logger: this.logger,
        runId: params.runId,
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
      // Сессия свободна: отложенное продолжение пачки (#916) может стартовать.
      this.completion.notify(params.sessionId);
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
      // Модель видит только активный набор (диспетчер/полка/поиск). Вызов
      // инструмента вне набора — обход роутера: не исполняем (ниже
      // ASSISTANT_TOOL_UNKNOWN), даже если id существует в каталоге.
      const tool = activeTools.has(call.function.name)
        ? (catalog.find((item) => item.id === call.function.name) ?? null)
        : null;
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
              sessionId: params.sessionId,
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
          // Текст вложения не пишется в журнал/аудит: только шапка файла.
          const resultPreview = PRIVATE_PREVIEW_TOOLS.has(item.call.function.name)
            ? clipSafePreview(resultText)
            : clipPreview(resultText);
          await this.repo.finishToolCall(item.toolCallId, {
            status: execution.ok ? 'done' : 'error',
            resultPreview,
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
            resultPreview,
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
}
