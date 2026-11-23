/* global document */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры приёмки #101 на ЖИВОМ контуре (nginx/vite preview + api): диалог
 * приглашения (пустой/ошибки/заполненный), ссылка, карточка приглашённого,
 * меню подразделения, подтверждение сброса, публичные страницы, тёмная тема и
 * ширины 740/1280/1600. Не тест — ручной прогон:
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node tests/e2e/101-live-shots.mjs
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'docs/pr-assets/101';
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin@nodus.by';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'ci-e2e-admin-2026';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function shot(name, target = page) {
  await target.waitForTimeout(400);
  await target.screenshot({ path: `${out}/${name}.png` });
}

async function login(target, email = adminEmail, password = adminPassword) {
  await target.goto(`${base}/login`);
  await target.getByLabel('Рабочая почта').fill(email);
  await target.getByLabel('Пароль').fill(password);
  await target.getByRole('button', { name: 'Войти' }).click();
  await target.waitForURL(/\/home$/, { timeout: 30_000 });
}

async function openInvite(target, email, lastName) {
  await target.goto(`${base}/employees`);
  await target.getByRole('button', { name: 'Пригласить' }).click();
  const dialog = target.getByRole('dialog');
  await dialog.getByLabel('Фамилия').fill(lastName);
  await dialog.getByLabel('Имя').fill('Иван');
  await dialog.getByLabel('Рабочая почта').fill(email);
  await dialog.getByRole('combobox', { name: 'Должность' }).click();
  await dialog.getByRole('option').first().click();
  await dialog.getByRole('combobox', { name: 'Подразделение' }).click();
  await dialog.getByRole('option').first().click();
  return dialog;
}

await login(page);

// 1. Пустой диалог.
await page.goto(`${base}/employees`);
await page.getByRole('button', { name: 'Пригласить' }).click();
const emptyDialog = page.getByRole('dialog');
await emptyDialog.getByText('Заполните данные нового сотрудника').waitFor();
await shot('01-invite-dialog-light');
await page.keyboard.press('Escape');

// 2. Ошибки по полям: blur пустой фамилии и некорректная почта после отправки.
await page.getByRole('button', { name: 'Пригласить' }).click();
const errorDialog = page.getByRole('dialog');
await errorDialog.getByLabel('Фамилия').click();
await errorDialog.getByLabel('Имя').click();
await shot('15-invite-errors-light');
await page.keyboard.press('Escape');

// 3. Создание приглашения.
const email = `shots.101.${Date.now()}@nodus.local`;
const dialog = await openInvite(page, email, 'Новиков');
await shot('02-invite-filled-light');
await dialog.getByRole('button', { name: 'Далее' }).click();
await dialog.getByText('Ссылка-приглашение готова').waitFor({ timeout: 30_000 });
const inviteLink = (await dialog.locator('[data-token-link]').first().textContent()) ?? '';
await shot('03-link-ready-light');
await dialog.getByRole('button', { name: 'Закрыть' }).click();

// 4. Карточка приглашённого (в списке ищется по почте).
await page.goto(`${base}/employees`);
await page.getByText(email).first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 30_000 });
await shot('04-invited-card-light');

// 5. Меню подразделения: «Пригласить в Nodus» в карточке и панели.
await page.keyboard.press('Escape');
await page.goto(`${base}/employees?view=structure`);
await page.locator('[data-structure-side-panel]').waitFor({ timeout: 30_000 });
const departmentMenu = page.locator(
  '[data-structure-side-panel] button[aria-label="Действия с подразделением"]',
);
await departmentMenu.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
await departmentMenu.dispatchEvent('click');
await page.getByRole('menuitem', { name: 'Пригласить в Nodus' }).waitFor();
await shot('16-department-menu-light');
await page.keyboard.press('Escape');

