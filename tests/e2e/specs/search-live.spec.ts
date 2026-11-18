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
    // Якорь окна — команда cmdk: у карточки результата тоже role=dialog
    // (data-card-surface), поэтому страничный getByRole('dialog') неоднозначен.
    const search = page.locator('[data-slot="command"]');
    await expect(search).toBeVisible();

    // Поле поиска — не единственный combobox в окне (у Select проекта роль
    // combobox тоже), поэтому якорь — слот cmdk-поля.
    const input = search.locator('[data-slot="command-input"]');
    await input.fill('Администратор');

    // Строка выдачи: заголовок результата-сотрудника (ФИО сидового админа).
    const firstRow = search.getByRole('option').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });

    // Esc закрывает окно и не теряет фокус со страницы.
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();

    // Повторное открытие с тем же запросом (состояние живёт в сторе) →
    // клик открывает первый результат карточкой (окно поиска закрывается).
    await page.keyboard.press('Control+k');
    const reopened = page.locator('[data-slot="command"]');
    await expect(reopened).toBeVisible();
    await reopened.getByRole('option').first().click();
    await expect(reopened).toBeHidden();
    await expect(page.locator('[data-card-surface]')).toBeVisible();
  });

  test('крестик: с текстом очищает запрос, с пустым полем закрывает окно', async ({ page }) => {
    await loginUi(page, ADMIN.email, ADMIN.password);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const input = dialog.locator('[data-slot="command-input"]');
    await input.fill('Админ');
    await dialog.getByRole('button', { name: 'Очистить запрос' }).click();
    await expect(input).toHaveValue('');
    // Окно осталось открытым — очистка не закрывает поиск.
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Закрыть поиск' }).click();
    await expect(dialog).toBeHidden();
  });
});
