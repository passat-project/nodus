import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from './catalog.js';
import {
  hasCapability,
  keyRu,
  searchCatalog,
  simulateRouter,
  stemRu,
  understandQuery,
} from './retrieval.js';

/**
 * Понимание запроса (#926): единый скорер для tools.search и симулятора
 * диспетчера. Тесты держат живые формулировки и «право не знать»: если
 * операции в каталоге нет, симулятор возвращает пусто, а не натягивает
 * соседний инструмент.
 */

const ids = (tools: readonly { id: string }[]): string[] => tools.map((tool) => tool.id);

describe('нормализация и понимание запроса', () => {
  it('основа слова и ключ склеивают словоформы', () => {
    expect(stemRu('задачами')).toBe('задач');
    expect(stemRu('ёлки')).toBe(stemRu('елки'));
    expect(keyRu('напиши')).toBe(keyRu('написать'));
  });

  it('модуль, объект и класс действия из живой фразы', () => {
    const query = understandQuery('заверши задачу №1042 по объекту «Северный»');
    expect(query.modules.has('tasks')).toBe(true);
    expect(query.modules.has('projects')).toBe(true);
    expect(query.subjects.has('задача')).toBe(true);
    expect(query.intents.has('transition')).toBe(true);
    expect(query.entityNumber).toBe(true);
  });

  it('ссылка на открытую карточку распознаётся', () => {
    const query = understandQuery('покажи историю по этой задаче');
    expect(query.deictic).toBe(true);
    expect(query.subjects.has('задача')).toBe(true);
    expect(query.intents.has('history')).toBe(true);
  });
});

describe('tools.search: живые формулировки находят инструмент', () => {
  it.each([
    ['покажи мои задачи', 'tasks.list'],
    ['чё у меня по задачам?', 'tasks.list'],
    ['создай задачу «Проверить смету»', 'tasks.create'],
    ['прочитай текст акта КС-2', 'files.extract_text'],
    ['кто мой руководитель', 'me.get'],
    ['покажи вложения письма', 'letters.attachments'],
    ['структура проекта «Северный»', 'projects.structure'],
    ['найди сотрудника Петрова', 'directory.find_users'],
    ['покажи справочники', 'dictionaries.list'],
    ['история задачи №1042', 'tasks.history'],
    ['какие переходы у задачи', 'tasks.transitions'],
    ['запомни, что я ГИП', 'memory.save'],
    ['забудь заметку', 'memory.forget'],
  ])('«%s» → %s в top-7', (query, expected) => {
    expect(ids(searchCatalog(ALL_TOOLS, query, 7))).toContain(expected);
  });

  it('пустой запрос ничего не возвращает', () => {
    expect(searchCatalog(ALL_TOOLS, '   ', 7)).toEqual([]);
  });
});

describe('симулятор диспетчера: выбор и отказ', () => {
  it('находит список задач и отдаёт его первым', () => {
    expect(ids(simulateRouter(ALL_TOOLS, 'покажи мои задачи'))[0]).toBe('tasks.list');
  });

  it('переход задачи требует чтения переходов и самого перехода', () => {
    const top = ids(simulateRouter(ALL_TOOLS, 'заверши задачу №1042'));
    expect(top).toContain('tasks.transitions');
    expect(top).toContain('tasks.transition');
  });

  it('«создай проект» — projects.create, а не add_node', () => {
    expect(hasCapability(ALL_TOOLS, understandQuery('создай проект «Северный»'))).toBe(true);
    const top = ids(simulateRouter(ALL_TOOLS, 'создай проект «Северный»'));
    expect(top).toContain('projects.create');
    expect(top).not.toContain('projects.add_node');
  });

  it('удаление задачи — операции нет, отказ', () => {
    expect(simulateRouter(ALL_TOOLS, 'удали задачу №1042')).toEqual([]);
  });

  it('создание и отправка письма — операций нет, отказ', () => {
    expect(simulateRouter(ALL_TOOLS, 'создай письмо на имя Петрова')).toEqual([]);
    expect(simulateRouter(ALL_TOOLS, 'отправь письмо Петрову')).toEqual([]);
  });

  it('создание справочника и публикация процесса — отказ', () => {
    expect(simulateRouter(ALL_TOOLS, 'создай справочник «Виды работ»')).toEqual([]);
    expect(simulateRouter(ALL_TOOLS, 'опубликуй процесс согласования')).toEqual([]);
  });

  it('личное сообщение — инструмент отправки в top-7', () => {
    expect(ids(simulateRouter(ALL_TOOLS, 'напиши Петрову, что задача готова'))).toContain(
      'chat.direct_message',
    );
  });
});
