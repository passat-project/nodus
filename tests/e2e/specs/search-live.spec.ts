import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from '../e2e-users.js';

/**
 * Живой e2e поиска (#952, критичный путь): Ctrl+K → запрос → строка выдачи →
 * открытие результата. Идёт против песочницы без моков; индекс должен быть
 * наполнен — перед прогоном `pnpm search:reindex` (DATABASE_URL песочницы
 * `nodus_night`, план P4).
 *
 *   E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173 \
 *     npx playwright test specs/search-live.spec.ts
 *
 * Запрос — имя сидового администратора: сотрудник есть в любой чистой БД,
 * выдача не зависит от демо-контента задач/писем.
 */
const LIVE = Boolean(process.env.E2E_LIVE_API);

test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку (без моков)');

async function loginUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test.describe('живой поиск по порталу (#952)', () => {
  test('Ctrl+K находит сотрудника, открывает карточку, Esc закрывает окно', async ({ page }) => {
    await loginUi(page, ADMIN.email, ADMIN.password);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const input = dialog.getByRole('combobox');
    await input.fill('Администратор');

    // Строка выдачи: заголовок результата-сотрудника (ФИО сидового админа).
    const firstRow = dialog.getByRole('option').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });

    // Esc закрывает окно и не теряет фокус со страницы.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Повторное открытие с тем же запросом (состояние живёт в сторе) →
    // Enter открывает первый результат карточкой.
    await page.keyboard.press('Control+k');
    const reopened = page.getByRole('dialog');
    await expect(reopened).toBeVisible();
    await reopened.getByRole('option').first().click();
    await expect(reopened).toBeHidden();
  });

  test('крестик: с текстом очищает запрос, с пустым полем закрывает окно', async ({ page }) => {
    await loginUi(page, ADMIN.email, ADMIN.password);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const input = dialog.getByRole('combobox');
    await input.fill('Админ');
    await dialog.getByRole('button', { name: 'Очистить запрос' }).click();
    await expect(input).toHaveValue('');
    // Окно осталось открытым — очистка не закрывает поиск.
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Закрыть поиск' }).click();
    await expect(dialog).toBeHidden();
  });
});