// 6. Подтверждение сброса пароля (без выпуска ссылки — «Отмена»).
const loginResponse = await page.request.post(`${base}/api/v1/auth/login`, {
  data: { email: adminEmail, password: adminPassword },
});
const adminToken = (await loginResponse.json()).accessToken;
const users = await page.request.get(
  `${base}/api/v1/directory/users?status=active&search=a.voronich%40passatproekt.by`,
  { headers: { Authorization: `Bearer ${adminToken}` } },
);
const target = (await users.json()).items[0];
await page.goto(`${base}/employees?cards=employee:${target.id}`);
await page.getByText(target.displayName).first().waitFor({ timeout: 30_000 });
await page.getByRole('button', { name: 'Действия', exact: true }).click();
await page.getByRole('menuitem', { name: 'Сбросить пароль' }).click();
await page.getByText('Текущие сессии сотрудника будут завершены').waitFor();
await shot('17-reset-confirm-light');
await page.getByRole('dialog').getByRole('button', { name: 'Сбросить пароль' }).click();
await page.getByText('Ссылка для сброса пароля готова').waitFor({ timeout: 30_000 });
const resetDialog = page.getByRole('dialog');
const resetLink = (await resetDialog.locator('[data-token-link]').first().textContent()) ?? '';
await shot('05-reset-link-light');
await resetDialog.getByRole('button', { name: 'Закрыть' }).click();
await page.keyboard.press('Escape');

// 7. Публичные страницы: приглашение и сброс (анонимный контекст).
const anonymous = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const anon = await anonymous.newPage();
await anon.goto(inviteLink);
await anon.getByText('Приглашение в Nodus').waitFor({ timeout: 30_000 });
await shot('06-invite-page-light', anon);
await anon.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await shot('11-invite-page-dark', anon);

await anon.goto(resetLink);
await anon.getByRole('heading', { name: 'Новый пароль' }).waitFor({ timeout: 30_000 });
await shot('07-reset-page-light', anon);

await anon.goto(`${base}/invite/invalid-token-101`);
await anon.getByText('Ссылка недействительна или устарела').waitFor({ timeout: 30_000 });
await shot('08-invite-invalid-light', anon);
await anonymous.close();

// 8. Тёмная тема: карточка, диалог.
await page.goto(`${base}/home`);
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.goto(`${base}/employees`);
await page.getByText(email).first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 30_000 });
await shot('09-invited-card-dark');
await page.keyboard.press('Escape');
await page.goto(`${base}/employees`);
await page.getByRole('button', { name: 'Пригласить' }).click();
await page.getByRole('dialog').getByText('Заполните данные нового сотрудника').waitFor();
await shot('10-invite-dialog-dark');
await page.keyboard.press('Escape');

// 9. Ширины: узкая и широкая.
await page.setViewportSize({ width: 740, height: 900 });
await page.goto(`${base}/employees`);
await page.getByRole('button', { name: 'Пригласить' }).click();
await shot('12-invite-dialog-740');
await page.keyboard.press('Escape');
await page.getByText(email).first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 30_000 });
await shot('13-invited-card-740');
await page.setViewportSize({ width: 1600, height: 1000 });
await shot('14-invited-card-1600');

// Гигиена кадров: в публичном репо не должно остаться действующих ссылок.
// Перевыпуск/повторный reset гасят показанные в кадрах токены (новые не снимаем).
const invitedList = await page.request.get(
  `${base}/api/v1/directory/users?search=${encodeURIComponent(email)}`,
  { headers: { Authorization: `Bearer ${adminToken}` } },
);
const invitedId = (await invitedList.json()).items[0]?.id;
if (invitedId) {
  await page.request.post(`${base}/api/v1/directory/invitations/${invitedId}/reissue`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': crypto.randomUUID() },
  });
}
await page.request.post(`${base}/api/v1/directory/users/${target.id}/password-reset`, {
  headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': crypto.randomUUID() },
});

const masked = (link) => link.replace(/[0-9a-f]{20,}/i, '[redacted]');
console.log(
  JSON.stringify({ inviteLink: masked(inviteLink), resetLink: masked(resetLink), out }, null, 2),
);
await browser.close();
