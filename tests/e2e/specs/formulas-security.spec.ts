import { expect, test } from '@playwright/test';
import { NIGHT_A, NIGHT_B } from '../e2e-users.js';
import {
  cellOf,
  DEMO,
  enableAttributeColumn,
  LIVE,
  login,
  openProjectStructure,
  rowByName,
  SKIP_LIVE,
  structureTable,
} from './formulas-helpers.js';

const BASE_URL = process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173';

/**
 * Критерий 5 (#632): данные секретных проектов и конфиденциальных задач через
 * формулы не утекают.
 *
 * Демо-мир держит в открытом проекте конфиденциальный комплект, а рядом —
 * секретный проект со своим зданием и комплектом. Обычный пользователь
 * (night-набор — админ-роль без права `project.view_secret` и без участия):
 * - не видит секретный проект ни в журнале, ни по прямой ссылке (404, а не
 *   «пустая карточка» — без оракула существования);
 * - не видит конфиденциальный комплект в структуре открытого проекта — ни
 *   строкой, ни значением шифра (формула читает только видимое актору).
 *
 * Проверка идёт от ДВУХ пользователей: утечка не должна зависеть от того,
 * кто именно смотрит.
 */
/** Access token тестового пользователя (REST-вход, как в live-спеках). */
async function apiToken(user: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': `e2e-formulas-${user.email}`,
    },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(res.status, `login ${user.email}`).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe('секретные проекты и конфиденциальные задачи (критерий 5)', () => {
  test.skip(!LIVE, SKIP_LIVE);

  for (const user of [NIGHT_A, NIGHT_B]) {
    test(`обычный пользователь ${user.email} не видит секретный проект и конфиденциальный комплект`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await login(page, user);

      // 1. Журнал проектов: секретного проекта нет.
      await page.goto('/projects');
      await expect(page.getByRole('table', { name: 'Проекты' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(DEMO.secretProject.name)).toHaveCount(0);

      // 2. Прямая ссылка: карточка не открывается, шифр секретного проекта
      //    не появляется нигде на странице.
      await page.goto(`/projects?cards=project:${DEMO.secretProject.id}`);
      await expect(page.getByText(DEMO.tasks.secret.cipher)).toHaveCount(0);
      await expect(page.getByText(DEMO.secretProject.cipher)).toHaveCount(0);

      // 3. API отвечает 404 (не 403 и не пустой карточкой): существование
      //    секретного проекта не подтверждается. Токен берём входом, а не
      //    cookie браузера: приложение держит access token в памяти.
      const token = await apiToken(user);
      const probe = await fetch(`${BASE_URL}/api/v1/projects/${DEMO.secretProject.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(probe.status, 'секретный проект: 404 без оракула').toBe(404);

      // 4. Открытый проект: конфиденциального комплекта в дереве нет, его
      //    шифр не посчитан и не показан.
      const card = await openProjectStructure(page, DEMO.project.id);
      await enableAttributeColumn(page, card, DEMO.fields.cipher.name);
      await expect(rowByName(card, DEMO.tasks.komplektA.title)).toBeVisible({ timeout: 20_000 });
      await expect(structureTable(card).getByText(DEMO.tasks.confidential.title)).toHaveCount(0);
      await expect(structureTable(card).getByText(DEMO.tasks.confidential.cipher)).toHaveCount(0);
      // Видимая строка по-прежнему показывает свой шифр (колонка жива).
      await expect(
        cellOf(rowByName(card, DEMO.tasks.komplektA.title), DEMO.fields.cipher.id),
      ).toContainText(DEMO.tasks.komplektA.cipher);
    });
  }
});
