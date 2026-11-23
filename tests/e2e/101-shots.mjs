/* global window, document, PopStateEvent */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры UI-чекпоинта #101 (НЕ тест, в suites не входит): приглашение по
 * ссылке на мок-мире dev-сервера — диалог, окно ссылки, карточка приглашённого,
 * публичные страницы. Обе темы и ширины 740/1280/1600.
 *
 *   NODUS_BASE_URL=http://127.0.0.1:5173 node 101-shots.mjs [outDir]
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const out = process.argv[2] ?? 'docs/pr-assets/101';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function shot(target, name) {
  // Гасим анимацию открытия окна/карточки: кадр — улика, а не середина fade-in.
  await target.waitForTimeout(400);
  await target.screenshot({ path: `${out}/${name}.png` });
}

async function prepareAdmin(target) {
  // В полном мок-мире refresh-мок сразу выдаёт демо-актёра с правами админа:
  // отдельный логин не нужен, как и на живом контуре с живой cookie.
  await target.goto(`${base}/home`);
  await target.getByRole('heading', { name: 'Главная' }).waitFor({ timeout: 30_000 });
}

async function openInvite(target, email, lastName) {
  await target.goto(`${base}/employees`);
  await target.getByRole('button', { name: 'Пригласить' }).click();
  const dialog = target.getByRole('dialog');
  await dialog.getByLabel('Фамилия').fill(lastName);
  await dialog.getByLabel('Имя').fill('Иван');
  await dialog.getByLabel('Рабочая почта').fill(email);
  await dialog.getByRole('combobox', { name: 'Должность' }).click();
  await dialog.getByRole('combobox', { name: 'Должность' }).fill('Директор');
  await dialog.getByRole('combobox', { name: 'Должность' }).press('Enter');
  await dialog.getByRole('combobox', { name: 'Подразделение' }).click();
  await dialog.getByRole('combobox', { name: 'Подразделение' }).fill('ПассатПроект');
  await dialog.getByRole('combobox', { name: 'Подразделение' }).press('Enter');
  return dialog;
}

async function createInvite(target, email, lastName) {
  const dialog = await openInvite(target, email, lastName);
  await shot(target, '02-invite-filled-light');
  await dialog.getByRole('button', { name: 'Пригласить' }).click();
  await dialog.getByText('Ссылка-приглашение готова').waitFor({ timeout: 20_000 });
  const link = await dialog.getByRole('textbox').inputValue();
  await shot(target, '03-link-ready-light');
  return { dialog, link };
}

await prepareAdmin(page);

await page.goto(`${base}/employees`);
await page.getByRole('button', { name: 'Пригласить' }).click();
const dialog = page.getByRole('dialog');
await dialog.getByText('Приглашение сотрудника').waitFor();
await shot(page, '01-invite-dialog-light');
await page.keyboard.press('Escape');

const { dialog: firstDialog, link: inviteLink } = await createInvite(
  page,
  'new.employee.101@nodus.local',
  'Новиков',
);
await firstDialog.getByRole('button', { name: 'Закрыть' }).click();

await page.getByText('new.employee.101@nodus.local').first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 20_000 });
await shot(page, '04-invited-card-light');
await page.keyboard.press('Escape');

await page.getByText('Екатерина Поломар').first().click();
await page.getByRole('button', { name: 'Действия', exact: true }).click();
await page.getByRole('menuitem', { name: 'Сбросить пароль' }).click();
await page.getByText('Ссылка для сброса пароля готова').waitFor({ timeout: 20_000 });
const resetDialog = page.getByRole('dialog');
const resetLink = await resetDialog.getByRole('textbox').inputValue();
await shot(page, '05-reset-link-light');
await resetDialog.getByRole('button', { name: 'Закрыть' }).click();
await page.keyboard.press('Escape');

async function goClient(target, path) {
  await target.evaluate((next) => {
    window.history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await target.waitForTimeout(400);
}

// Публичные страницы — в том же окне (MSW-состояние токенов живёт в модуле
// страницы и теряется при полной перезагрузке): выходим и идём клиентским
// переходом, как обычная SPA-навигация.
await page.getByRole('button', { name: 'Профиль', exact: true }).click();
await page.getByText('Выйти').click();
await page.waitForURL(/\/login$/, { timeout: 20_000 });

await goClient(page, inviteLink);
await page.getByText('Приглашение в Nodus').waitFor({ timeout: 20_000 });
await shot(page, '06-invite-page-light');
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(400);
await shot(page, '11-invite-page-dark');
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

await goClient(page, resetLink);
await page.getByRole('heading', { name: 'Новый пароль' }).waitFor({ timeout: 20_000 });
await shot(page, '07-reset-page-light');

await goClient(page, '/invite/invalid-token-101');
await page.getByText('Ссылка недействительна или устарела').waitFor({ timeout: 20_000 });
await shot(page, '08-invite-invalid-light');

// Возврат в админскую сессию без полной перезагрузки (демо-актёр с правами).
await goClient(page, '/login');
await page.getByLabel('Рабочая почта').fill('admin@nodus.by');
await page.getByLabel('Пароль').fill('any-password');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL(/\/home$/, { timeout: 20_000 });

// Тёмная тема: карточка, диалог.
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(400);
await goClient(page, '/employees');
await page.getByText('new.employee.101@nodus.local').first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 20_000 });
await shot(page, '09-invited-card-dark');
await page.keyboard.press('Escape');
await openInvite(page, 'dark.employee.101@nodus.local', 'Тёмнов');
await shot(page, '10-invite-dialog-dark');
await page.keyboard.press('Escape');

// Ширины: узкая и широкая — полная перезагрузка с чистой мок-сессией.
await page.setViewportSize({ width: 740, height: 900 });
await page.goto(`${base}/employees`);
const narrowDialog = await openInvite(page, 'width.employee.101@nodus.local', 'Широков');
await shot(page, '12-invite-dialog-740');
await narrowDialog.getByRole('button', { name: 'Пригласить' }).click();
await narrowDialog.getByText('Ссылка-приглашение готова').waitFor({ timeout: 20_000 });
await narrowDialog.getByRole('button', { name: 'Закрыть' }).click();
await page.getByText('width.employee.101@nodus.local').first().click();
await page.getByText('Приглашение ожидает активации').waitFor({ timeout: 20_000 });
await shot(page, '13-invited-card-740');
await page.setViewportSize({ width: 1600, height: 1000 });
await shot(page, '14-invited-card-1600');

console.log(JSON.stringify({ inviteLink, resetLink, out }, null, 2));
await browser.close();
