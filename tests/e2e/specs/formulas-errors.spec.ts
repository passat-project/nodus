import { expect, test } from '@playwright/test';
import { NIGHT_A } from '../e2e-users.js';
import { DEMO, formulaCell, LIVE, login, openTaskCard, SKIP_LIVE } from './formulas-helpers.js';

/**
 * Критерий 4 (#632): ошибка в формуле видна в ячейке и не мешает работать
 * с карточкой.
 *
 * Демо-мир кладёт своему комплекту B формулу `=1/0` в атрибут «Коэффициент»
 * (своя формула ячейки): ячейка показывает пусто и бейдж «!» с подсказкой
 * причины, а карточка живёт обычной жизнью — атрибуты, маршрут, действия.
 */
test.describe('ошибка формулы не блокирует карточку (критерий 4)', () => {
  test.skip(!LIVE, SKIP_LIVE);

  test('ячейка с ошибкой помечена «!», карточка работает', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, NIGHT_A);
    const card = await openTaskCard(page, DEMO.tasks.komplektB.id);

    const cell = formulaCell(card, DEMO.fields.coefficient.id);
    const badge = cell.getByLabel('Ошибка формулы');
    await expect(badge).toBeVisible({ timeout: 20_000 });
    // Подсказка называет причину по-русски (деление на ноль), а не «ошибка».
    await expect(badge).toHaveAttribute('title', /Деление на ноль/);

    // Карточка не сломана: заголовок, атрибуты и кнопка маршрута на месте.
    await expect(card.getByText(DEMO.tasks.komplektB.title).first()).toBeVisible();
    await expect(card.getByText('Атрибуты').first()).toBeVisible();
    await expect(card.getByRole('button', { name: DEMO.transitionName })).toBeVisible();
    // Соседние значения формул посчитаны — ошибка локальна ячейке.
    await expect(
      formulaCell(card, DEMO.fields.cipher.id).getByRole('button', {
        name: DEMO.fields.cipher.name,
      }),
    ).toContainText(DEMO.tasks.komplektB.cipher);
  });
});
