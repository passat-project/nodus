import { z } from 'zod';

/**
 * Внешние MCP-серверы в «Настройках портала → ИИ-агент → MCP» (#902, ADR-0043
 * п. 10): реестр серверов, которыми пользуется ассистент. Первый и пока
 * единственный — Exa (hosted, Streamable HTTP), но реестр — список: адрес,
 * ключ, транспорт и признак «по умолчанию для поиска» живут в настройках,
 * а не в коде.
 *
 * Безопасность: ключ пишется только на запись (наружу — `hasKey`/`keyHint`),
 * шифруется на сервере (`core/crypto`); адрес — только https без логина,
 * пароля и параметров (ключ не должен оказаться в URL и логах прокси).
 */

/** Транспорт MCP: пока один — Streamable HTTP (ADR-0043 п. 10). */
export const assistantMcpTransportSchema = z.enum(['streamable-http']);
export type AssistantMcpTransport = z.infer<typeof assistantMcpTransportSchema>;

/** Адрес MCP-сервера: https, без userinfo и query (ключ — заголовком). */
export const assistantMcpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.username === '' && url.search === '';
    } catch {
      return false;
    }
  }, 'Нужен адрес https без логина, пароля и параметров');

/** Сервер в ответе GET — без ключа: только признак и хвост. */
export const assistantMcpServerSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  url: z.string().min(1),
  transport: assistantMcpTransportSchema,
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  enabled: z.boolean(),
  /** Сервер, к которому уходят поисковые запросы, если их несколько. */
  defaultForSearch: z.boolean(),
});
export type AssistantMcpServer = z.infer<typeof assistantMcpServerSchema>;

/** Сервер в PUT: `apiKey` пишется только если передан, `clearKey` — удаляет. */
export const assistantMcpServerInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  url: assistantMcpUrlSchema,
  transport: assistantMcpTransportSchema.default('streamable-http'),
  apiKey: z.string().trim().min(1).max(500).optional(),
  clearKey: z.boolean().optional(),
  enabled: z.boolean().default(true),
  defaultForSearch: z.boolean().default(false),
});
export type AssistantMcpServerInput = z.infer<typeof assistantMcpServerInputSchema>;

/** Тело PUT: полная замена списка серверов (как у провайдеров). */
export const assistantMcpBodySchema = z.object({
  servers: z.array(assistantMcpServerInputSchema).max(10),
});
export type AssistantMcpBody = z.infer<typeof assistantMcpBodySchema>;

export const assistantMcpResponseSchema = z.object({
  servers: z.array(assistantMcpServerSchema),
});
export type AssistantMcpResponse = z.infer<typeof assistantMcpResponseSchema>;

/** Инструмент сервера в ответе проверки соединения (имя + описание). */
export const assistantMcpToolInfoSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type AssistantMcpToolInfo = z.infer<typeof assistantMcpToolInfoSchema>;

/**
 * Проверка соединения: успех/провал — данными, а не HTTP-ошибкой (как у
 * провайдеров): экран настроек показывает причину без «красного» сбоя формы.
 */
export const assistantMcpTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  /** Имя сервера из `serverInfo` (Exa: `exa-mcp-server`) и версия протокола. */
  serverName: z.string().nullable(),
  protocolVersion: z.string().nullable(),
  /** До 50 инструментов: список нужен как доказательство «живой». */
  tools: z.array(assistantMcpToolInfoSchema),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type AssistantMcpTestResponse = z.infer<typeof assistantMcpTestResponseSchema>;

/** Преднастроенный сервер для кнопки создания (не хардкод инструментов). */
export const ASSISTANT_MCP_PRESETS = [
  {
    key: 'exa',
    name: 'Exa',
    url: 'https://mcp.exa.ai/mcp',
    transport: 'streamable-http',
  },
] as const;
