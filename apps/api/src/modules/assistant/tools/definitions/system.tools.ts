import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import { clip, entityLink, str } from '../projections.js';
import { searchTools } from '../search.js';

/**
 * Служебные инструменты (#892): контекст экрана, поиск по каталогу и ссылка
 * «Открыть» на сущность. Они не ходят в API портала: контекст пришёл от
 * клиента, каталог живёт здесь, ссылка строится из проверенных значений
 * (никаких адресов из текста модели — иначе это открытый редирект).
 */

export const contextGetTool = defineTool({
  id: 'context.get',
  title: 'Контекст экрана',
  description:
    'Где находится сотрудник: раздел портала и открытая карточка (тип и id). Вызывай первым, если вопрос начинается с «эта задача», «этот проект», «здесь».',
  keywords: ['контекст', 'где я', 'открытая карточка', 'текущий раздел', 'context'],
  module: 'system',
  kind: 'read',
  hot: true,
  input: z.object({}),
  handler: (_input, ctx) => {
    const screen = ctx.screen;
    const moduleLabel = screen.moduleId ? `раздел «${screen.moduleId}»` : 'раздел не определён';
    const card =
      screen.cardKind && screen.cardId
        ? `открыта карточка: ${kindLabel(screen.cardKind)} (id ${screen.cardId})`
        : 'карточка не открыта';
    return { text: `Сотрудник: ${moduleLabel}; ${card}.` };
  },
});

/** Человеческое имя вида карточки (для модели и для ссылки «Открыть»). */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'task':
      return 'задача';
    case 'project':
      return 'проект';
    case 'letter':
      return 'письмо';
    case 'conversation':
      return 'беседа';
    default:
      return kind;
  }
}

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(10).default(5),
});

export const toolsSearchTool = defineTool({
  id: 'tools.search',
  title: 'Поиск действий',
  description:
    'Поиск инструмента по каталогу портала, когда нужного действия нет в списке доступных: опиши задачу словами («история задачи», «вложения письма», «оргструктура»). Найденные инструменты станут доступны на следующем шаге.',
  keywords: ['поиск инструмента', 'каталог', 'что умеешь', 'действие', 'tools search'],
  module: 'system',
  kind: 'read',
  hot: false,
  input: searchInput,
  handler: (input, ctx) => {
    const matches = searchTools(ctx.available, input.query, input.limit);
    if (matches.length === 0) {
      return { text: `По запросу «${clip(input.query, 60)}» инструментов не найдено.` };
    }
    ctx.activate(matches.map((tool) => tool.id));
    const lines = matches.map(
      (tool) => `${tool.id} — ${tool.title}: ${clip(tool.description, 160)}`,
    );
    return {
      text: [
        `Найдено инструментов: ${matches.length} (доступны на следующем шаге):`,
        ...lines.map((line, index) => `${index + 1}. ${line}`),
      ].join('\n'),
    };
  },
});

const openEntityInput = z.object({
  kind: z.enum(['task', 'project', 'letter', 'employee', 'conversation']),
  id: z.uuid(),
  label: z.string().trim().max(200).optional(),
});

/** Виды карточек портала: беседа открывается как мессенджер-карточка. */
const CARD_KIND: Record<string, string> = {
  task: 'task',
  project: 'project',
  letter: 'letter',
  employee: 'employee',
  conversation: 'messenger',
};

export const uiOpenEntityTool = defineTool({
  id: 'ui.open_entity',
  title: 'Открыть сущность',
  description:
    'Готовит кнопку «Открыть» к карточке сущности в ответе: передай вид и id найденной сущности. Ничего не меняет — только ссылка для интерфейса.',
  keywords: ['открыть', 'ссылка', 'карточка', 'перейти', 'open'],
  module: 'system',
  kind: 'read',
  hot: true,
  input: openEntityInput,
  handler: (input) => {
    const cardKind = CARD_KIND[input.kind] ?? null;
    if (!cardKind) return { text: 'Такой вид карточки не открывается' };
    const label = str(input.label) ?? kindLabel(input.kind);
    const entity = entityLink(cardKind, input.id, label);
    return { text: `Ссылка на карточку готова: ${label}`, entity };
  },
});

export const systemTools = [contextGetTool, toolsSearchTool, uiOpenEntityTool];
