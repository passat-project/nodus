import { expect, test } from '@playwright/test';
import { NIGHT_A } from '../e2e-users.js';
import {
  DEMO,
  ensureInitialStage,
  formulaCell,
  LIVE,
  login,
  openTaskCard,
  SKIP_LIVE,
} from './formulas-helpers.js';

/**
 * Критерий 3 (#632): в окне выдачи поле «Изм. на момент выдачи» подставилось
 * само (формула слота окна) и сохранилось значением.
 *
 * Подстановка считается сервером при открытии окна (`formPrefill`): источники
 * — хранимые значения (шифр проекта, № по ГП папки, номер комплекта), потому
 * что формула типа в БД не материализуется. Человек может поправить значение,
 * но уходит оно всегда — снимок момента выдачи.
 */
test.describe('подстановка «Изм.» в окне выдачи (критерий 3)', () => {
  test.skip(!LIVE, SKIP_LIVE);

  test('поле подставлено формулой и сохраняется значением', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, NIGHT_A);
    const card = await openTaskCard(page, DEMO.tasks.komplektA.id);
    // Повторный прогон: комплект мог остаться выданным — возвращаем в работу.
    await ensureInitialStage(page, card);

    // Кнопка маршрута «Выдать в печать» открывает окно (у кнопки есть форма).
    await card.getByRole('button', { name: DEMO.transitionName }).click();
    const window = page.getByRole('dialog').filter({ hasText: 'Выдача комплекта' });
    await expect(window).toBeVisible({ timeout: 15_000 });

    // Поле «Изм.» подставлено: значение и пометка «Подставлено формулой».
    const issue = window.getByLabel(DEMO.fields.issue.name);
    await expect(issue).toHaveValue(DEMO.fields.issue.prefill ?? '', { timeout: 15_000 });
    await expect(window.getByTitle('Подставлено формулой')).toBeVisible();

    await window.getByRole('button', { name: DEMO.transitionName }).click();
    await expect(window).toHaveCount(0, { timeout: 20_000 });

    // Значение осталось в карточке (снимок, а не «живая» формула окна).
    await expect(
      formulaCell(card, DEMO.fields.issue.id).getByRole('button', {
        name: DEMO.fields.issue.name,
      }),
    ).toContainText(DEMO.fields.issue.prefill ?? '', { timeout: 20_000 });
  });
});
