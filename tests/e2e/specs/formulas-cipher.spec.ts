import { expect, test } from '@playwright/test';
import { NIGHT_A } from '../e2e-users.js';
import {
  cellOf,
  confirmMovePreview,
  DEMO,
  enableAttributeColumn,
  LIVE,
  login,
  openProjectStructure,
  rowByName,
  SKIP_LIVE,
  structureTable,
} from './formulas-helpers.js';

/**
 * Критерий 1 (#632): у типа «Комплект» шифр-формула посчитан у всех
 * комплектов; перенос в другое здание пересчитал шифр без перезагрузки.
 *
 * Живая песочница live-stack (:4173, БД nodus_night) с демо-миром
 * `apps/api/prisma/seed-formulas.ts`: шифр = {Проект · Шифр}-{Здание · № по
 * ГП}-{Марка}{Номер}. Значения-ожидания — `formula-demo.json`.
 */
test.describe('шифр комплекта: формула типа и перенос (критерий 1)', () => {
  test.skip(!LIVE, SKIP_LIVE);

  test('шифр считается у всех комплектов и меняется при переносе в другое здание', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await login(page, NIGHT_A);
    const card = await openProjectStructure(page, DEMO.project.id);

    // Колонка «Шифр комплекта» — в шестерёнке, группа «Атрибуты» (В5).
    await enableAttributeColumn(page, card, DEMO.fields.cipher.name);

    const rowA = rowByName(card, DEMO.tasks.komplektA.title);
    const rowB = rowByName(card, DEMO.tasks.komplektB.title);
    await expect(cellOf(rowA, DEMO.fields.cipher.id)).toContainText(DEMO.tasks.komplektA.cipher, {
      timeout: 20_000,
    });
    await expect(cellOf(rowB, DEMO.fields.cipher.id)).toContainText(DEMO.tasks.komplektB.cipher);

    // Перенос комплекта A из «Здания 1» в «Здание 2» (меню строки).
    await rowA.getByRole('button', { name: 'Действия строки' }).click();
    await page.getByRole('menuitem', { name: 'Переместить в папку' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Переместить в папку' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: DEMO.buildings.two.name }).click();
    await dialog.getByRole('button', { name: 'Переместить' }).click();

    // Превью переноса подтверждаем: меню задачи спрашивает дифф так же, как
    // папка (A9-4) — шифр «до» в окне, «Перенести» применяет перенос.
    await confirmMovePreview(page, DEMO.tasks.komplektA.cipher);

    // Значение пересчиталось без F5: строка живёт под «Зданием 2» и несёт
    // шифр другого здания (рефеч списка задач после мутации).
    const moved = structureTable(card).getByRole('row').filter({
      hasText: DEMO.tasks.komplektA.title,
    });
    await expect(cellOf(moved, DEMO.fields.cipher.id)).toContainText(
      DEMO.tasks.komplektA.movedCipher ?? '',
      { timeout: 20_000 },
    );
    // Шифр соседнего комплекта не поехал (формула считается по своему месту).
    await expect(
      cellOf(rowByName(card, DEMO.tasks.komplektB.title), DEMO.fields.cipher.id),
    ).toContainText(DEMO.tasks.komplektB.cipher);

    // Возврат в исходное здание — демо-мир остаётся в предусловии критерия 3.
    await moved.getByRole('button', { name: 'Действия строки' }).click();
    await page.getByRole('menuitem', { name: 'Переместить в папку' }).click();
    const back = page.getByRole('dialog').filter({ hasText: 'Переместить в папку' });
    await back.getByRole('combobox').click();
    await page.getByRole('option', { name: DEMO.buildings.one.name }).click();
    await back.getByRole('button', { name: 'Переместить' }).click();
    await confirmMovePreview(page);
    await expect(
      cellOf(
        structureTable(card).getByRole('row').filter({ hasText: DEMO.tasks.komplektA.title }),
        DEMO.fields.cipher.id,
      ),
    ).toContainText(DEMO.tasks.komplektA.cipher, { timeout: 20_000 });
  });

  /**
   * Превью переноса в меню строки задачи: диалог «Перенос изменит значения»
   * с диффом шифра ДО записи (A9-4). Хост задачи спрашивает превью так же,
   * как папка: меню → выбор папки → окно диффа → «Перенести».
   */
  test('меню задачи спрашивает превью переноса с диффом шифра', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, NIGHT_A);
    const card = await openProjectStructure(page, DEMO.project.id);
    // Колонка шифра нужна для проверки «пересчиталось после переноса».
    await enableAttributeColumn(page, card, DEMO.fields.cipher.name);
    const row = rowByName(card, DEMO.tasks.komplektA.title);
    await row.getByRole('button', { name: 'Действия строки' }).click();
    await page.getByRole('menuitem', { name: 'Переместить в папку' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Переместить в папку' });
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: DEMO.buildings.two.name }).click();
    await dialog.getByRole('button', { name: 'Переместить' }).click();

    // Окно диффа: шифр «было» и шифр «станет» — по нему решают, переносить ли.
    const preview = page.getByRole('dialog').filter({ hasText: 'Перенос изменит значения' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(DEMO.tasks.komplektA.cipher);
    await expect(preview).toContainText(DEMO.tasks.komplektA.movedCipher ?? '');
    await preview.getByRole('button', { name: 'Перенести' }).click();

    // Шифр пересчитался без F5 — перенос дошёл до сервера.
    await expect(
      cellOf(
        structureTable(card).getByRole('row').filter({ hasText: DEMO.tasks.komplektA.title }),
        DEMO.fields.cipher.id,
      ),
    ).toContainText(DEMO.tasks.komplektA.movedCipher ?? '', { timeout: 20_000 });

    // Возврат в исходное здание — демо-мир остаётся в предусловии критерия 3.
    await rowByName(card, DEMO.tasks.komplektA.title)
      .getByRole('button', { name: 'Действия строки' })
      .click();
    await page.getByRole('menuitem', { name: 'Переместить в папку' }).click();
    const back = page.getByRole('dialog').filter({ hasText: 'Переместить в папку' });
    await back.getByRole('combobox').click();
    await page.getByRole('option', { name: DEMO.buildings.one.name }).click();
    await back.getByRole('button', { name: 'Переместить' }).click();
    await confirmMovePreview(page);
  });
});
