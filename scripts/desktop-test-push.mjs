/**
 * Тестовые пуши для живой проверки попапов оболочки (#820, выделено из #709).
 *
 * Песочница live-stack: api :3011, изолированная БД nodus_night. Пользователи —
 * tests/e2e/e2e-users.json (единый источник сред, #247): владелец в сиде —
 * `second`, отправители — `nightB` (шлёт сообщение) и `nightA` (второй диалог).
 *
 * Почему два диалога: попап не показывается, если человек СМОТРИТ в ту же
 * беседу (`desktop-notify.ts`: looking = активен && открыта эта беседа).
 * Поэтому печатать надо в диалоге с night-a, а сообщение приходит от night-b
 * в другой диалог — иначе попапа не будет и проверка «не работает».
 *
 * Использование (из корня репозитория):
 *   node scripts/desktop-test-push.mjs setup        # создать оба диалога, напечатать где печатать
 *   node scripts/desktop-test-push.mjs send [текст] # night-b пишет владельцу
 *
 * Другой контур (по умолчанию http://127.0.0.1:3011):
 *   PUSH_API=http://127.0.0.1:3001 node scripts/desktop-test-push.mjs setup
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = (process.env.PUSH_API ?? 'http://127.0.0.1:3011').replace(/\/+$/, '');
const USERS_FILE = fileURLToPath(new URL('../tests/e2e/e2e-users.json', import.meta.url));
const users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));

const OWNER = requireUser('second');
const SENDER = requireUser('nightB');
const PEER = requireUser('nightA');

function requireUser(key) {
  const user = users[key];
  if (!user?.email || !user?.password) {
    throw new Error(`tests/e2e/e2e-users.json: нет пользователя "${key}" (email/password)`);
  }
  return user;
}

async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function login({ email, password }) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return (await res.json()).accessToken;
}

async function me(token) {
  const res = await request('/auth/me', { token });
  return (await res.json()).id;
}

/** Личный диалог с пользователем (идемпотентно: сервер отдаёт существующий). */
async function direct(token, otherId) {
  const res = await request(`/chat/conversations/direct/${otherId}`, {
    method: 'POST',
    token,
  });
  return (await res.json()).id;
}

async function send(token, conversationId, text) {
  const res = await request(`/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    token,
    headers: {
      // Мутации идемпотентны (I7): ключ уникален на вызов — повторный запуск
      // команды даёт новое сообщение, а не дубль старого.
      'Idempotency-Key': `desktop-push-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: { text },
  });
  const payload = await res.json();
  return payload.id ?? null;
}

async function main() {
  // Скрипт пишет сообщения от тестовых учёток из ПУБЛИЧНОЙ фикстуры
  // (tests/e2e/e2e-users.json): по умолчанию — только песочница на этом же ПК.
  // Чужой хост — осознанный запуск (PUSH_ALLOW_REMOTE=1), чтобы тестовые
  // сообщения не улетали в боевой контур по ошибке.
  const host = new URL(API).hostname;
  if (
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host) &&
    process.env.PUSH_ALLOW_REMOTE !== '1'
  ) {
    throw new Error(
      `PUSH_API ${API}: разрешён только loopback (песочница); ` +
        'для осознанного запуска задайте PUSH_ALLOW_REMOTE=1',
    );
  }

  const command = process.argv[2] ?? 'setup';
  if (command === '--help' || command === 'help') {
    console.log('node scripts/desktop-test-push.mjs setup | send [текст]');
    console.log(`api: ${API} (переопределяется PUSH_API)`);
    return;
  }

  const ownerToken = await login(OWNER);
  const ownerId = await me(ownerToken);
  const senderToken = await login(SENDER);
  const peerToken = await login(PEER);

  const chatWithSender = await direct(senderToken, ownerId);
  const chatWithPeer = await direct(peerToken, ownerId);

  if (command === 'setup') {
    // Подсказка оператору: где печатать и откуда придёт попап.
    console.log(`api            : ${API}`);
    console.log(`владелец       : ${OWNER.email} (${ownerId})`);
    console.log(`печатать в     : диалог с ${PEER.email} — ${chatWithPeer}`);
    console.log(`попап придёт из: диалог с ${SENDER.email} — ${chatWithSender}`);
    return;
  }

  if (command === 'send') {
    const text = process.argv[3] ?? `Проба попапа ${new Date().toLocaleTimeString('ru-RU')}`;
    const id = await send(senderToken, chatWithSender, text);
    console.log(`отправлено ${SENDER.email} → ${OWNER.email}: ${text} (${id ?? 'id?'})`);
    return;
  }

  throw new Error(`неизвестная команда: ${command} (setup | send [текст])`);
}

main().catch((error) => {
  console.error('desktop-test-push:', error.message);
  process.exitCode = 1;
});
