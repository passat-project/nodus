import { expect, test, type Page } from '@playwright/test';
import { ADMIN, SECOND } from '../e2e-users.js';

/**
 * Живой чат между двумя сессиями (#104, критичный путь из AGENTS.md):
 * доставка сообщения <1 с через WS-шлюз, индикатор «печатает…», просмотр
 * (галочка «просмотрено») без перезагрузки, догон после разрыва сети;
 * раунд 2 (#102): просмотр = видимость в вьюпорте (прокрутка), удаление
 * доставляется <1 с.
 *
 * Требует живой стек: api (прокси /api), gateway (прокси /socket.io) и
 * non-mock сборку web. Запуск:
 *   E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173 npx playwright test specs/chat-two-sessions-live.spec.ts
 * Тест создаёт свою группу (заголовок e2e-ws-*) и чистит её в конце.
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const BASE_URL = process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173';
const PEER = SECOND;
const RUN = Date.now().toString(36);
const TITLE = `e2e-ws-${RUN}`;

test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку (без моков)');

interface AuthSession {
  token: string;
  userId: string;
}

/** Логин через API (токен + id пользователя из справочника). */
async function apiLogin(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `e2e-ws-${RUN}-${email}` },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  const body = (await res.json()) as { accessToken: string; user?: { id: string } };
  expect(body.accessToken).toBeTruthy();
  return { token: body.accessToken, userId: body.user?.id ?? '' };
}

async function apiGet(token: string, path: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
}

