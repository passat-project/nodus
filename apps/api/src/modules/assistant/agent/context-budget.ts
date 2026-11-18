import { ASSISTANT_LIMITS } from '@nodus/contracts';

import type { LlmMessage } from '../providers/llm-provider.port.js';
import { asToolData } from '../tools/tool-data.js';

/**
 * Бюджет контекста прогона (#943): порог сжатия истории и очистка старых
 * результатов инструментов. Чистые функции — без БД и модели: их проверяют
 * unit-тесты, сервис сжатия только оркестрирует.
 *
 * Порог — 50% окна (решение владельца 18.11.2026: не работаем на большом
 * контексте; 80–100% — это уже деградация выбора и качества ответа).
 */

/** Оценка токенов по символам: для русского текста ~3 знака на токен. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 3);
}

/**
 * Контекстное окно модели: env `ASSISTANT_CONTEXT_WINDOW_TOKENS` или
 * консервативный дефолт из contracts. Провайдер окно не сообщает, поэтому
 * значение задаётся развёртыванием и меняется без правки кода.
 */
export function contextWindowTokens(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ASSISTANT_CONTEXT_WINDOW_TOKENS);
  if (Number.isFinite(raw) && raw >= 8_000 && raw <= 10_000_000) return Math.floor(raw);
  return ASSISTANT_LIMITS.contextWindowTokens;
}

/** Заполнение последнего запроса дошло до порога сжатия (50% окна). */
export function shouldCompact(
  contextTokens: number | null | undefined,
  windowTokens = contextWindowTokens(),
): boolean {
  if (!contextTokens || contextTokens <= 0) return false;
  return contextTokens >= windowTokens * ASSISTANT_LIMITS.contextCompactRatio;
}

/** Оценка контекста, когда провайдер не прислал usage (сеть/локальная модель). */
export function estimateMessagesTokens(messages: readonly LlmMessage[]): number {
  return messages.reduce((sum, message) => {
    if (message.role === 'tool') return sum + estimateTokens(message.content);
    const content = message.content ?? '';
    const calls = message.role === 'assistant' ? (message.tool_calls?.length ?? 0) : 0;
    return sum + estimateTokens(content) + calls * 20;
  }, 0);
}

const CLEARED_MARKER = 'Результат очищен для экономии контекста';

/**
 * Чистит старые результаты инструментов в прогоне (#943). Anthropic называет
 * это самым безопасным видом сжатия: сырой результат давно отработавшего
 * инструмента модели больше не нужен, а пара `assistant.tool_calls` / `tool`
 * остаётся валидной — меняется только текст, не роль и `tool_call_id`.
 * Последние `toolResultKeep` результатов не трогаются: они нужны текущему шагу.
 */
export function clearOldToolResults(messages: LlmMessage[]): number {
  const toolIndexes = messages.flatMap((message, index) =>
    message.role === 'tool' ? [index] : [],
  );
  if (toolIndexes.length <= ASSISTANT_LIMITS.toolResultKeep) return 0;
  const totalChars = toolIndexes.reduce((sum, index) => {
    const message = messages[index];
    return sum + (message?.role === 'tool' ? message.content.length : 0);
  }, 0);
  if (totalChars <= ASSISTANT_LIMITS.toolResultBudgetChars) return 0;

  // Имя инструмента — по паре tool_call_id, чтобы заглушка была понятной.
  const callNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) callNames.set(call.id, call.function.name);
    }
  }

  const keep = new Set(toolIndexes.slice(-ASSISTANT_LIMITS.toolResultKeep));
  let cleared = 0;
  for (const index of toolIndexes) {
    if (keep.has(index)) continue;
    const message = messages[index];
    if (!message || message.role !== 'tool') continue;
    if (message.content.includes(CLEARED_MARKER)) continue;
    message.content = asToolData(
      callNames.get(message.tool_call_id) ?? 'tool',
      `${CLEARED_MARKER} (старый шаг прогона).`,
    );
    cleared += 1;
  }
  return cleared;
}
