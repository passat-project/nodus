import { expect, test } from '@playwright/test';
import { NIGHT_A, NIGHT_B } from '../e2e-users.js';

/**
 * Живые e2e уведомлений #100 (Ф5, чек-лист E/H): песочница live-stack
 * (:4173, изолированная БД nodus_night, Redis db1). Запуск:
 * E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173
 * Пробные пользователи: night-a@nodus.local (Анна) / night-b@nodus.local
 * (Борис), пароли — tests/e2e/e2e-users.json (единый источник сред, #247).
 * SPA-навигация без reload (сессия короткая — память live-stack).
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const BASE_URL = process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173';
const EMAIL = process.env.E2E_USER_EMAIL ?? NIGHT_B.email;
const PASSWORD = process.env.E2E_USER_PASSWORD ?? NIGHT_B.password;

test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку');

test.describe('уведомления: живой контур (#100)', () => {
  test('E2: Главная-лента — секции внимания/фона, пилюли, пустое состояние после разбора', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Рабочая почта').fill(EMAIL);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/home$/);

    // Лента журнала: вкладки-фильтры + «+» за ними (#189: строка поиска
    // убрана — поиск уведомлений переезжает в глобальный поиск топбара).
    await expect(page.getByRole('tab', { name: /^Все/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Настроить вкладки' })).toBeVisible();
    // Заголовок ленты (NodeLabel UPPERCASE) ИЛИ пустое состояние — оба валидны
    // в зависимости от остатков проб; главная метка — каркас ленты.
    const attention = page.getByText('УВЕДОМЛЕНИЯ').first();
    const clean = page.getByText('Всё разобрано').first();
    await expect(attention.or(clean)).toBeVisible();

    // Колокольчик в топбаре с живым поповером (массового прочтения нет —
    // фидбек 01.10; список/заглушка).
    await page.getByRole('button', { name: 'Уведомления' }).click();
    await expect(page.getByText('Последние уведомления')).toBeVisible();
    const someRow = page.getByRole('button', { name: /·/ }).first();
    const bellEmpty = page.getByText('Новых уведомлений нет').first();
    await expect(someRow.or(bellEmpty)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('H1-браузер: живой тост личного при упоминании (вкладка вне чата)', async ({
    page,
    request,
  }) => {
    // Логин night-b; упоминание шлёт night-a через живой API.
    await page.goto('/');
    await page.getByLabel('Рабочая почта').fill(EMAIL);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/home$/);

    const login = await request.post('/api/v1/auth/login', {
      data: { email: NIGHT_A.email, password: NIGHT_A.password },
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    // Беседа a→b: получатель night-b (id из логина получателя, не отправителя).
    const loginB = await request.post('/api/v1/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    });
    const tokenB = ((await loginB.json()) as { accessToken: string }).accessToken;
    const meB = await request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const bId = ((await meB.json()) as { id: string }).id;
    const direct = await request.post(`/api/v1/chat/conversations/direct/${bId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const convId = ((await direct.json()) as { id: string }).id;
    const stamp = `toast-${Date.now()}`;
    await request.post(`/api/v1/chat/conversations/${convId}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': `e2e-${stamp}` },
      data: { text: `Прямое сообщение для тоста ${stamp}` },
    });

    // Тост личного (aria-live контейнер) появляется без F5.
    // Тост живого личного: в aria-live контейнере виден превью-текст сообщения.
    await expect(page.locator('[aria-live="polite"]').getByText(stamp)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('H4: обрыв gateway → reconnect с догрузкой без потерь', async ({ page, request }) => {
    test.skip(true, 'Рестарт gateway процесса — проверяется отдельным скриптом ночи (kill+up)');
    void page;
    void request;
  });

  test('E3: чат под модальным слоем не читается; закрыли слой — дочитывается (#809)', async ({
    page,
    request,
  }) => {
    // Минимальная валидная PNG 1×1: превью в ленте → клик открывает лайтбокс.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const stamp = `overlay-${Date.now().toString(36)}`;

    // B — UI-сессия (смотрит в чат), A — API-отправитель.
    await page.goto('/');
    await page.getByLabel('Рабочая почта').fill(EMAIL);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/home$/);

    const loginA = await request.post('/api/v1/auth/login', {
      data: { email: NIGHT_A.email, password: NIGHT_A.password },
    });
    const tokenA = ((await loginA.json()) as { accessToken: string }).accessToken;
    const loginB = await request.post('/api/v1/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    });
    const tokenB = ((await loginB.json()) as { accessToken: string }).accessToken;
    const meB = await request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const bId = ((await meB.json()) as { id: string }).id;
    const direct = await request.post(`/api/v1/chat/conversations/direct/${bId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const convId = ((await direct.json()) as { id: string }).id;

    // Картинка → сообщение с вложением (реальный конвейер, non-mock песочница).
    // multipart — сырым FormData: поля загрузки (size/width/height) читает
    // @fastify/multipart, а не JSON-тело.
    const form = new FormData();
    form.append('size', String(png.length));
    form.append('width', '1');
    form.append('height', '1');
    form.append('file', new Blob([png], { type: 'image/png' }), `${stamp}.png`);
    const upload = await fetch(`${BASE_URL}/api/v1/chat/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Idempotency-Key': `e2e-809-${stamp}-upload`,
      },
      body: form,
    });
    expect(upload.status, 'загрузка вложения').toBe(201);
    const attachment = (await upload.json()) as { id: string };
    const sendImage = await request.post(`/api/v1/chat/conversations/${convId}/messages`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Idempotency-Key': `e2e-809-${stamp}-image`,
      },
      data: { text: '', attachmentIds: [attachment.id] },
    });
    expect(sendImage.status()).toBe(201);

    // B открывает беседу и лайтбокс — модальный слой поверх ленты.
    await page.goto(`/chat/${convId}`);
    const tile = page.locator(`img[alt="${stamp}.png"]`).first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tile.click();
    const lightbox = page.locator('[role="dialog"][aria-modal="true"]').first();
    await expect(lightbox).toBeVisible();

    // A пишет под слоем: B не «смотрит» в ленту — сообщение не читается.
    const text = `под слоем ${stamp}`;
    const sendText = await request.post(`/api/v1/chat/conversations/${convId}/messages`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Idempotency-Key': `e2e-809-${stamp}-text`,
      },
      data: { text },
    });
    expect(sendText.status()).toBe(201);

    const readAt = async (): Promise<string | null> => {
      const res = await request.get(`/api/v1/chat/conversations/${convId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(res.status()).toBe(200);
      const { items } = (await res.json()) as { items: { text: string; readAt: string | null }[] };
      return items.find((m) => m.text === text)?.readAt ?? null;
    };

    // Сообщение обязано быть ГЕОМЕТРИЧЕСКИ видимым под слоем — иначе тест
    // доказывал бы «строка ниже сгиба», а не гейт модального слоя. Скроллим
    // ленту под лайтбоксом (ввод уже был — клик по картинке) и ждём квитанцию.
    await expect(page.getByText(text, { exact: true })).toBeAttached({ timeout: 15_000 });
    const viewport = page.locator('[data-slot="message-scroller-viewport"]');
    await viewport.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(2_500);
    expect(await readAt(), 'под лайтбоксом сообщение остаётся непрочитанным').toBeNull();

    // Закрыли слой — возврат внимания дочитывает видимое (модель #770/#809).
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await viewport.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(readAt, { timeout: 15_000, intervals: [1_000] }).not.toBeNull();
  });
});
