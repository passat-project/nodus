// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';

import { rememberMockLogin, resetMockLogin } from '../../mocks/mock-actor.js';
import { forceMockExportQueue, viewsHandlers } from './mocks/views-handlers.js';

/**
 * Мок-домен /views (#435): CRUD настроек, изоляция личных видов (чужие не
 * видны), общая проектная видна всем участникам, выгрузка CSV — синхронная
 * (done + файл с BOM) и фоновая (queued → поллинг статуса).
 */

const server = setupServer(...viewsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  resetMockLogin();
  forceMockExportQueue(false);
});

const ALICE = 'user1@passatproekt.by';
const BOB = 'user2@passatproekt.by';
const PROJECT = '34000000-0000-4000-8000-000000000001';

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`/api/v1${path}`, init);
  return { status: response.status, body: (await response.json()) as T };
}

const viewBody = (over: Record<string, unknown> = {}) => ({
  method: 'POST' as const,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Переработки',
    entity: 'task',
    scope: { kind: 'journal' },
    filter: [],
    sort: [],
    totals: [],
    columns: [],
    ...over,
  }),
});

interface ViewDto {
  id: string;
  name: string;
  level: string;
  scope: { kind: string; projectId?: string };
}

describe('мок /views: настройки и изоляция (#435)', () => {
  it('личный вид журнала виден только владельцу', async () => {
    rememberMockLogin(ALICE);
    const created = await json<ViewDto>('/views', viewBody());
    expect(created.status).toBe(201);
    expect(created.body.level).toBe('personal');

    rememberMockLogin(BOB);
    const bobList = await json<ViewDto[]>('/views?journal=true');
    expect(bobList.body.some((view) => view.id === created.body.id)).toBe(false);

    rememberMockLogin(ALICE);
    const aliceList = await json<ViewDto[]>('/views?journal=true&entity=task');
    expect(aliceList.body.some((view) => view.id === created.body.id)).toBe(true);

    // Удаление: владелец может, чужой — 404.
    rememberMockLogin(BOB);
    const foreign = await fetch(`/api/v1/views/${created.body.id}`, { method: 'DELETE' });
    expect(foreign.status).toBe(404);
    rememberMockLogin(ALICE);
    const removed = await fetch(`/api/v1/views/${created.body.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
  });

  it('общая проектная видна другому участнику рамки', async () => {
    rememberMockLogin(ALICE);
    const created = await json<ViewDto>(
      '/views',
      viewBody({ name: 'Сметы', scope: { kind: 'project', projectId: PROJECT }, level: 'project' }),
    );
    expect(created.body.level).toBe('project');

    rememberMockLogin(BOB);
    const list = await json<ViewDto[]>(`/views?projectId=${PROJECT}`);
    expect(list.body.some((view) => view.id === created.body.id)).toBe(true);
  });
});

describe('мок /views/export: CSV синхронно и фоном (#435)', () => {
  const exportBody = () => ({
    method: 'POST' as const,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entity: 'folder',
      scope: { kind: 'project', projectId: PROJECT },
      filter: [],
      sort: [],
      columns: [{ field: 'name' }, { field: 'kind' }],
    }),
  });

  it('малая выборка — done сразу, файл с BOM и «;»', async () => {
    rememberMockLogin(ALICE);
    const result = await json<{ status: string; url?: string }>('/views/export', exportBody());
    expect(result.body.status).toBe('done');
    expect(result.body.url).toContain('/files/');

    const file = await fetch(result.body.url!);
    expect(file.status).toBe(200);
    // BOM живёт в байтах (EF BB BF): fetch .text() снимает его при декоде,
    // а русский Excel видит подпись именно в байтах ответа.
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8').decode(bytes.slice(3));
    expect(csv.split('\r\n')[0]).toBe('name;kind');
  });

  it('фоновая ветка: queued → поллинг статуса → done', async () => {
    vi.useFakeTimers();
    try {
      forceMockExportQueue(true);
      rememberMockLogin(ALICE);
      const result = await json<{ status: string; exportId?: string }>(
        '/views/export',
        exportBody(),
      );
      expect(result.body.status).toBe('queued');
      const exportId = result.body.exportId!;

      const status = () => json<{ status: string; url?: string }>(`/views/export/${exportId}`);
      // Воркер мока завершает выгрузку через 50 мс, поллинг — каждые 3 с.
      const polling = status();
      await vi.advanceTimersByTimeAsync(4_000);
      const first = await polling;
      expect(['queued', 'running', 'done']).toContain(first.body.status);
      await vi.advanceTimersByTimeAsync(4_000);
      const done = await status();
      expect(done.body.status).toBe('done');
      expect(done.body.url).toContain('/files/');
    } finally {
      vi.useRealTimers();
    }
  });
});
