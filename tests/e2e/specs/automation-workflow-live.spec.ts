import { expect, test } from '@playwright/test';
import { ADMIN } from '../e2e-users.js';

/**
 * Живой e2e «Процессы» (#428, ADR-0024; единый вход #857) — критичный путь
 * раздела: колонка типов, создание типа копией «Стандартного» из меню «⋯»
 * строки, рама нового типа с маршрутом (бар и вкладки).
 * Глубокий сценарий правки холста и публикация — отдельный трек редактора и
 * интеграционные тесты API (`workflows-editor.integration.test.ts`);
 * здесь проверяется поверхность: путь, колонка, создание, загрузка редактора.
 * Живой API (песочница live-stack): E2E_LIVE_API=1
 * NODUS_BASE_URL=http://127.0.0.1:4173.
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } = ADMIN;

test.describe('«Процессы»: от типа до публикации (#428)', () => {
  test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку');

  test('вкладка, колонка, создание типа копией и маршрут', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByLabel('Рабочая почта').fill(ADMIN_EMAIL);
    await page.getByLabel('Пароль').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/home$/);

    // 1. Раздел «Автоматизация» → единая колонка «Процессов».
    await page.goto('/automation');
    await expect(page.getByRole('link', { name: 'Процессы', exact: true })).toBeVisible();
    const column = page.locator('aside').filter({ has: page.getByLabel('Поиск', { exact: true }) });
    await expect(column).toBeVisible();

    // 2. Создание типа — копия «Стандартного» из меню «⋯» его строки
    //    (новый API /workflows/types).
    const typeName = `E2E Процесс ${Date.now() % 100000}`;
    const standard = column.getByRole('button', { name: /^Стандартный/ });
    await expect(standard).toBeVisible();
    await standard.hover();
    await standard.locator('xpath=..').getByRole('button', { name: 'Действия строки' }).click();
    await page.getByRole('menuitem', { name: 'Копировать тип' }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Название', { exact: true }).fill(typeName);
    // Основа подставлена командой меню: Radix Select (не нативный select),
    // триггер выбора показывает копию «Стандартного».
    await expect(createDialog.getByLabel('Основа маршрута')).toHaveText('Копия типа: Стандартный');
    await createDialog.getByRole('button', { name: 'Создать', exact: true }).click();
    const row = column.getByRole('button', { name: new RegExp(typeName) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 3. Рама нового типа — маршрут пришёл с сервера (GET /workflows/:id):
    //    вкладки «Маршрут · Форма создания · Где создаётся», активен «Маршрут»;
    //    инструменты бара — с полными именами; статусы видны.
    const tabs = page.getByRole('tablist', { name: 'Разделы типа' });
    await expect(tabs.getByRole('tab', { name: 'Маршрут' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of ['Форма создания', 'Где создаётся']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Добавить статус' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить переход' })).toBeVisible();
    await expect(page.getByText('Ожидает').first()).toBeVisible();

    // 4. Тип рождается скрытым («Доступен при создании» включает владелец).
    await expect(row.getByText('Скрыт')).toBeVisible();
  });
});
