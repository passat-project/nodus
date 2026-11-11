import { expect, test, type Page } from '@playwright/test';
import { ADMIN, NIGHT_A } from '../e2e-users.js';

/**
 * Живой e2e областей вкладок карточек (#744/#746): проект — сплит кнопкой
 * шапки, контекстное меню, перенос DnD, merge, память после reload и обе
 * темы; письмо — derived-сворачивание второй области на узкой ширине с
 * восстановлением; задача — панель «О задаче», derived-скрытие панели и
 * перегородка данных с клавиатуры.
 *
 * Требует песочницу live-stack (:4173, non-mock):
 *   E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173
 *   npx playwright test specs/card-tabs-live.spec.ts --config tests/e2e
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const BASE_URL = process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173';

test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку (без моков)');

async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `e2e-tabs-${Date.now()}` },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function firstId(token: string, path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status, path).toBe(200);
  const body = (await res.json()) as { items: { id: string }[] };
  expect(body.items.length, `пустой список ${path}`).toBeGreaterThan(0);
  return body.items[0]!.id;
}

/** Чистые личные настройки: e2e не должен зависеть от прошлых прогонов. */
async function resetPrefs(token: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/me/preferences`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'Idempotency-Key': `e2e-tabs-reset-${Date.now()}`,
    },
    body: JSON.stringify({ preferences: {} }),
  });
  expect(res.status, 'reset preferences').toBe(200);
}

async function loginUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Порядок вкладок полосы — для проверок перестановки. */
async function tabOrder(strip: ReturnType<Page['getByRole']>): Promise<string[]> {
  return strip
    .getByRole('tab')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
}

/** Перетащить вкладку мышью в полосу: pointer-контроллер движка (6 px порог). */
async function dragTab(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test('проект: сплит, меню, DnD между областями, merge, reload, тёмная тема', async ({ page }) => {
  test.setTimeout(120_000);
  const token = await apiLogin(NIGHT_A.email, NIGHT_A.password);
  const projectId = await firstId(token, '/projects?limit=1');
  await resetPrefs(token);

  await page.setViewportSize({ width: 1440, height: 960 });
  await loginUi(page, NIGHT_A.email, NIGHT_A.password);
  await page.goto(`/projects?cards=project:${projectId}`);

  // Системный дефолт: две области — «О проекте» слева, остальные справа,
  // активна «Структура» справа (вердикт владельца 11.11.2026).
  const left = page.getByRole('tablist', { name: 'Вкладки проекта' });
  const right = page.getByRole('tablist', { name: 'Область вкладок 2' });
  await expect(left.getByRole('tab', { name: 'О проекте' })).toBeVisible();
  await expect(right.getByRole('tab', { name: 'Структура' })).toBeVisible();
  await expect(right.getByRole('tab', { name: 'Структура' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Соединяем и снова делим кнопкой шапки: «Структура» переезжает вправо.
  await page.getByRole('button', { name: 'Соединить области' }).click();
  await expect(page.getByRole('tablist')).toHaveCount(1);
  const strip = page.getByRole('tablist', { name: 'Вкладки проекта' });
  await page.getByRole('button', { name: 'Разделить область вкладок' }).click();
  const second = page.getByRole('tablist', { name: 'Область вкладок 2' });
  await expect(page.getByRole('tablist')).toHaveCount(2);
  await expect(second.getByRole('tab', { name: 'Структура' })).toBeVisible();

  // Контекстное меню: «Задачи» — в другую область (альтернатива drag, WCAG 2.5.7).
  await strip.getByRole('tab', { name: 'Задачи' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Переместить в другую область' }).click();
  await expect(second.getByRole('tab', { name: 'Задачи' })).toBeVisible();

  // Перестановка внутри полосы меню: «Канал» влево от «Участников».
  const before = await tabOrder(strip);
  const leftTab = before[1];
  await strip.getByRole('tab', { name: leftTab! }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Переместить влево' }).click();
  await expect.poll(() => tabOrder(strip)).toEqual([before[1], before[0], ...before.slice(2)]);

  // DnD: «История» из первой полосы в правую часть второй (после «Структуры»).
  const history = strip.getByRole('tab', { name: 'История' });
  const structure = second.getByRole('tab', { name: 'Структура' });
  const from = await history.boundingBox();
  const to = await structure.boundingBox();
  expect(from && to).toBeTruthy();
  await dragTab(
    page,
    { x: from!.x + from!.width / 2, y: from!.y + from!.height / 2 },
    { x: to!.x + to!.width - 2, y: to!.y + to!.height / 2 },
  );
  await expect(second.getByRole('tab', { name: 'История' })).toBeVisible();
  await expect(strip.getByRole('tab', { name: 'История' })).toHaveCount(0);

  // Память: debounce PUT, затем reload — области и вкладки на месте.
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Область вкладок 2' })).toBeVisible();
  await expect(
    page.getByRole('tablist', { name: 'Область вкладок 2' }).getByRole('tab', { name: 'История' }),
  ).toBeVisible();

  // Merge — одна область.
  await page.getByRole('button', { name: 'Соединить области' }).click();
  await expect(page.getByRole('tablist')).toHaveCount(1);

  // Тёмная тема: карточка жива, вкладки на месте.
  await page.evaluate(() => {
    const raw = localStorage.getItem('nodus-shell-v1');
    const parsed = raw
      ? (JSON.parse(raw) as { state?: Record<string, unknown>; version: number })
      : { version: 1 };
    localStorage.setItem(
      'nodus-shell-v1',
      JSON.stringify({ ...parsed, state: { ...(parsed.state ?? {}), theme: 'dark' } }),
    );
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('tablist', { name: 'Вкладки проекта' }).getByRole('tab', { name: 'О проекте' }),
  ).toBeVisible();
});

test('письмо: две области, derived-сворачивание на узкой ширине и восстановление', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const token = await apiLogin(ADMIN.email, ADMIN.password);
  const letterId = await firstId(token, '/letters?tab=incoming&limit=1');
  await resetPrefs(token);

  await page.setViewportSize({ width: 1440, height: 960 });
  await loginUi(page, ADMIN.email, ADMIN.password);
  await page.goto(`/letters?cards=letter:${letterId}`);

  const strip = page.getByRole('tablist', { name: 'Содержимое письма' });
  await expect(strip.getByRole('tab', { name: 'Письмо' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Изменить ширину панели' })).toBeVisible();

  await page.getByRole('button', { name: 'Разделить область вкладок' }).click();
  const second = page.getByRole('tablist', { name: 'Область вкладок 2' });
  await expect(second.getByRole('tab', { name: 'Письмо' })).toBeVisible();

  // Узкая карточка: вторая область derived-свёрнута, предпочтение не тронуто.
  await page.setViewportSize({ width: 900, height: 960 });
  await expect(page.locator('[data-collapsed-hint]')).toBeVisible();

  // Расширили — области вернулись из prefs.
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('[data-collapsed-hint]')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(2);

  // Derived-состояние не записалось: после reload на широкой ширине — две области.
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByRole('tablist')).toHaveCount(2);
});

test('задача: панель «О задаче» derived-скрывается, перегородка данных с клавиатуры', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const title = `E2E вкладки ${stamp}`;
  const token = await apiLogin(NIGHT_A.email, NIGHT_A.password);
  await resetPrefs(token);

  await page.setViewportSize({ width: 1440, height: 960 });
  await loginUi(page, NIGHT_A.email, NIGHT_A.password);

  await page.getByRole('link', { name: 'Задачи' }).first().click();
  await expect(page).toHaveURL(/\/tasks/);
  await page.getByRole('button', { name: 'Создать', exact: true }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Название задачи').fill(title);
  await form.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByText('Задача создана')).toBeVisible();
  await page.getByText(title).first().click();

  const strip = page.getByRole('tablist', { name: 'Содержимое задачи' });
  await expect(strip.getByRole('tab', { name: 'Чат' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Разделить область вкладок' })).toBeVisible();

  // Панель «О задаче» есть на широкой карточке.
  await page.getByRole('button', { name: 'О задаче' }).click();
  await expect(page.getByText('О задаче').last()).toBeVisible();

  // На узкой — derived-скрыта с подсказкой, предпочтение не тронуто.
  await page.setViewportSize({ width: 900, height: 960 });
  await expect(page.getByText('Панель скрыта — расширьте карточку')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.getByText('Панель скрыта — расширьте карточку')).toHaveCount(0);

  // Перегородка данных: фокус + стрелка меняет ширину, двойной клик — сброс.
  const splitter = page.getByRole('separator', { name: 'Изменить ширину панели' });
  await splitter.focus();
  const initial = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Number(await splitter.getAttribute('aria-valuenow')))
    .toBeLessThan(initial + 1);
  await splitter.dblclick();
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(initial);
});
