import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from '../e2e-users.js';

/**
 * Живой e2e «Действие без смены статуса» (#633):
 * 1) админ добавляет действие с окном в маршрут «Стандартный» и публикует;
 * 2) создаёт задачу в статусе действия;
 * 3) в карточке жмёт действие — открывается окно, вводит комментарий;
 * 4) статус не меняется, тост «Действие выполнено», в ленте — «Действие: …»;
 * 5) маршрут возвращается к исходному документу.
 *
 * Запуск в песочнице live-stack:
 * E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173 npx playwright test specs/tasks-action-live.spec.ts
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const BASE = process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173';
const API = `${BASE}/api/v1`;

interface Session {
  token: string;
}

interface RouteDetail {
  version: number;
  document: {
    stages: { id: string; name: string; code: string | null }[];
    transitions: unknown[];
    actions?: { id: string; name: string }[];
    layout?: unknown;
  };
}

async function apiLogin(user: { email: string; password: string }): Promise<Session> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(login.status, `login ${user.email} → ${login.status}`).toBe(200);
  const tokens = (await login.json()) as { accessToken: string };
  return { token: tokens.accessToken };
}

async function api<T>(
  session: Session,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  expect(response.status, `${method} ${path} → ${response.status}`).toBeLessThan(300);
  return (await response.json()) as T;
}

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('Рабочая почта').fill(user.email);
  await page.getByLabel('Пароль').fill(user.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test.describe('действие без смены статуса (#633)', () => {
  test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку');

  test('окно действия: комментарий, тост, журнал; статус тот же', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = await apiLogin(ADMIN);
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, ADMIN);

    // 1. Действие в «Стандартном» маршруте у статуса «В работе».
    const types = await api<{ code: string | null; workflowId: string }[]>(
      admin,
      'GET',
      '/workflows/types',
    );
    const standard = types.find((t) => t.code === 'task')!;
    const detail = await api<RouteDetail>(admin, 'GET', `/workflows/${standard.workflowId}`);
    const inProgress = detail.document.stages.find((s) => s.name === 'В работе')!;
    const actionName = `E2E уточнение ${Date.now() % 100_000}`;
    const actionId = crypto.randomUUID();

    const withAction = {
      ...detail.document,
      actions: [
        ...(detail.document.actions ?? []),
        {
          id: actionId,
          code: null,
          name: actionName,
          stageId: inProgress.id,
          display: 'button',
          sortOrder: 0,
          rules: {
            conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
            validators: [],
            postFunctions: [],
          },
          form: {
            enabled: true,
            title: 'Уточнение по задаче',
            sections: [{ kind: 'comment', label: 'Что уточнить', required: true }],
          },
          steps: [],
        },
      ],
    };
    await api(admin, 'POST', `/workflows/${standard.workflowId}/publish`, {
      baseVersion: detail.version,
      document: withAction,
      migrations: [],
    });

    try {
      // 2. Задача админа в статусе действия.
      const title = `E2E действие ${Date.now() % 100_000}`;
      const created = await api<{ id: string }>(admin, 'POST', '/tasks', {
        title,
        stageId: inProgress.id,
        assigneeId: (await api<{ id: string }>(admin, 'GET', '/auth/me')).id,
      });

      // 3. Карточка: действие — в панели процесса.
      await page.goto('/tasks?view=list');
      await page.getByText('Все доступные').click();
      await page.getByText(title).click();
      const actionButton = page.getByRole('button', { name: actionName }).first();
      await expect(actionButton).toBeVisible({ timeout: 20_000 });
      await actionButton.click();

      const dialog = page.getByRole('dialog', { name: 'Уточнение по задаче' });
      await expect(dialog).toBeVisible();
      await dialog.locator('textarea').first().fill('E2E: уточните марку бетона');
      await dialog.getByRole('button', { name: actionName }).click();

      // 4. Тост, журнал, статус не изменился.
      await expect(page.getByText('Действие выполнено')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(`Действие: ${actionName}`)).toBeVisible();
      const after = await api<{ stage: { name: string } }>(admin, 'GET', `/tasks/${created.id}`);
      expect(after.stage.name).toBe('В работе');
    } finally {
      // 5. Возврат маршрута к документу без тестового действия.
      const fresh = await api<RouteDetail>(admin, 'GET', `/workflows/${standard.workflowId}`);
      await api(admin, 'POST', `/workflows/${standard.workflowId}/publish`, {
        baseVersion: fresh.version,
        document: {
          ...fresh.document,
          actions: (fresh.document.actions ?? []).filter((a) => a.id !== actionId),
        },
        migrations: [],
      });
      await context.close();
    }
  });
});
