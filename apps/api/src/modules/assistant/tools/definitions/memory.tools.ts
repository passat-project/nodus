import { z } from 'zod';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { finalize } from '../projections.js';
import { memoryMeta } from './meta/memory.meta.js';

/**
 * Личная память сотрудника (#900): блокнот агента. Это НЕ данные портала —
 * запись в блокнот не требует подтверждения (решение владельца). Записи
 * делает агент сам, сотрудник может стереть их в окне «Блокнот».
 */

const saveInput = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(ASSISTANT_LIMITS.maxMemoryChars)
    .describe('Одна устойчивая запись: предпочтение или факт о сотруднике'),
});

export const memorySaveTool = defineTool({
  ...memoryMeta['memory.save'],
  id: 'memory.save',
  title: 'Блокнот: запомнить',
  description:
    'Записать в личный блокнот устойчивый факт о сотруднике или его предпочтение («отчёты — по пятницам», «отвечаю за проекты X»). Вызывай, когда сотрудник просит запомнить или когда факт пригодится в будущих диалогах. Не записывай секреты, пароли, содержимое писем и файлов. Одна запись до 300 знаков, лимит 50.',
  keywords: ['запомни', 'память', 'блокнот', 'предпочтение', 'remember', 'memory'],
  module: 'system',
  kind: 'read',
  hot: true,
  input: saveInput,
  handler: async (input, ctx) => {
    if (!ctx.memory) return { text: 'Блокнот недоступен в этом режиме' };
    const result = await ctx.memory.save(input.text);
    return {
      text: result.duplicate
        ? `Уже записано в блокнот: ${result.text}`
        : `Записано в блокнот: ${result.text}`,
    };
  },
});

export const memoryListTool = defineTool({
  ...memoryMeta['memory.list'],
  id: 'memory.list',
  title: 'Блокнот: записи',
  description:
    'Показать, что записано в личном блокноте сотрудника. Нужно, если он спрашивает «что ты обо мне помнишь» или перед записью нового факта.',
  keywords: [
    'что помнишь',
    'что обо мне помнишь',
    'блокнот',
    'записи памяти',
    'записи блокнота',
    'memory list',
  ],
  module: 'system',
  kind: 'read',
  // На горячей полке: модель должна уметь проверить блокнот без поиска —
  // иначе заявляет «memory.list нет» (живой отзыв 18.11.2026).
  hot: true,
  input: z.object({}),
  handler: async (_input, ctx) => {
    if (!ctx.memory) return { text: 'Блокнот недоступен в этом режиме' };
    const items = await ctx.memory.list();
    if (items.length === 0) return { text: 'Блокнот пуст' };
    const lines = items.map((item, index) => `${index + 1}. ${item.text} (id ${item.id})`);
    return { text: finalize(['Записи блокнота:', ...lines].join('\n')) };
  },
});

const forgetInput = z.object({ id: z.uuid() });

export const memoryForgetTool = defineTool({
  ...memoryMeta['memory.forget'],
  id: 'memory.forget',
  title: 'Блокнот: забыть',
  description:
    'Удалить запись из личного блокнота по id (id из memory.list). Удаление — архив: в диалогах запись больше не всплывает.',
  keywords: ['забудь', 'удали из памяти', 'forget', 'memory forget'],
  module: 'system',
  kind: 'read',
  hot: false,
  input: forgetInput,
  handler: async (input, ctx) => {
    if (!ctx.memory) return { text: 'Блокнот недоступен в этом режиме' };
    const removed = await ctx.memory.forget(input.id);
    return { text: removed ? 'Запись удалена из блокнота' : 'Запись не найдена' };
  },
});

export const memoryTools = [memorySaveTool, memoryListTool, memoryForgetTool];
