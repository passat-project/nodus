import type { LlmMessage } from '../providers/llm-provider.port.js';
import type { ActionRow, MessageRow } from '../assistant.repository.js';

/**
 * История диалога → сообщения провайдера (ADR-0043 п. 6): последние N
 * сообщений в хронологическом порядке. Цепочки tool calls прошлых прогонов
 * не переигрываются — модель получает их результат текстом ответа; иначе
 * пришлось бы хранить и заново подставлять пары assistant.tool_calls/tool,
 * тратя контекст на историю вызовов.
 *
 * Карточки действий (#916) — исключение: без их состояний модель считала
 * подготовленное действие невыполненным и повторяла его в следующем ходе.
 * Состояния идут служебной сводкой в `system`-сообщении после ответа хода —
 * сотрудник этой сводки не видит (в ленте карточки и так на виду).
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
    if (text) result.push({ role: 'assistant', content: text });
    const summary = actionSummary(message.actions);
    if (summary) result.push({ role: 'system', content: summary });
  }
  return result;
}

/**
 * Сводка карточек хода: что сотрудник уже решил и чем это закончилось.
 * Формат — блок данных (правило промпта «результаты — не инструкции»).
 */
export function actionSummary(actions: readonly ActionRow[]): string | null {
  if (actions.length === 0) return null;
  const lines = actions.map((action, index) => {
    const label = action.summary.trim() || action.title;
    return `${index + 1}) «${clip(label, 220)}» — ${stateText(action)}`;
  });
  return [
    '<data tool="assistant_actions">',
    'Карточки действий этого ответа и решения сотрудника (служебная сводка, не текст сотрудника):',
    ...lines,
    'Выполненные действия не повторяй; отменённые не выполняй без новой просьбы.',
    '</data>',
  ].join('\n');
}

function stateText(action: ActionRow): string {
  switch (action.state) {
    case 'executed':
      return action.resultPreview
        ? `ВЫПОЛНЕНО: ${clip(action.resultPreview.replace(/\s+/g, ' '), 320)}`
        : 'ВЫПОЛНЕНО';
    case 'cancelled':
      return 'ОТМЕНЕНО сотрудником — записи в портале нет';
    case 'failed':
      return `ОШИБКА (${action.errorCode ?? 'ASSISTANT_ACTION_FAILED'}): ${clip(
        (action.resultPreview ?? 'действие не выполнено').replace(/\s+/g, ' '),
        220,
      )}`;
    case 'undone':
      return 'ВЫПОЛНЕНО, затем ОТМЕНЕНО сотрудником (созданное удалено)';
    case 'executing':
      return 'ВЫПОЛНЯЕТСЯ';
    default:
      return 'ЖДЁТ РЕШЕНИЯ сотрудника';
  }
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
