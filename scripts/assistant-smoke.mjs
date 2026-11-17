#!/usr/bin/env node
/**
 * Ночной/ручной смоук read-инструментов ассистента (#918, мера 4).
 *
 * Берёт карту поверхностей (`docs/architecture/assistant-surface.md`),
 * подставляет фикстурные аргументы из живых данных песочницы и дёргает
 * маршруты от имени сотрудника. Ловит поведенческий дрейф: маршрут переименали,
 * DTO сломался, инструмент стал 404/500 — отчёт со числом инструментов и
 * списком сбоев.
 *
 * Запуск (песочница live-stack, API :3011):
 *   node scripts/assistant-smoke.mjs [--base http://localhost:3011] [--user night-a@nodus.local]
 *
 * Выход 1 — есть сбои (HTTP ≥ 400/сеть); пустые списки и отсутствующие
 * фикстуры — предупреждения, а не сбой (данные песочницы меняются).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = path.join(ROOT, 'docs/architecture/assistant-surface.md');
const USERS = JSON.parse(readFileSync(path.join(ROOT, 'tests/e2e/e2e-users.json'), 'utf8'));

/** Разбор таблицы карты: только чтение + GET-маршрут. */
export function parseSurface(markdown) {
  const tools = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|/);
    if (!match) continue;
    const [, id, title, kind, module, api] = match;
    const apiMatch = api.trim().match(/^(GET|POST|PATCH|DELETE) (\S+)$/);
    tools.push({
      id,
      title: title.trim(),
      kind: kind.trim(),
      module: module.trim(),
      method: apiMatch?.[1] ?? null,
      path: apiMatch?.[2] ?? null,
    });
  }
  return tools;
}

/** Маршрут с подставленными id; null — фикстуры для параметра нет. */
export function substitutePath(template, module, ids) {
  const byParam = {
    ':id': ids.byModule[module] ?? null,
    ':taskId': ids.task ?? null,
    ':projectId': ids.project ?? null,
    ':userId': ids.user ?? null,
    ':conversationId': ids.conversation ?? null,
    ':code': ids.dictionary ?? null,
  };
  let unresolved = false;
  const path = template.replace(/:[a-zA-Z]+/g, (param) => {
    const value = byParam[param];
    if (!value) unresolved = true;
    return value ?? param;
  });
  return unresolved ? null : path;
}

/** Пустой результат — предупреждение, а не сбой (данные песочницы). */
export function isEmptyPayload(payload) {
  if (payload === null || payload === undefined) return true;
  if (Array.isArray(payload)) return payload.length === 0;
  if (typeof payload === 'object' && Array.isArray(payload.items))
    return payload.items.length === 0;
  return false;
}

