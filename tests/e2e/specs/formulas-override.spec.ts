import { expect, test } from '@playwright/test';
import { NIGHT_A } from '../e2e-users.js';
import { DEMO, formulaCell, LIVE, login, openTaskCard, SKIP_LIVE } from './formulas-helpers.js';

/**
 * Критерий 2 (#632): ручное значение снимает формулу типа, «Как у типа»
 * возвращает формулу.
 *
 * Шифр комплекта считается формулой типа (origin `type`) — ячейка показывает
 * значение со значком fx. Вписанное руками значение подавляет формулу
 * (origin `value`), в меню ячейки появляется «Как у типа», которое стирает
 * значение — формула возвращается.
 *
 * После ввода карточка перечитывается (deep-link тот же): «значение живёт» —
 * это про сохранённое значение, а не про оптимистичную подсветку ячейки.
 */
test.describe('ручной шифр и «Как у типа» (критерий 2)', () => {
  test.skip(!LIVE, SKIP_LIVE);

  // Сценарий недостижим по требованию владельца: ячейка с формулой типа
  // заморожена сразу (R1), ручное значение поверх неё из UI не вписывается.
  // Подавление формулы типовым значением проверяется на уровне API.
  test.skip('вписанное значение живёт, «Как у типа» возвращает формулу', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, NIGHT_A);
    const card = await openTaskCard(page, DEMO.tasks.komplektA.id);

    const cell = formulaCell(card, DEMO.fields.cipher.id);
    const value = cell;
    await expect(value).toContainText(DEMO.tasks.komplektA.cipher, { timeout: 20_000 });
    // Формула типа помечена тихим fx (не своя формула записи).
    await expect(cell.getByLabel('Формула типа')).toBeVisible();

    // Вписываем шифр руками: правка значения подавляет формулу типа.
    const manual = `${DEMO.tasks.komplektA.cipher}-РУЧНОЙ`;
    await value.click();
    const input = cell.getByLabel(DEMO.fields.cipher.name);
    await input.fill(manual);
    await input.press('Enter');

    // Значение сохранено и живёт: карточка перечитана — своего fx нет,
    // показывается вписанное значение.
    await page.reload();
    const fresh = await openTaskCard(page, DEMO.tasks.komplektA.id);
    const freshCell = formulaCell(fresh, DEMO.fields.cipher.id);
    await expect(freshCell).toContainText(manual, { timeout: 20_000 });
    await expect(freshCell.getByLabel('Формула типа')).toHaveCount(0);

    // «Как у типа» стирает значение — формула типа возвращается.
    await freshCell.getByRole('button', { name: 'Формула ячейки' }).click();
    await page.getByRole('menuitem', { name: 'Как у типа' }).click();
    await expect(freshCell).toContainText(DEMO.tasks.komplektA.cipher, { timeout: 15_000 });
    await expect(freshCell.getByLabel('Формула типа')).toBeVisible();
  });
});
