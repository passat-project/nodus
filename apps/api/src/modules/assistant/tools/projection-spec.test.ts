import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compileProjection } from './projection-spec.js';
import { defineTool } from './tool-definition.js';

/**
 * Декларативная проекция (#926): типовое чтение описывается данными, а не
 * функцией. Тесты держат форматы, ссылку «Открыть» и границы пустых ответов.
 */

describe('detail-проекция', () => {
  const project = compileProjection({
    kind: 'detail',
    heading: 'Проект',
    fields: [
      { path: 'name', label: 'Название' },
      { path: 'type.name', label: 'Тип', format: 'name' },
      { path: 'deadline', label: 'Срок', format: 'date' },
      { path: 'isSecret', label: 'Секретный', format: 'bool' },
      { path: 'missing', label: 'Нет поля' },
    ],
    link: { kind: 'project', idPath: 'id', labelPath: 'name' },
  });

  it('собирает человеческие поля и ссылку на карточку', () => {
    const result = project({
      id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
      name: 'Северный',
      type: { name: 'Жилой' },
      deadline: '2026-11-14T00:00:00.000Z',
      isSecret: true,
    });
    expect(result.text).toContain('Проект');
    expect(result.text).toContain('Название: Северный');
    expect(result.text).toContain('Тип: Жилой');
    expect(result.text).toContain('Срок: 14 ноя 2026');
    expect(result.text).toContain('Секретный: да');
    expect(result.text).not.toContain('Нет поля');
    expect(result.entity).toEqual({
      href: '?cards=project:6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
      label: 'Северный',
    });
  });

  it('без тела ответа честно говорит «недоступны»', () => {
    expect(project(null).text).toContain('данные недоступны');
  });
});

describe('list-проекция', () => {
  const list = compileProjection({
    kind: 'list',
    heading: 'Задачи',
    fields: [
      { path: 'number', label: '№', format: 'number' },
      { path: 'title', label: 'Название' },
      { path: 'deadline', label: 'Срок', format: 'date' },
    ],
    more: true,
  });

  it('строки пагинации и пометка следующей страницы', () => {
    const result = list({
      items: [
        { number: 1042, title: 'Проверить смету', deadline: '2026-11-20T00:00:00.000Z' },
        { title: 'Без номера' },
        null,
      ],
      nextCursor: 'abc',
    });
    expect(result.text).toContain('Задачи: 2');
    expect(result.text).toContain('№: 1042 · Название: Проверить смету · Срок: 20 ноя 2026');
    expect(result.text).toContain('Название: Без номера');
    expect(result.text).toContain('следующая страница');
  });

  it('пустой список — честное «пусто»', () => {
    expect(list({ items: [] }).text).toContain('(пусто)');
  });
});

describe('defineTool: проекция компилируется, конфликт ловится', () => {
  const base = {
    id: 'demo.list' as const,
    title: 'Демо',
    description: 'Демонстрационный инструмент для теста компиляции проекции.',
    keywords: ['демо'],
    module: 'system' as const,
    kind: 'read' as const,
    hot: false,
    input: z.object({}),
  };

  it('projection становится project', () => {
    const tool = defineTool({
      ...base,
      api: { method: 'GET', path: '/demo' },
      build: () => ({ path: '/demo' }),
      projection: { kind: 'list', heading: 'Демо', fields: [{ path: 'name', label: 'Имя' }] },
    });
    expect(tool.project).toBeTypeOf('function');
    expect(tool.project!({ items: [{ name: 'Тест' }] }, {}, undefined).text).toContain('Имя: Тест');
  });

  it('project и projection вместе — ошибка регистрации', () => {
    expect(() =>
      defineTool({
        ...base,
        api: { method: 'GET', path: '/demo' },
        build: () => ({ path: '/demo' }),
        project: () => ({ text: 'ok' }),
        projection: { kind: 'list', heading: 'Демо', fields: [] },
      }),
    ).toThrow(/взаимоисключающ/);
  });
});
