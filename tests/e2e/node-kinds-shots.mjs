import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры UI-чекпоинта #556 (#857 — единый вход «Процессы», единая модель
 * «Форма создания»): канвас типа проекта, меню строки, настройки типа,
 * вкладка «Форма создания» (узел «Создание проекта» включает её), страница
 * «Какие папки здесь бывают», экран типа папки с его вкладками, «Атрибуты →
 * Папки», «Свойства папки», окно «Создать папку». Обе темы.
 *   NODUS_BASE_URL=http://localhost:5173 node node-kinds-shots.mjs [outDir]
 * Мок-мир (`VITE_API_MOCK=true`): посевной «Комплект» и папка «ОВ1.1».
 * Вкладки рам — `role=tab`; правки формы на вкладке сохраняются сами —
 * кадров правок здесь нет, чтобы посевные формы не менялись.
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const out = process.argv[2] ?? 'shots-556';
mkdirSync(out, { recursive: true });

const PROJECT = '40000000-0000-4000-8000-000000000004';
const KOMPLEKT = '33333333-3333-4333-8333-333333333307';
const DOGOVOR = '41000000-0000-4000-8000-000000000001';

const browser = await chromium.launch();
const errors = [];

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme} console: ${m.text().slice(0, 200)}`);
  });

  async function shot(name, settle = 900) {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${name}__${theme}.png` });
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    if (overflow > 1) errors.push(`${theme} OVERFLOW ${name}: +${overflow}px`);
  }

  await page.goto(`${base}/`);
  if (page.url().includes('/login')) {
    await page.getByLabel('Рабочая почта').fill('demo@passatproekt.by');
    await page.getByLabel('Пароль').fill('demo');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL(/\/(home)?$/);
  }
  await page.waitForTimeout(1400);

  // 1. Единый вход «Процессы»: слева четыре группы, справа канвас типа (#857).
  await page.goto(`${base}/automation?tab=processes&ptype=${DOGOVOR}`);
  await shot('01-canvas');

  // 1b. Узел «Создание проекта» включает вкладку «Форма создания» (единая
  // модель, #857): редактор окна целиком во вкладке, с автосохранением.
  await page.getByRole('button', { name: 'Создание проекта' }).click();
  await page.getByRole('tab', { name: 'Форма создания' }).waitFor();
  await shot('01b-project-form-tab');

  // 2. Меню строки типа — «Настройки типа» (компактное окно).
  await page
    .getByRole('button', { name: /Договор/ })
    .first()
    .hover();
  await page.getByRole('button', { name: 'Действия строки' }).first().click();
  await shot('02-type-menu', 400);
  await page.getByRole('menuitem', { name: 'Настройки типа' }).click();
  await shot('03-type-settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3. Страница «Какие папки здесь бывают» — на всю правую область (#857).
  await page.getByRole('tab', { name: /Какие папки здесь бывают/ }).click();
  await shot('04-type-kinds');

  // 4. Экран типа папки — из строки «Комплект» (вся рабочая область):
  //    первая вкладка — «Форма создания».
  await page
    .getByRole('button', { name: /Комплект/ })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Форма создания' }).waitFor();
  await shot('05-kind-screen');

  // 5. Вкладки экрана типа папки: «Типы задач в папке» и «Где используется».
  await page.getByRole('tab', { name: 'Типы задач в папке' }).click();
  await shot('06-kind-works');
  await page.getByRole('tab', { name: 'Где используется' }).click();
  await shot('07-kind-usage');

  // 6. В тип проекта — строкой колонки (крошек «назад» у рамы нет).
  await page
    .getByRole('button', { name: /Договор/ })
    .first()
    .click();
  await shot('08-back-to-type');

  // 8. «Атрибуты → Папки».
  await page.goto(`${base}/automation?tab=fields&scope=node`);
  await shot('09-fields-node');

  // 9. Структура проекта: панель «Свойства папки» у «ОВ1.1».
  await page.goto(`${base}/projects?cards=project:${PROJECT}`);
  await page.waitForTimeout(1600);
  await page.getByRole('tab', { name: 'Структура' }).click();
  await page.waitForTimeout(1600);
  const row = page.getByText('ОВ1.1', { exact: true }).first();
  if (await row.count()) {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Свойства' }).click();
    await shot('10-node-properties');
  } else {
    errors.push(`${theme} SKIP: строка «ОВ1.1» не найдена в структуре`);
  }

  // 10. Окно «Создать папку» с видом «Комплект».
  await page.getByRole('button', { name: 'Создать папку' }).first().click();
  await shot('11-node-create');

  // 10b. Длинная марка не распирает окно (#615): колонка DialogContent
  // фиксирована, значение обрезается, «Создать» остаётся внутри карточки.
  const createDialog = page.getByRole('dialog', { name: 'Создать папку' });
  await createDialog.getByRole('combobox', { name: 'Тип папки' }).click();
  await page.getByRole('option', { name: /Комплект/ }).click();
  await createDialog.getByRole('button', { name: 'Марка' }).click();
  await page
    .getByRole('button', { name: 'АТД — Автоматика и телемеханика движения поездов (СЦБ)' })
    .click();
  const geometry = await createDialog.evaluate((el) => {
    const dialogRect = el.getBoundingClientRect();
    const create = [...el.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Создать',
    );
    const createRect = create?.getBoundingClientRect();
    return {
      overflow: el.scrollWidth - el.clientWidth,
      buttonInside: createRect
        ? createRect.right <= dialogRect.right + 1 && createRect.left >= dialogRect.left - 1
        : false,
    };
  });
  if (geometry.overflow > 1) {
    errors.push(`${theme} OVERFLOW node-create mark: +${geometry.overflow}px`);
  }
  if (!geometry.buttonInside) {
    errors.push(`${theme} OVERFLOW node-create: кнопка «Создать» вне границ окна`);
  }
  await shot('11b-node-create-long-mark');

  await page.getByRole('button', { name: 'Отмена' }).click();

  // 11. Глубокая ссылка на панель вида (проверка маршрута).
  await page.goto(`${base}/automation?tab=processes&ptype=${DOGOVOR}&ftype=${KOMPLEKT}`);
  await shot('12-kind-deeplink');

  await ctx.close();
}

await browser.close();
console.log(errors.length > 0 ? errors.join('\n') : 'OK: кадры сняты без ошибок');
process.exitCode = errors.length > 0 ? 1 : 0;
