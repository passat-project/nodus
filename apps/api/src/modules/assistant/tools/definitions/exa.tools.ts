import { z } from 'zod';

import { McpError, type McpClient } from '../../mcp/mcp-client.js';
import { defineTool, type AssistantToolDefinition } from '../tool-definition.js';

/**
 * Внешние инструменты интернета через MCP-сервер (#901, ADR-0046): поиск и
 * чтение страниц. Первый (и пока единственный) сервер — Exa: он hosted, а
 * портал остаётся self-hosted (исключение I11 — только поиск, только Exa).
 *
 * Границы данных (решение владельца 17.11.2026): наружу уходит ТОЛЬКО
 * сформулированный моделью запрос и URL страницы. Тела писем, переписка,
 * вложения и дампы портала в аргументы не попадают — это правило промпта и
 * лимит длины запроса; инструменты портала остаются единственным источником
 * данных портала, результаты Exa — внешние данные.
 */

/** Имя инструмента на сервере Exa (MCP `tools/call`). */
export const EXA_SEARCH_MCP_TOOL = 'web_search_exa';
export const EXA_FETCH_MCP_TOOL = 'web_fetch_exa';

/** Идентификаторы в каталоге портала: `ext.<сервер>.<инструмент>`. */
export const EXA_SEARCH_TOOL_ID = 'ext.exa.web_search_exa';
export const EXA_FETCH_TOOL_ID = 'ext.exa.web_fetch_exa';

/** Запрос модели в поиск: короче — дешевле и без утечек длинных выдержек. */
const MAX_QUERY_CHARS = 400;
/** Потолок чтения страницы: хватает для факта/цены, а не для «скачать сайт». */
const MAX_FETCH_CHARS = 8_000;

const searchInput = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(MAX_QUERY_CHARS)
    .describe('Поисковый запрос обычным текстом: тема, объект, норма или товар'),
  numResults: z.number().int().min(1).max(10).default(5),
});

const fetchInput = z.object({
  url: z
    .url()
    .max(2_000)
    .refine((value) => /^https?:\/\//i.test(value), 'Нужен адрес http(s)')
    // Логин/пароль в URL уехали бы во внешний сервис и в логи — их не пускаем
    // (ревью #901).
    .refine((value) => {
      // refine-ы выполняются и после провала `z.url()`: мусор не должен
      // бросать исключение из схемы (иначе валидация падает 500).
      try {
        const url = new URL(value);
        return url.username === '' && url.password === '';
      } catch {
        return false;
      }
    }, 'Адрес без логина и пароля')
    .describe('Полный адрес страницы из результатов поиска'),
});

/**
 * Ответ сервера мог прийти «ошибкой инструмента» — превращаем в сбой вызова.
 * Текст ошибки — внешний: вырезаем ключ и ставим потолок (`McpClient.redact`),
 * иначе он уехал бы в промпт провайдера и в БД прогона (ревью #901).
 */
function assertToolOk(
  client: McpClient,
  result: { text: string; isError: boolean },
  action: string,
): string {
  if (result.isError) {
    throw new McpError(
      `${action}: ${client.redact(result.text) || 'сервер вернул ошибку'}`,
      'tool',
    );
  }
  return result.text;
}

/**
 * Инструменты Exa поверх живого MCP-клиента. Клиент создаётся на прогон из
 * настроек портала (`McpSettingsService.resolveForSearch`): нет сервера — нет
 * инструментов, портал работает как обычно.
 */
export function exaTools(client: McpClient): AssistantToolDefinition[] {
  const search = defineTool({
    id: EXA_SEARCH_TOOL_ID,
    title: 'Интернет: поиск',
    description:
      'Поиск в интернете (Exa): свежие нормы, цены, поставщики, публикации. Возвращает результаты со ссылками (название, адрес, фрагменты). Используй, когда сотрудник просит найти что-то ВНЕ портала; запрос формулируй как поисковую строку и не вставляй в него текст писем или переписки.',
    keywords: [
      'интернет',
      'поиск',
      'exa',
      'web',
      'новости',
      'цены',
      'поставщики',
      'найти в интернете',
    ],
    module: 'ext',
    kind: 'read',
    hot: true,
    input: searchInput,
    handler: async (input, ctx) => {
      const result = await client.callTool(
        EXA_SEARCH_MCP_TOOL,
        {
          query: input.query,
          numResults: input.numResults,
        },
        ctx.signal,
      );
      const text = assertToolOk(client, result, 'Поиск в интернете не выполнен');
      // Обёртку блока данных добавляет цикл прогона (asToolData): здесь —
      // чистый текст сервера, без двойных маркеров.
      return { text };
    },
  });

  const fetch = defineTool({
    id: EXA_FETCH_TOOL_ID,
    title: 'Интернет: страница',
    description:
      'Чтение страницы интернета по адресу (Exa): полный текст в Markdown для фактов, норм и цен. Адрес бери из результатов ext.exa.web_search_exa; содержимое портала и файлы сюда не отправляй.',
    keywords: ['страница', 'сайт', 'прочитать', 'url', 'fetch', 'web_fetch_exa'],
    module: 'ext',
    kind: 'read',
    hot: true,
    input: fetchInput,
    handler: async (input, ctx) => {
      const result = await client.callTool(
        EXA_FETCH_MCP_TOOL,
        {
          urls: [input.url],
          maxCharacters: MAX_FETCH_CHARS,
        },
        ctx.signal,
      );
      return { text: assertToolOk(client, result, 'Страница не прочитана') };
    },
  });

  return [search, fetch];
}

/** Сколько инструментов Exa нужно, чтобы сказать «интернет доступен». */
export const EXA_TOOL_IDS = [EXA_SEARCH_TOOL_ID, EXA_FETCH_TOOL_ID] as const;
