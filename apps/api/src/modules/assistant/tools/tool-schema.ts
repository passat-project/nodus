import { z } from 'zod';

import type { LlmToolDefinition } from '../providers/llm-provider.port.js';
import type { AssistantToolDefinition } from './tool-definition.js';

/**
 * Описание инструментов для модели (ADR-0043): JSON Schema аргументов
 * выводится из тех же zod-схем, что валидируют вызов, — одна схема на
 * промпт и на проверку (без рассинхрона «модель знает одно, сервер другое»).
 */
export function toLlmTool(tool: AssistantToolDefinition): LlmToolDefinition {
  const schema = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>;
  // `$schema` лишний в теле запроса и мешает части OpenAI-совместимых серверов.
  delete schema.$schema;
  return {
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: Object.keys(schema).length > 0 ? schema : { type: 'object', properties: {} },
    },
  };
}

/** Набор инструментов одной полки для запроса к провайдеру. */
export function toLlmTools(tools: readonly AssistantToolDefinition[]): LlmToolDefinition[] {
  return tools.map(toLlmTool);
}
