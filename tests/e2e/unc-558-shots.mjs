import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Кадры #558: «Настройки портала → Файловые серверы» и значение-путь в
 * карточке задачи. Песочница live-stack non-mock:
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node unc-558-shots.mjs
 *
 * Кадры 01/03 — браузер (настоящий), 04 — браузерная ветка пути («Скопировать
 * путь» + подсказка), 02 — та же карточка с ПОДМЕНЁННЫМ мостом оболочки:
 * витрина кнопок «Открыть»/«Показать в папке» (настоящую оболочку проверяют
 * живым запуском установленного приложения).
 *
 * Скрипт сам готовит тестовые данные (идемпотентно): разрешённая папка
 * `\\server\share`, атрибут «Файл комплекта (демо)» у типа первой задачи и
 * значение-путь `\\server\share\Планы\план.pdf`.
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out =
  process.env.NODUS_SHOTS_DIR ??
  fileURLToPath(new URL('../../docs/pr-assets/558/', import.meta.url));
mkdirSync(out, { recursive: true });
const uiAccessTab = 'Права доступа';
const uiFileServersTab = 'Файловые серверы';
const uiSettingsTitle = 'Настройки портала';
const DEMO_FIELD = 'Файл комплекта (демо)';
const DEMO_SERVER = '\\\\server\\share';
const DEMO_PATH = '\\\\server\\share\\Планы\\план.pdf';

const browser = await chromium.launch();
const results = [];

async function newPage(theme, shell) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  if (shell) {
    await ctx.addInitScript(`
      window.nodusDesktop = {
        shellVersion: '1.0.21',
        platform: 'windows',
        showPopup: async () => undefined,
        logPopupDecision: async () => undefined,
        setUnreadBadge: async () => undefined,
        flashTaskbar: async () => undefined,
        openExternal: async () => undefined,
        openUncPath: async () => { window.__uncOpened = true; },
        revealUncPath: async () => { window.__uncRevealed = true; },
        dismissPopups: async () => undefined,
        setUiTheme: async () => undefined,
        getShellInfo: async () => ({ version: '1.0.21', platform: 'windows' }),
        getUpdateState: async () => ({ status: 'idle', version: null }),
        applyUpdate: async () => undefined,
        shellReady: async () => undefined,
        onEvent: () => () => undefined,
      };
    `);
  }
  return { ctx, page: await ctx.newPage() };
}

async function login(page) {
  await page.goto(`${base}/login`);
  await page.waitForTimeout(700);
  await page.getByLabel('Рабочая почта').fill('night-a@nodus.local');
  await page.getByLabel('Пароль').fill('Night-Probe-100!');
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/api/v1/auth/login') && candidate.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
  const token = (await response.json()).accessToken;
  await page.waitForURL(/\/home/, { timeout: 15000 });
  return token;
}

/** Убрать транзиентный тост уведомлений из кадра (не часть экрана настроек). */
async function clearToasts(page) {
  await page.evaluate(
    `(() => {
      document.querySelectorAll('[data-sonner-toast]').forEach((node) => node.remove());
      document.querySelectorAll('[aria-live="polite"][aria-label]').forEach((node) => node.remove());
    })()`,
  );
}

/** Идемпотентная подготовка демо-данных через живой API. */
async function prepareDemo(page, token) {
  return page.evaluate(
    async ({ bearer, fieldName, server, path }) => {
      const headers = {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      };
      const settings = await fetch('/api/v1/settings/file-servers', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ servers: [server] }),
      });
      if (!settings.ok) throw new Error(`settings ${settings.status}: ${await settings.text()}`);

      const tasks = await (await fetch('/api/v1/tasks?limit=50', { headers })).json();
      const task = tasks.items[0];
      if (!task) throw new Error('нет задач для кадра значения-пути');
      const typeId = task.type.id;

      const defs = await (await fetch('/api/v1/custom-fields/definitions', { headers })).json();
      let field = defs.find((definition) => definition.name === fieldName);
      if (!field) {
        const created = await fetch('/api/v1/custom-fields/definitions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'link',
            name: fieldName,
            bindings: { processTypeIds: [typeId], projectTypeIds: [], nodeKindIds: [] },
          }),
        });
        if (!created.ok) throw new Error(`field ${created.status}: ${await created.text()}`);
        field = await created.json();
      }
      const bind = await fetch(
        `/api/v1/custom-fields/definitions/${field.id}/bindings/process-type/${typeId}`,
        {
          method: 'PUT',
          headers: {
            authorization: headers.authorization,
            'Idempotency-Key': crypto.randomUUID(),
          },
        },
      );
      if (!bind.ok && bind.status !== 409) {
        throw new Error(`bind ${bind.status}: ${await bind.text()}`);
      }
      const patched = await fetch(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ customFields: { [field.id]: path } }),
      });
      if (!patched.ok) throw new Error(`task ${patched.status}: ${await patched.text()}`);
      return { taskId: task.id };
    },
    { bearer: token, fieldName: DEMO_FIELD, server: DEMO_SERVER, path: DEMO_PATH },
  );
}

for (const theme of ['light', 'dark']) {
  const { ctx, page } = await newPage(theme, true);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const token = await login(page);
  const { taskId } = await prepareDemo(page, token);

  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.waitForTimeout(400);
  await clearToasts(page);
  await page.screenshot({ path: `${out}/00-settings-menu-${theme}.png` });
  await page.getByRole('menuitem', { name: uiSettingsTitle }).click();
  await page.waitForURL(/\/settings/, { timeout: 10000 });
  await page.waitForTimeout(1200);
  await clearToasts(page);
  await page.screenshot({ path: `${out}/01-file-servers-${theme}.png` });
  await page.getByRole('link', { name: uiAccessTab }).click();
  await page.waitForTimeout(1200);
  await clearToasts(page);
  await page.screenshot({ path: `${out}/03-access-${theme}.png` });
  await page.getByRole('link', { name: uiFileServersTab }).click();
  await page.waitForTimeout(500);

  await page.goto(`${base}/tasks?cards=task:${taskId}`);
  await page.waitForTimeout(2500);
  const card = page.locator('[data-card-surface]').last();
  await card.waitFor({ timeout: 15000 });
  const field = page.getByText(DEMO_FIELD).first();
  if ((await field.count()) > 0) {
    await field.scrollIntoViewIfNeeded();
    await field.hover();
  }
  await page.waitForTimeout(500);
  await clearToasts(page);
  await page.screenshot({ path: `${out}/02-path-value-shell-${theme}.png` });

  results.push({ theme, taskId, errors });
  await ctx.close();
}

for (const theme of ['light', 'dark']) {
  const { ctx, page } = await newPage(theme, false);
  const token = await login(page);
  const { taskId } = await prepareDemo(page, token);
  await page.goto(`${base}/tasks?cards=task:${taskId}`);
  await page.waitForTimeout(2500);
  const field = page.getByText(DEMO_FIELD).first();
  if ((await field.count()) > 0) {
    await field.scrollIntoViewIfNeeded();
    await field.hover();
  }
  await page.waitForTimeout(500);
  await clearToasts(page);
  await page.screenshot({ path: `${out}/04-path-browser-${theme}.png` });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
