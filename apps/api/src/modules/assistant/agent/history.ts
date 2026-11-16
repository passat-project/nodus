import type { LlmMessage } from '../providers/llm-provider.port.js';
import type { MessageRow } from '../assistant.repository.js';

/**
 * История диалога → сообщения провайдера (ADR-0043 п. 6): последние N
 * сообщений в хронологическом порядке. Цепочки tool calls прошлых прогонов
 * не переигрываются — модель получает их результат текстом ответа; иначе
 * пришлось бы хранить и заново подставлять пары assistant.tool_calls/tool,
 * тратя контекст на историю вызовов.
 */
export function toLlmHistory(messages: readonly MessageRow[]): LlmMessage[] {
  const result: LlmMessage[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    if (message.role === 'user') {
      if (text) result.push({ role: 'user', content: text });
      continue;
    }
    // Ответ, оборванный ошибкой до первого токена, в историю не попадает:
    // модель не должна думать, что уже отвечала.
    if (!text && message.errorCode) continue;
    if (!text) continue;
    result.push({ role: 'assistant', content: text });
  }
  return result;
}
