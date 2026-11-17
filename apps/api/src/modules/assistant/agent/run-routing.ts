import type { PinoLogger } from 'nestjs-pino';

import type { AiSettingsService } from '../providers/ai-settings.service.js';
import type { LlmMessage } from '../providers/llm-provider.port.js';
import type { RunBusService } from '../run-bus.service.js';
import { hotTools } from '../tools/catalog.js';
import {
  ROUTER_TIMEOUT_MS,
  buildRouterMessages,
  parseRouterOutput,
  type RoutedTool,
} from '../tools/dispatcher.js';
import type { AssistantToolDefinition, ScreenContext } from '../tools/tool-definition.js';
import { describeCause } from './agent-runner.utils.js';

/**
 * Маршрутизация прогона (#917) и служебные тексты, которые не зависят от
 * состояния класса: диспетчер top-7, активный набор и вопрос-продолжение.
 * Вынесено из `agent-runner.service.ts` (I5: связная машина состояний цикла
 * остаётся там, а выбор инструментов — отдельная ответственность).
 */

/**
 * Диспетчер инструментов (#917): один дешёвый вызов без стриминга ответа
 * наружу. Решение пишется в журнал прогона (`tools.routed`) — по нему
 * меряется качество: попал ли нужный инструмент в top-7.
 */
export async function routeTools(input: {
  runId: string;
  screen: ScreenContext;
  /** Прогон-продолжение отвечает на решения — диспетчер не нужен. */
  continuation: boolean;
  catalog: readonly AssistantToolDefinition[];
  priorMessages: readonly LlmMessage[];
  signal: AbortSignal;
  settings: AiSettingsService;
  bus: RunBusService;
  logger: PinoLogger;
}): Promise<RoutedTool[]> {
  if (input.continuation) return [];
  const query = lastUserPrompt(input.priorMessages);
  if (!query) return [];
  const router = await input.settings.resolveRouter().catch((error: unknown) => {
    input.logger.warn({ err: error }, 'Router settings unavailable');
    return null;
  });
  if (!router) return [];
  const startedAt = Date.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ROUTER_TIMEOUT_MS);
  try {
    let text = '';
    for await (const event of router.provider.streamChat({
      model: router.modelId,
      messages: buildRouterMessages(query, input.screen, input.catalog),
      signal: AbortSignal.any([input.signal, timeout.signal]),
      temperature: 0,
      extra: { max_tokens: 700 },
    })) {
      if (event.type === 'text.delta') text += event.text;
      if (text.length > 8_000) break;
    }
    const tools = parseRouterOutput(text, input.catalog);
    await input.bus.publish(input.runId, 'tools.routed', {
      tools,
      model: router.modelId,
      durationMs: Date.now() - startedAt,
      fallback: false,
    });
    return tools;
  } catch (error) {
    if (input.signal.aborted) return [];
    input.logger.warn(
      { err: error, runId: input.runId, cause: describeCause(error) },
      'Tool router failed, fallback to hot shelf',
    );
    await input.bus
      .publish(input.runId, 'tools.routed', {
        tools: [],
        model: router.modelId,
        durationMs: Date.now() - startedAt,
        fallback: true,
      })
      .catch(() => undefined);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Последний настоящий вопрос сотрудника в истории — вход диспетчера. */
export function lastUserPrompt(messages: readonly LlmMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'user' && typeof message.content === 'string') {
      // Служебные уведомления продолжения — не запрос: диспетчер по ним
      // не роутит (см. early-return в routeTools).
      return message.content;
    }
  }
  return '';
}

/** id → определения для промпта (порядок — как выбрал диспетчер). */
export function routedToolsOf(
  catalog: readonly AssistantToolDefinition[],
  routed: readonly RoutedTool[],
): AssistantToolDefinition[] {
  return routed
    .map((item) => catalog.find((tool) => tool.id === item.id))
    .filter((tool): tool is AssistantToolDefinition => Boolean(tool));
}

/** Служебный вопрос прогона-продолжения (#916): модель отвечает итогом. */
export function continuationPrompt(continuation: {
  ofMessageId: string;
  pendingCards: number;
}): string {
  const lines = [
    'Служебное уведомление (это не сообщение сотрудника): сотрудник принял решения по карточкам действий — сводка решений выше, в блоке assistant_actions.',
    'Подведи короткий итог: что выполнено, что отменено и что не удалось (с причиной по коду). Если логичен следующий шаг — предложи его и сразу подготовь карточку.',
    'Не повторяй выполненные действия и не утверждай, что ждущие карточки уже сделаны.',
  ];
  if (continuation.pendingCards > 0) {
    lines.push(
      `Ещё ${continuation.pendingCards} карточек этой пачки ждут решения — они остаются в ленте. Не считай их выполненными и не готовь их повторно.`,
    );
  }
  return lines.join('\n');
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