async function call(base, token, method, text) {
  const response = await fetch(`${base}/api/v1${text}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: response.status, ok: response.ok, body };
}

async function login(base, user) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!response.ok) throw new Error(`login ${user.email} → ${response.status}`);
  const tokens = await response.json();
  if (!tokens.accessToken) throw new Error('login: нет accessToken в ответе');
  return tokens.accessToken;
}

/** Живые id песочницы: задачи, письма, проекты, беседы, сотрудники. */
async function discoverIds(base, token) {
  const ids = {
    byModule: {},
    task: null,
    letter: null,
    project: null,
    conversation: null,
    user: null,
    dictionary: null,
    file: null,
  };
  const grab = async (text, pick) => {
    try {
      const { ok, body } = await call(base, token, 'GET', text);
      return ok ? pick(body) : null;
    } catch {
      return null;
    }
  };
  const firstItem = (body) => body?.items?.[0] ?? null;
  const idsOf = (body) => (body?.items ?? []).map((item) => item?.id).filter(Boolean);
  ids.task = await grab('/tasks?limit=1', (body) => firstItem(body)?.id ?? null);
  ids.project = await grab('/projects?limit=1', (body) => firstItem(body)?.id ?? null);
  ids.dictionary = await grab('/dictionaries', (body) => {
    const item = firstItem(body) ?? body?.items?.[0];
    return item?.code ?? item?.key ?? null;
  });
  // Первое письмо — фикстура letters.*; отдельно ищем вложение, которое
  // files.extract_text умеет читать (PDF/DOCX) — XLSX даёт честный 415.
  const letterIds = (await grab('/letters?limit=5', idsOf)) ?? [];
  ids.letter = letterIds[0] ?? null;
  const conversationIds = (await grab('/chat/conversations?limit=3', idsOf)) ?? [];
  ids.conversation = conversationIds[0] ?? null;
  ids.user = await grab('/directory/users?limit=1', (body) => firstItem(body)?.id ?? null);
  const isExtractable = (file) =>
    /\.(pdf|docx)$/i.test(file?.name ?? '') || /pdf|wordprocessingml/i.test(file?.mime ?? '');
  const fileFromAttachments = (attachments) =>
    (attachments ?? []).find(isExtractable)?.fileId ?? null;
  for (const letterId of letterIds) {
    const file = await grab(`/letters/${letterId}`, (body) =>
      fileFromAttachments(body?.attachments),
    );
    if (file) {
      ids.file = file;
      break;
    }
  }
  if (!ids.file) {
    for (const conversationId of conversationIds) {
      const file = await grab(`/chat/conversations/${conversationId}/messages?limit=20`, (body) => {
        for (const message of body?.items ?? []) {
          const found = fileFromAttachments(message.attachments);
          if (found) return found;
        }
        return null;
      });
      if (file) {
        ids.file = file;
        break;
      }
    }
  }
  ids.byModule = {
    tasks: ids.task,
    letters: ids.letter,
    projects: ids.project,
    chat: ids.conversation,
    directory: ids.user,
    files: ids.file,
    workflows: null,
    system: null,
    dictionaries: ids.dictionary,
  };
  return ids;
}

export function buildReport({ total, results, skipped, base, user }) {
  const failures = results.filter((result) => !result.ok);
  const empty = results.filter((result) => result.ok && result.empty);
  const lines = [
    'Смоук read-инструментов ассистента (#918)',
    `База: ${base} · сотрудник: ${user}`,
    `Read-инструментов в карте: ${total}; проверено: ${results.length}; пустых: ${empty.length}; пропущено: ${skipped.length}; сбоев: ${failures.length}`,
  ];
  if (failures.length > 0) {
    lines.push('', 'Сбои:');
    for (const failure of failures) {
      lines.push(`- ${failure.id} (${failure.path}): ${failure.detail}`);
    }
  }
  if (empty.length > 0) {
    lines.push('', 'Пустой результат (проверьте данные песочницы):');
    for (const item of empty) lines.push(`- ${item.id}`);
  }
  if (skipped.length > 0) {
    lines.push('', 'Пропущено (нет фикстуры):');
    for (const item of skipped) lines.push(`- ${item.id}: ${item.reason}`);
  }
  return { lines: lines.join('\n'), failures: failures.length };
}

export async function runSmoke({ base, email, password }) {
  const surface = readFileSync(SURFACE, 'utf8');
  const readTools = parseSurface(surface).filter(
    (tool) => tool.kind === 'чтение' && tool.method === 'GET' && tool.path,
  );
  const token = await login(base, { email, password });
  const ids = await discoverIds(base, token);
  const results = [];
  const skipped = [];
  for (const tool of readTools) {
    const text = substitutePath(tool.path, tool.module, ids);
    if (!text) {
      skipped.push({ id: tool.id, reason: 'нет id фикстуры для параметра маршрута' });
      continue;
    }
    try {
      const response = await call(base, token, 'GET', text);
      if (response.status === 404 && tool.id === 'chat.task_conversation') {
        skipped.push({ id: tool.id, reason: 'у первой задачи нет чата (404 — легитимно)' });
        continue;
      }
      results.push({
        id: tool.id,
        path: text,
        ok: response.ok,
        empty: response.ok && isEmptyPayload(response.body),
        detail: response.ok ? 'ок' : `${response.status} ${response.body?.code ?? ''}`.trim(),
      });
    } catch (error) {
      results.push({
        id: tool.id,
        path: text,
        ok: false,
        empty: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const report = buildReport({ total: readTools.length, results, skipped, base, user: email });
  return { ...report, readTools: readTools.length };
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const base = arg('base', process.env.ASSISTANT_SMOKE_BASE ?? 'http://localhost:3011');
  const email = arg('user', USERS.nightA.email);
  const user = Object.values(USERS).find((item) => item.email === email) ?? USERS.nightA;
  const result = await runSmoke({ base, email: user.email, password: user.password });
  console.log(result.lines);
  process.exitCode = result.failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
