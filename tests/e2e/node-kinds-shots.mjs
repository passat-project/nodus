import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры UI-чекпоинта #556: вкладка «Схемы проектов» (канвас, меню типа,
 * настройки типа, виды папок, панель вида), «Атрибуты → Папки», «Свойства
 * папки», окно «Создать папку». Обе темы.
 *   NODUS_BASE_URL=http://localhost:5173 node node-kinds-shots.mjs [outDir]
 * Мок-мир (`VITE_API_MOCK=true`): посевной «Комплект» и папка «ОВ1.1».
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

  // 1. «Схемы проектов»: слева типы, справа канвас будущей схемы.
  await page.goto(`${base}/automation?tab=project-schemas&type=${DOGOVOR}`);
  await shot('01-canvas');

  // 2. Меню строки типа — «Настройки типа».
  await page
    .getByRole('button', { name: /Договор/ })
    .first()
    .hover();
  await page.getByRole('button', { name: 'Действия строки' }).first().click();
  await shot('02-type-menu', 400);
  await page.getByRole('menuitem', { name: 'Настройки типа' }).click();
  await shot('03-type-settings');

  // 3. Страница «Виды папок» поверх панели настроек.
  await page.getByRole('button', { name: /Виды папок/ }).click();
  await shot('04-type-kinds');

  // 4. Панель вида — из строки «Комплект».
  await page
    .getByRole('button', { name: /Комплект/ })
    .first()
    .click();
  await shot('05-kind-panel');

  // 5. Раздел «При создании папки».
  await page.getByRole('button', { name: /При создании папки/ }).click();
  await shot('06-kind-form');

  // 6. Раздел «Возможности» (из раздела формы — «назад»).
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Возможности/ }).click();
  await shot('07-kind-capabilities');

  // 7. «Шифр проекта»: назад в корень вида, назад в «Виды папок», назад в корень типа.
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Шифр проекта/ }).click();
  await shot('08-code');

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
  await createDialog.getByRole('combobox', { name: 'Вид папки' }).click();
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
  await page.goto(`${base}/automation?tab=project-schemas&type=${DOGOVOR}&kind=${KOMPLEKT}`);
  await shot('12-kind-deeplink');

  await ctx.close();
}

await browser.close();
console.log(errors.length > 0 ? errors.join('\n') : 'OK: кадры сняты без ошибок');
process.exitCode = errors.length > 0 ? 1 : 0;
