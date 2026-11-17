import { z } from 'zod';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

import { McpError, type McpClient } from '../../mcp/mcp-client.js';
import { defineTool, type AssistantToolDefinition } from '../tool-definition.js';
import { exaTools } from './exa.tools.js';

/**
 * Внешние MCP-серверы как инструменты агента (ADR-0047, решение владельца
 * 18.11.2026): реестр MCP — РАВНОЗНАЧНЫЙ список. «Поиска по умолчанию» нет:
 * включённый сервер отдаёт агенту СВОИ инструменты (`tools/list`), будь это
 * поиск, Blender, GitHub или склад. Exa — особый случай только по качеству
 * схем (`exaTools`: лимиты запроса/страницы), но и она подключена как все.
 *
 * Прогрессивное раскрытие (best practice MCP/Anthropic, см. ADR-0047):
 * - 3–5 часто нужных инструментов на сервер и ≤12 внешних суммарно грузятся
 *   СРАЗУ в native `tools`, как Exa: модель видит имя и вызывает без лишнего
 *   шага;
 * - остальные остаются в каталоге и находятся через наш `tools.search`
 *   (лексический meta-tool) — 50+ определений в контексте ухудшают выбор
 *   инструмента и тратят десятки тысяч токенов;
 * - в системный промпт уходит компактная СВОДКА «сервер → имена инструментов»,
 *   чтобы модель знала, что вообще подключено, ещё до поиска.
 *
 * Границы: аргументы внешних инструментов валидирует сервер (generic-схема
 * принимает объект как есть); результат — внешние данные, прогон оборачивает
 * их в `<data tool>`; сбой сервера — ошибка вызова, а не падение прогона.
 */

/** Сервер из реестра + живой клиент с ключом в памяти. */
export interface McpServerRuntime {
  row: {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
  };
  client: McpClient;
}

/** Результат сборки каталога: инструменты + сводка для системного промпта. */
export interface ExternalCatalog {
  tools: AssistantToolDefinition[];
  /** Строки вида «Сервер (N): tool1, tool2, …». */
  digest: string[];
}

/** Потолки внешнего каталога: имя инструмента и хвост описания. */
const MAX_TOOL_NAME_CHARS = 40;
const MAX_TOOL_DESCRIPTION_CHARS = 300;
/** Сколько инструментов сервера грузим сразу (MCP progressive discovery). */
const HOT_PER_SERVER = 3;
/** Общий потолок внешних инструментов в первом наборе `tools`. */
const MAX_HOT_EXTERNAL = 12;
/** Сколько имён показываем в сводке промпта на сервер. */
const DIGEST_TOOLS = 8;

/** Слаг сервера для id инструмента; занятые слаги получают номер. */
function serverSlug(name: string, id: string, used: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || `server-${id.slice(0, 6)}`;
  let slug = base;
  let index = 2;
  while (used.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  used.add(slug);
  return slug;
}

/** Hosted Exa: для неё есть точные схемы и лимиты (ADR-0046). */
function isExa(url: string): boolean {
  try {
    return new URL(url).hostname === 'mcp.exa.ai';
  } catch {
    return false;
  }
}

/** Общий вход внешнего инструмента: аргументы как есть (валидирует сервер). */
const genericInput = z.record(z.string(), z.unknown());

/**
 * Инструменты всех включённых MCP-серверов. Сервер, который не ответил на
 * `tools/list`, пропускается: один сломанный MCP не отменяет остальные и не
 * валит прогон.
 */
export async function externalMcpTools(
  servers: readonly McpServerRuntime[],
): Promise<ExternalCatalog> {
  const usedSlugs = new Set<string>();
  const tools: AssistantToolDefinition[] = [];
  const digest: string[] = [];
  let hotExternal = 0;
  for (const server of servers) {
    const slug = serverSlug(server.row.name, server.row.id, usedSlugs);
    const serverTools: AssistantToolDefinition[] = [];
    if (isExa(server.row.url)) {
      const exa = exaTools(server.client);
      serverTools.push(...exa);
      hotExternal += exa.length;
    } else {
      let listed: Awaited<ReturnType<McpClient['listTools']>>;
      try {
        listed = await server.client.listTools();
      } catch {
        continue;
      }
      let hotOnServer = 0;
      for (const descriptor of listed) {
        const name =
          descriptor.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, MAX_TOOL_NAME_CHARS) || 'tool';
        const description = descriptor.description
          ? ` — ${descriptor.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS)}`
          : '';
        // Первые инструменты сервера доступны сразу; остальные — через
        // tools.search (по имени сервера/инструмента), чтобы не раздувать промпт.
        const hot = hotExternal < MAX_HOT_EXTERNAL && hotOnServer < HOT_PER_SERVER;
        if (hot) {
          hotExternal += 1;
          hotOnServer += 1;
        }
        serverTools.push(
          defineTool({
            id: `ext.${slug}.${name}`,
            title: `${server.row.name}: ${name}`,
            description: `${server.row.name}: внешний инструмент MCP${description}`,
            keywords: [server.row.name.toLowerCase(), name.toLowerCase(), 'mcp', 'внешний'],
            module: 'ext',
            kind: 'read',
            hot,
            input: genericInput,
            handler: async (input, ctx) => {
              const result = await server.client.callTool(
                descriptor.name,
                input as Record<string, unknown>,
                ctx.signal,
              );
              if (result.isError) {
                throw new McpError(
                  `${server.row.name}: ${server.client.redact(result.text) || 'инструмент вернул ошибку'}`,
                  'tool',
                );
              }
              return { text: result.text.slice(0, ASSISTANT_LIMITS.maxToolResultChars) };
            },
          }),
        );
      }
    }
    // В промпт уходят ЧЕЛОВЕЧЕСКИЕ названия («Интернет: поиск», «Git MCP: echo»),
    // а не сырые id вроде web_search_exa: иначе модель пересказывает их в ответе.
    digest.push(
      `${server.row.name} (${serverTools.length}): ${serverTools
        .slice(0, DIGEST_TOOLS)
        .map((item) => item.title)
        .join(', ')}${serverTools.length > DIGEST_TOOLS ? ', …' : ''}`,
    );
    tools.push(...serverTools);
  }
  return { tools, digest };
}

/** Человеческое название внешнего инструмента для строки вызова в ленте. */
export function externalToolTitle(id: string): string | null {
  if (!id.startsWith('ext.')) return null;
  const parts = id.split('.');
  const tool = parts.at(-1) ?? id;
  if (tool === 'web_search_exa') return 'Интернет: поиск';
  if (tool === 'web_fetch_exa') return 'Интернет: страница';
  const server = (parts[1] ?? '').replace(/-/g, ' ');
  return server ? `${server}: ${tool}` : `Внешний инструмент: ${tool}`;
}
