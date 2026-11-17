import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildReport, isEmptyPayload, parseSurface, substitutePath } from './assistant-smoke.mjs';

/**
 * Смоук #918: чистые части — разбор карты поверхностей, подстановка
 * фикстурных id и отчёт (число инструментов + список сбоев).
 */

const SURFACE = [
  '# Карта',
  '| Инструмент | Название | Вид | Модуль | API | Право | Флаг | Горячая |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| `tasks.get` | Задачи: карточка | чтение | tasks | GET /tasks/:id | — | tasks | да |',
  '| `tasks.create` | Задачи: создать | запись | tasks | POST /tasks | task.create | tasks | да |',
  '| `context.get` | Контекст экрана | чтение | system | — | — | — | да |',
  '| `letters.list` | Письма: реестр | чтение | letters | GET /letters | — | correspondence | да |',
];

describe('parseSurface: карта поверхностей (#918)', () => {
  it('берёт id, вид, модуль и метод/маршрут', () => {
    const tools = parseSurface(SURFACE.join('\n'));
    assert.equal(tools.length, 4);
    assert.deepEqual(tools[0], {
      id: 'tasks.get',
      title: 'Задачи: карточка',
      kind: 'чтение',
      module: 'tasks',
      method: 'GET',
      path: '/tasks/:id',
    });
    assert.equal(tools[2].method, null);
    assert.equal(tools[3].path, '/letters');
  });
});

describe('substitutePath: фикстурные аргументы', () => {
  const ids = {
    task: 'task-1',
    project: null,
    user: 'user-1',
    conversation: 'conv-1',
    dictionary: 'task_stage',
    byModule: { tasks: 'task-1', projects: null, directory: 'user-1' },
  };

  it('подставляет параметры по имени и модулю', () => {
    assert.equal(substitutePath('/tasks/:id', 'tasks', ids), '/tasks/task-1');
    assert.equal(
      substitutePath('/directory/users/:id', 'directory', ids),
      '/directory/users/user-1',
    );
    assert.equal(
      substitutePath('/dictionaries/:code/items', 'dictionaries', ids),
      '/dictionaries/task_stage/items',
    );
    assert.equal(
      substitutePath('/chat/conversations/by-task/:taskId', 'chat', ids),
      '/chat/conversations/by-task/task-1',
    );
    assert.equal(substitutePath('/letters', 'letters', ids), '/letters');
  });

  it('нет фикстуры — null, а не мусорный запрос', () => {
    assert.equal(substitutePath('/projects/:id', 'projects', ids), null);
  });
});

describe('isEmptyPayload и отчёт', () => {
  it('пустые списки и null — предупреждение', () => {
    assert.equal(isEmptyPayload(null), true);
    assert.equal(isEmptyPayload([]), true);
    assert.equal(isEmptyPayload({ items: [] }), true);
    assert.equal(isEmptyPayload({ items: [{ id: 1 }] }), false);
    assert.equal(isEmptyPayload({ ok: true }), false);
  });

  it('отчёт считает проверенные, пустые, пропущенные и сбои', () => {
    const report = buildReport({
      total: 4,
      base: 'http://localhost:3011',
      user: 'night-a@nodus.local',
      results: [
        { id: 'tasks.list', path: '/tasks', ok: true, empty: false, detail: 'ок' },
        { id: 'letters.list', path: '/letters', ok: true, empty: true, detail: 'ок' },
        {
          id: 'projects.list',
          path: '/projects',
          ok: false,
          empty: false,
          detail: '500 INTERNAL_ERROR',
        },
      ],
      skipped: [{ id: 'files.extract_text', reason: 'нет файла' }],
    });
    assert.equal(report.failures, 1);
    assert.match(report.lines, /проверено: 3; пустых: 1; пропущено: 1; сбоев: 1/);
    assert.match(report.lines, /projects\.list.*500 INTERNAL_ERROR/);
    assert.match(report.lines, /files\.extract_text: нет файла/);
  });
});