function apiPost(token: string, path: string, body: unknown, key: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

/** Строка ниже сгиба вьюпорта или исчезла из DOM (px за сгибом; 9999 — нет).
 *  Playwright-видимость для свежедописанных строк НЕНАДЁЖНА: content-visibility
 *  вырезает содержимое вне вьюпорта асинхронно — в медленном CI box ещё
 *  существует и toBeHidden флакует (repro 25.09, геометрия: строка на
 *  +2500px за сгибом, а «visible»). Честный критерий — геометрия. */
async function belowFoldOrGone(page: Page, text: string): Promise<number> {
  return page.evaluate((needle) => {
    const vp = document.querySelector('[data-slot="message-scroller-viewport"]');
    if (!vp) return 9999;
    const el = Array.from(vp.querySelectorAll('[data-message-id]')).find((n) =>
      n.textContent?.includes(needle),
    );
    if (!el) return 9999;
    return Math.round(el.getBoundingClientRect().bottom - vp.getBoundingClientRect().bottom);
  }, text);
}

test.describe('живой чат: две сессии (#104)', () => {
  let admin: AuthSession;
  let conversationId: string;

  test.beforeAll(async () => {
    admin = await apiLogin(ADMIN.email, ADMIN.password);

    // Своя группа на прогон: реальные личные чаты не трогаем.
    const users = await apiGet(admin.token, '/directory/users?limit=100');
    expect(users.status).toBe(200);
    const { items } = (await users.json()) as { items: { id: string; email: string }[] };
    const peerRow = items.find((u) => u.email === PEER.email);
    expect(peerRow, 'второй пользователь в справочнике').toBeTruthy();

    const created = await fetch(`${BASE_URL}/api/v1/chat/conversations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${admin.token}`,
        'Idempotency-Key': `e2e-ws-${RUN}-conv`,
      },
      body: JSON.stringify({ type: 'group', title: TITLE, memberIds: [peerRow!.id] }),
    });
    expect(created.status).toBe(201);
    conversationId = ((await created.json()) as { id: string }).id;
  });

  test.afterAll(async () => {
    // Уборка своей группы (endpoint-а удаления бесед нет — чистим списком:
    // читаем остатки по заголовку; полная очистка — psql-скриптом прогона).
    if (!conversationId) return;
    await apiGet(admin.token, `/chat/conversations/${conversationId}/messages`).catch(
      () => undefined,
    );
  });

  async function loginUi(page: Page, email: string, password: string): Promise<void> {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Рабочая почта').fill(email);
    await page.getByLabel('Пароль').fill(password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/home$/);
  }

  test('«супер-курсор» переживает селект-режим (#104 раунд 2)', async ({ browser }) => {
    // Своё свежее сообщение (низ ленты): тест самодостаточен — не зависит
    // от сообщений предыдущих тестов.
    const seedText = `e2e-ws-${RUN}-caret-seed`;
    const seeded = await apiPost(
      admin.token,
      `/chat/conversations/${conversationId}/messages`,
      { text: seedText },
      `e2e-ws-${RUN}-caret-seed`,
    );
    expect(seeded.status).toBe(201);

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await loginUi(pageA, ADMIN.email, ADMIN.password);
    await pageA.goto(`/chat/${conversationId}`);
    const composer = pageA.getByPlaceholder(/Написать сообщение/i);
    await expect(composer).toBeVisible();

    // Селект-режим размонтирует textarea (островок батч-команд), выход
    // монтирует НОВЫЙ узел — каретка обязана выжить: «Ответить» из ПКМ-меню
    // и ввод с клавиатуры попадают в композер без клика мышью (репро 25.09).
    // ПКМ по ТЕКСТУ сообщения: центр строки своего сообщения — пустое место
    // слева от пузыря, до триггера меню событие не доходит.
    const feedA = pageA.locator('[data-slot="message-scroller-viewport"]');
    await feedA.getByText(seedText).click({ button: 'right' });
    await pageA.getByRole('menuitem', { name: 'Выбрать' }).click();
    // #132 р.1: команда выхода переименована «Снять выделение» →
    // «Отменить выбор» (модель Telegram).
    await expect(pageA.getByRole('button', { name: /отменить выбор/i })).toBeVisible();

    await pageA.getByRole('button', { name: /отменить выбор/i }).click();
    await expect(composer).toBeVisible({ timeout: 3_000 }); // фаза exit → normal

    await feedA.getByText(seedText).click({ button: 'right' });
    await pageA.getByRole('menuitem', { name: 'Ответить' }).click();
    const typed = `e2e-ws-${RUN}-caret`;
    // Каретка обязана вернуться сама (focusComposerWhenFree меню) — без клика.
    await expect(composer).toBeFocused({ timeout: 3_000 });
    await pageA.keyboard.type(typed);
    await expect(composer).toHaveValue(new RegExp(`${typed}$`));

    await contextA.close();
  });

  test('сообщение приходит <1 c, «печатает…», прочитано, догон после офлайна', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginUi(pageA, ADMIN.email, ADMIN.password);
    await loginUi(pageB, PEER.email, PEER.password);

    // Обе сессии открывают беседу прогона (deep-link).
    await pageA.goto(`/chat/${conversationId}`);
    await pageB.goto(`/chat/${conversationId}`);
    await expect(pageA.getByText(TITLE).first()).toBeVisible();
    await expect(pageB.getByText(TITLE).first()).toBeVisible();

    // «Печатает…»: A набирает — индикатор в шапке беседы у B.
    const composer = pageA.getByPlaceholder(/Написать сообщение/i);
    await composer.click();
    await composer.fill('набираю текст');
    await expect(pageB.getByText('печатает…').first()).toBeVisible({ timeout: 5_000 });
    await composer.clear();

    // Доставка <1 c (цель p95 <200 мс — здесь грубая e2e-граница из спеки).
    const msg1 = `e2e-ws-${RUN}-msg1`;
    const started = Date.now();
    await composer.fill(msg1);
    await composer.press('Enter');
    await expect(pageB.getByText(msg1).first()).toBeVisible({ timeout: 5_000 });
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: 'latency', description: `delivery ${elapsed} ms` });
    expect(elapsed).toBeLessThan(1_000);

    // Просмотрено без F5 (#102 раунд 2: квитанция видимости → watermark →
    // событие → галочки у A; низ беседы у B открыт — квитанция уходит сама).
    await expect(pageA.getByLabel('просмотрено').first()).toBeVisible({ timeout: 10_000 });

    // Разрыв сети: B офлайн → A шлёт второе → B возвращается и догоняет.
    await contextB.setOffline(true);
    const msg2 = `e2e-ws-${RUN}-msg2`;
    await composer.fill(msg2);
    await composer.press('Enter');
    await expect(pageA.getByText(msg2).first()).toBeVisible({ timeout: 5_000 });
    await expect(pageB.getByText(msg2)).toBeHidden(); // офлайн — не видел
    await contextB.setOffline(false);
    await expect(pageB.getByText(msg2).first()).toBeVisible({ timeout: 20_000 });

    await contextA.close();
    await contextB.close();
  });

  test('просмотр по вьюпорту (прокрутка) и удаление <1 c (#102/#104 раунд 2)', async ({
    browser,
  }) => {
    // Длинная беседа: ОБЯЗАН переполнять вьюпорт на любых шрифтах/машинах
    // (раунд 3: с якорем первого непрочитанного B открывается у начала хвоста;
    // на сжатых CI-шрифтах короткие строки влезали в экран целиком — «ниже
    // вьюпорта» не существовало и premise теста ломался). Гарантия — ВЫСОТА
    // сообщений (8 строк × 12), а не их количество: 40 запросов роняли воркер
    // Playwright внутренним assert'ом на финализации (repro 25.09).
    const tall = (i: number) =>
      'e2e-ws-' +
      RUN +
      '-fill-' +
      i +
      '\n' +
      Array.from({ length: 8 }, (_, k) => 'строка ' + i + '.' + (k + 1)).join('\n');
    for (let i = 1; i <= 12; i += 1) {
      const res = await apiPost(
        admin.token,
        `/chat/conversations/${conversationId}/messages`,
        { text: tall(i) },
        `e2e-ws-${RUN}-fill-${i}`,
      );
      expect(res.status).toBe(201);
      await res.json();
    }

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginUi(pageA, ADMIN.email, ADMIN.password);
    await loginUi(pageB, PEER.email, PEER.password);
    await pageA.goto(`/chat/${conversationId}`);
    await pageB.goto(`/chat/${conversationId}`);
    await expect(pageA.getByText(TITLE).first()).toBeVisible();

    // B прокручивает ленту ВВЕРХ КОЛЕСОМ (реальное намерение пользователя:
    // программный scrollTop примитив MessageScroller считает «не-жестом» и
    // автоскроллит обратно к низу — тогда тест теряет свой смысл).
    // ГАРДЫ premise: (1) лента B обязана быть загружена ДО колеса — на
    // медленном CI колесо по пустому/верхнему скроллеру тратилось впустую,
    // авто-догон ставил B вниз и msg3 оставался видимым; (2) после колеса
    // утверждаем, что верх ДОСТИГНУТ (msg1 из теста 1) — иначе тест падает
    // громко в месте причины, а не следствия.
    const viewportB = pageB.locator('[data-slot="message-scroller-viewport"]');
    await expect(viewportB.locator('[data-message-id]').first()).toBeVisible({
      timeout: 10_000,
    });
    const boxB = await viewportB.boundingBox();
    await pageB.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2);
    await pageB.mouse.wheel(0, -10_000);
    await expect(
      pageB.getByText(`e2e-ws-${RUN}-msg1`, { exact: true }).first(),
      'B доехал колесом до верха истории',
    ).toBeVisible({ timeout: 5_000 });

    const msg3 = `e2e-ws-${RUN}-msg3`;
    const composer = pageA.getByPlaceholder(/Написать сообщение/i);
    await composer.click();
    await composer.fill(msg3);
    await composer.press('Enter');

    // Сообщение видно у A, но не у B (ниже вьюпорта). Текст ищем В ЛЕНТЕ:
    // превью последнего сообщения в списке бесед содержит тот же текст.
    await expect(pageA.getByText(msg3).first()).toBeVisible({ timeout: 5_000 });
    // Сообщение НИЖЕ СГИба у B — геометрически (см. belowFoldOrGone).
    await expect.poll(() => belowFoldOrGone(pageB, msg3), { timeout: 5_000 }).toBeGreaterThan(4);
    // …и НЕ просмотрено: квитанция видимости не уходила (старая модель —
    // «выдача ленты двигает курсор» — прочла бы мгновенно; окно 1.5 с).
    await pageA.waitForTimeout(1_500);
    const rowA = pageA.locator('[data-message-id]', { hasText: msg3 }).first();
    await expect(rowA.getByLabel('отправлено')).toBeVisible();
    await expect(rowA.getByLabel('просмотрено')).toBeHidden();

    // B возвращается вниз: сообщение видно → квитанция → «просмотрено» у A.
    await pageB.mouse.wheel(0, 10_000);
    await pageB.waitForTimeout(300);
    await expect(pageB.getByText(msg3, { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect(rowA.getByLabel('просмотрено')).toBeVisible({ timeout: 10_000 });

    // Удаление доставляется <1 c: A удаляет (без ответов → бесследно, #163) —
    // текст у B пропадает через WS-инвалидацию без перезагрузки.
    const list = await apiGet(admin.token, `/chat/conversations/${conversationId}/messages`);
    const { items } = (await list.json()) as { items: { id: string; text?: string }[] };
    const target = items.find((m) => m.text === msg3);
    expect(target, 'сообщение прогона в ленте').toBeTruthy();
    const started = Date.now();
    const deleted = await fetch(
      `${BASE_URL}/api/v1/chat/conversations/${conversationId}/messages/${target!.id}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${admin.token}`, 'Idempotency-Key': `e2e-ws-${RUN}-del` },
      },
    );
    expect(deleted.status).toBe(204); // нет ответов → бесследно (#163)
    await expect.poll(() => belowFoldOrGone(pageB, msg3), { timeout: 5_000 }).toBeGreaterThan(4); // удалено → строки нет; надгробие-«удалено» не содержит текста
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: 'latency', description: `delete delivery ${elapsed} ms` });
    expect(elapsed).toBeLessThan(1_000);

    await contextA.close();
    await contextB.close();
  });

  test('неактивное окно не читает; возврат внимания дочитывает (#770)', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginUi(pageA, ADMIN.email, ADMIN.password);
    await loginUi(pageB, PEER.email, PEER.password);
    await pageA.goto(`/chat/${conversationId}`);
    await pageB.goto(`/chat/${conversationId}`);
    await expect(pageA.getByText(TITLE).first()).toBeVisible();
    await expect(pageB.getByText(TITLE).first()).toBeVisible();

    // B активно читает: у низа ленты (реальная прокрутка = ввод).
    const viewportA = pageA.locator('[data-slot="message-scroller-viewport"]');
    const viewportB = pageB.locator('[data-slot="message-scroller-viewport"]');
    await expect(viewportB.locator('[data-message-id]').first()).toBeVisible({
      timeout: 10_000,
    });
    const boxB = await viewportB.boundingBox();
    await pageB.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2);
    await pageB.mouse.wheel(0, 10_000);
    await pageB.waitForTimeout(300);

    // B «уходит»: окно теряет фокус (в оболочке WebView2 может сохранять и
    // visibilityState, и hasFocus — сигналом служит blur/минимизация).
    await pageB.evaluate(() => window.dispatchEvent(new Event('blur')));

    const msg = `e2e-ws-${RUN}-focus`;
    const composer = pageA.getByPlaceholder(/Написать сообщение/i);
    await composer.click();
    await composer.fill(msg);
    await composer.press('Enter');
    await expect(pageA.getByText(msg).first()).toBeVisible({ timeout: 5_000 });
    // Строка доехала до B (WS), но окно не активно — она не «просмотрена».
    await expect(viewportB.locator('[data-message-id]', { hasText: msg }).first()).toBeAttached({
      timeout: 5_000,
    });

    const rowA = viewportA.locator('[data-message-id]', { hasText: msg }).first();
    await pageA.waitForTimeout(1_500);
    await expect(rowA.getByLabel('отправлено')).toBeVisible();
    await expect(rowA.getByLabel('просмотрено')).toBeHidden();

    // B возвращается (фокус = активность) и смотрит: видимое дочитывается.
    await pageB.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pageB.mouse.wheel(0, 10_000);
    await expect(rowA.getByLabel('просмотрено')).toBeVisible({ timeout: 10_000 });

    await contextA.close();
    await contextB.close();
  });
});
