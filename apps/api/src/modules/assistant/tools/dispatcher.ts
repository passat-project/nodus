import { z } from 'zod';

import type { LlmMessage } from '../providers/llm-provider.port.js';
import type { AssistantToolDefinition, ScreenContext } from './tool-definition.js';

/**
 * Диспетчер инструментов (#917, «Decision-модель»): перед основным циклом
 * дешёвая LLM по формулировке сотрудника и описаниям каталога выбирает
 * top-7 инструментов. Каталог растёт (40+ и дальше сотни), а точность выбора
 * модели падает уже после 30–50 описаний в контексте (Anthropic: tool search;
 * MCP client best practices: subagent-based routing).
 *
 * Границы: диспетчер только ВЫБИРАЕТ инструменты — права, подтверждения и
 * исполнение не меняются. Ошибка/таймаут/пустой ответ — горячая полка и
 * `tools.search` (запасной путь), сотрудник сбоя не видит.
 */

/** Сколько инструментов активирует диспетчер (решение владельца: top-5–7). */
export const ROUTER_MAX_TOOLS = 7;

/** Ниже порога инструмент не активируется: шум только мешает модели. */
export const ROUTER_MIN_SCORE = 0.15;

/** Потолок ожидания диспетчера: ответ модели важнее экономии секунды. */
export const ROUTER_TIMEOUT_MS = 8_000;

/** Один инструмент глазами диспетчера: id, название, модуль, вид, описание. */
function describe(tool: AssistantToolDefinition): string {
  const kind = tool.kind === 'write' ? 'запись (карточка подтверждения)' : 'чтение';
  return `- ${tool.id} — ${tool.title} [${tool.module}, ${kind}]: ${clip(tool.description, 200)}`;
}

/**
 * Сообщения диспетчера: каталог данными, ответ — строгий JSON без пояснений.
 * Данные портала сюда НЕ попадают — только запрос сотрудника и контекст
 * экрана (какой раздел/карточка открыты).
 */
export function buildRouterMessages(
  query: string,
  screen: ScreenContext,
  catalog: readonly AssistantToolDefinition[],
): LlmMessage[] {
  const screenLine = [
    screen.moduleId ? `открыт раздел «${screen.moduleId}»` : null,
    screen.cardKind && screen.cardId
      ? `открыта карточка вида «${screen.cardKind}» (id есть в контексте)`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    {
      role: 'system',
      content: [
        'Ты — диспетчер инструментов корпоративного портала. По запросу сотрудника выбери инструменты, которые понадобятся, чтобы ответить или действовать.',
        'Правила:',
        `1. Только id из каталога ниже. Максимум ${ROUTER_MAX_TOOLS}.`,
        '2. Оценивай по смыслу запроса: чтение и запись, нужный модуль, конкретная сущность («задача», «письмо», «проект», «чат», «сотрудник»).',
        '3. Для «сделай» добавляй сначала инструменты поиска аргументов (id сущностей), затем инструмент действия.',
        '4. Если запрос бытовой/общий и портал не нужен — верни пустой список.',
        '5. Ответ — ТОЛЬКО JSON без markdown: {"tools":[{"id":"tasks.list","score":0.9}]}. score от 0 до 1, по убыванию.',
        'Не объясняй выбор, не пиши текст вокруг JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Запрос сотрудника: ${clip(query, 2_000)}`,
        screenLine ? `Контекст экрана: ${screenLine}.` : null,
        '',
        'Каталог инструментов:',
        ...catalog.map(describe),
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];
}

const routableSchema = z.object({
  tools: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        score: z.number().min(0).max(1).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export interface RoutedTool {
  id: string;
  score: number;
}

/**
 * Разбор ответа диспетчера без доверия модели: неизвестные id отбрасываются,
 * оценка клампится, дубли схлопываются, максимум 7. Мусор в ответе — пустой
 * список (горячая полка), а не исключение.
 */
export function parseRouterOutput(
  text: string,
  catalog: readonly AssistantToolDefinition[],
): RoutedTool[] {
  const payload = extractJson(text);
  if (payload === null) return [];
  const parsed = routableSchema.safeParse(payload);
  const entries = parsed.success ? (parsed.data.tools ?? []) : asArrayPayload(payload);
  const known = new Set(catalog.map((tool) => tool.id));
  const best = new Map<string, number>();
  for (const entry of entries) {
    if (!known.has(entry.id)) continue;
    const score = clampScore(entry.score);
    if (score < ROUTER_MIN_SCORE) continue;
    best.set(entry.id, Math.max(best.get(entry.id) ?? 0, score));
  }
  return [...best.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, ROUTER_MAX_TOOLS);
}

/** Модели иногда отдают массив без обёртки — принимаем и его. */
function asArrayPayload(payload: unknown): { id: string; score?: number }[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const id = record.id ?? record.tool;
    if (typeof id !== 'string' || !id.trim()) return [];
    const score = typeof record.score === 'number' ? record.score : undefined;
    return [{ id: id.trim(), score }];
  });
}

/**
 * JSON из ответа: ```json fences и текст вокруг отбрасываются. Объект
 * предпочтительнее, но модель иногда отдаёт массив без обёртки — принимаем и
 * его (выбираем кандидата, который начинается раньше).
 */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  const candidates: string[] = [];
  const arrayFirst =
    arrayStart !== -1 && arrayEnd > arrayStart && (objectStart === -1 || arrayStart < objectStart);
  if (arrayFirst) candidates.push(cleaned.slice(arrayStart, arrayEnd + 1));
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(cleaned.slice(objectStart, objectEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // пробуем следующего кандидата
    }
  }
  return null;
}

function clampScore(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function clip(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1).trimEnd()}…`;
}
