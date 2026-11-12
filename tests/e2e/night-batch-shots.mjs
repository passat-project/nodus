/* global document:readonly */
// document — только внутри page.evaluate: код исполняется в браузере.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Кадры ночного батча 12.11.2026 (DoD: diff с видимыми изменениями UI):
 *  - #738 — меню профиля без «Настройки портала» (обе темы);
 *  - #737 — состояние перетаскивания карточки канбана: фантом-слот следует
 *    за указателем внутри колонки (обе темы);
 *  - #725 — большое фото (6000×4000 JPEG, 24 Мп) проходит клиентское сжатие и
 *    загружается, тост «Фото обновлено»; до/после; плюс тост ошибки формата.
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node night-batch-shots.mjs [outDir]
 * Живой контур (non-mock): ночная БД песочницы, вход — night-a.
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = process.argv[2] ?? '../../docs/pr-assets/715-725-737-738';
mkdirSync(out, { recursive: true });

const users = JSON.parse(readFileSync(new URL('./e2e-users.json', import.meta.url), 'utf8'));
const USER = users.nightA;
const VIEWPORT = { width: 1600, height: 1000 };

const browser = await chromium.launch();
const errors = [];
const facts = { base, themes: {}, avatarRequest: null };

/** 6000×4000 JPEG ~ большим числом байт: 24 Мп > 16.7 Мп серверного потолка. */
async function bigPhoto(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 6000;
    c.height = 4000;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 6000, 4000);
    g.addColorStop(0, '#1e3a8a');
    g.addColorStop(0.5, '#b91c1c');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 6000, 4000);
    for (let i = 0; i < 30000; i += 1) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 85%, 55%, 0.8)`;
      const r = 20 + Math.random() * 260;
      ctx.fillRect(Math.random() * 6000, Math.random() * 4000, r, r);
    }
    return c.toDataURL('image/jpeg', 0.95);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme} console: ${m.text().slice(0, 200)}`);
  });
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/directory/users/me/avatar') && r.method() !== 'DELETE') {
      const body = r.postData() ?? '';
      const size = /name="size"\r?\n\r?\n(\d+)/.exec(body)?.[1];
      const mime = /Content-Type: (image\/[\w-]+)/.exec(body)?.[1];
      facts.avatarRequest = { theme, sentBytes: Number(size), mime, rawFormBytes: body.length };
    }
  });

  async function shot(name, settle = 800) {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${name}__${theme}.png` });
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    if (overflow > 1) errors.push(`${theme} OVERFLOW ${name}: +${overflow}px`);
  }

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  if (page.url().includes('/login')) {
    await page.getByLabel('Рабочая почта').fill(USER.email);
    await page.getByLabel('Пароль').fill(USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForTimeout(2500);
  }

  // #738 — меню профиля: только «Профиль» и «Выйти».
  await page.locator('button[aria-label="Профиль"]').click();
  await shot('01-profile-menu');
  const menuText = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim()),
  );
  facts.themes[theme] = { profileMenuItems: menuText };
  await page.keyboard.press('Escape');

  // #737 — drag внутри колонки «В РАБОТЕ»: фантом между 2-й и 3-й карточкой.
  await page.goto(`${base}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  const cards = page.locator('[aria-roledescription="sortable"]');
  const columnBoxes = [];
  for (let i = 0; i < (await cards.count()); i += 1) {
    const box = await cards.nth(i).boundingBox();
    if (box) columnBoxes.push({ i, box });
  }
  const columnX = columnBoxes.map((c) => c.box.x);
  const secondColumnX = [...new Set(columnX.map((x) => Math.round(x / 50) * 50))].sort(
    (a, b) => a - b,
  )[1];
  const inSecond = columnBoxes.filter((c) => Math.abs(c.box.x - secondColumnX) < 60);
  if (inSecond.length < 3) errors.push(`${theme}: в колонке ${inSecond.length} карточек (<3)`);
  if (inSecond.length >= 3) {
    const first = inSecond[0].box;
    const third = inSecond[2].box;
    const x = first.x + first.width / 2;
    await page.mouse.move(x, first.y + 30);
    await page.mouse.down();
    const targetY = third.y - 8;
    for (let step = 1; step <= 18; step += 1) {
      await page.mouse.move(x, first.y + 30 + ((targetY - (first.y + 30)) * step) / 18);
      await page.waitForTimeout(25);
    }
    await shot('02-kanban-drag', 500);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(600);
    facts.themes[theme].dragColumnCards = inSecond.length;
  }

  // #725 — своя карточка сотрудника: до/после загрузки 24 Мп фото.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('button[aria-label="Профиль"]').click();
  await page.getByRole('menuitem', { name: 'Профиль' }).click();
  await page.waitForTimeout(1800);

  // Чистим предыдущее фото (если осталось от прошлого прогона) — одинаковое «до».
  const avatarButton = page
    .locator('button[aria-label="Сменить фото"], button[aria-label="Загрузить фото"]')
    .first();
  if (await avatarButton.isVisible().catch(() => false)) {
    await avatarButton.click({ button: 'right' });
    const removeItem = page.getByRole('menuitem', { name: 'Убрать фото' });
    if (await removeItem.isVisible().catch(() => false)) {
      await removeItem.click();
      await page.waitForTimeout(1500);
    } else {
      await page.keyboard.press('Escape');
    }
  }
  const uploadButton = page.locator('button[aria-label="Загрузить фото"]').first();
  const avatarBox = await uploadButton.boundingBox();
  const clip = avatarBox
    ? {
        x: Math.max(0, avatarBox.x - 24),
        y: Math.max(0, avatarBox.y - 24),
        width: 320,
        height: 300,
      }
    : undefined;
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `${out}/03-avatar-before__${theme}.png`,
    ...(clip ? { clip } : {}),
  });

  const photo = await bigPhoto(page);
  facts.themes[theme].photoBytes = photo.length;
  await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({
    name: 'IMG_2026_11_24mp.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  });
  await page.getByText('Фото обновлено').waitFor({ timeout: 20000 });
  await shot('04-avatar-after', 900);
  if (clip) await page.screenshot({ path: `${out}/04-avatar-after-crop__${theme}.png`, clip });

  // Ошибка видна пользователю (тост), а не «ничего не произошло».
  await page.waitForTimeout(2500);
  await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({
    name: 'photo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('не изображение'),
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/05-avatar-error__${theme}.png` });

  await ctx.close();
}

writeFileSync(`${out}/facts.json`, JSON.stringify(facts, null, 2));
await browser.close();
console.log(JSON.stringify(facts, null, 1));
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
}
