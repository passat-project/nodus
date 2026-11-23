import { expect, test } from '@playwright/test';
import { ADMIN } from '../e2e-users.js';

/**
 * Приглашение по ссылке (#101) на ЖИВОМ API: админ создаёт приглашение →
 * аноним открывает публичную ссылку → сверка почты и пароль → вход →
 * непустые права; затем ссылка сброса пароля → новый пароль → вход.
 * По умолчанию ПРОПУСКАЕТСЯ (моки не дают живого контура):
 *   E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173
 * Нужен live-stack (non-mock, БД nodus_night), учётные данные — e2e-users.json.
 */

const LIVE = Boolean(process.env.E2E_LIVE_API);
const { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } = ADMIN;
const PASSWORD = 'Night-Probe-100!';

async function login(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
) {
  return request.post('/api/v1/auth/login', { data: { email, password } });
}

test.describe('приглашение по ссылке (#101, живой API)', () => {
  test.skip(!LIVE, 'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на живую сборку (без моков)');

  test('приглашение → активация → вход → сброс пароля → вход', async ({ page, browser }) => {
    const email = `check.101.${Date.now()}@nodus.local`;
    const admin = page.request;

    const adminLogin = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(adminLogin.ok()).toBe(true);
    const adminToken = (await adminLogin.json()).accessToken as string;
    const auth = { Authorization: `Bearer ${adminToken}` };

    // Справочники для обязательных полей приглашения.
    const positions = await admin.get('/api/v1/directory/positions?kind=management', {
      headers: auth,
    });
    const departments = await admin.get('/api/v1/directory/departments/tree?kind=management', {
      headers: auth,
    });
    const position = (await positions.json())[0] as { id: string } | undefined;
    const departmentNode = (await departments.json())[0] as { id: string } | undefined;
    expect(position?.id).toBeTruthy();
    expect(departmentNode?.id).toBeTruthy();

    // Создание приглашения (I2: действие воспроизводится скриптом).
    const created = await admin.post('/api/v1/directory/invitations', {
      data: {
        email,
        lastName: 'Проверкин',
        firstName: 'Пётр',
        middleName: null,
        positionId: position!.id,
        departmentId: departmentNode!.id,
        // HR-поля необязательны, но если заданы — сохраняются (#101).
        workRate: 0.5,
        hiredAt: '2026-11-01',
      },
      headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(created.status()).toBe(201);
    const invitation: { id: string; token: string; path: string } = await created.json();
    expect(invitation.path).toMatch(/^\/invite\//);

    // До активации: в активном справочнике его нет, вход — понятный отказ.
    const activeList = await admin.get(
      `/api/v1/directory/users?status=active&search=${encodeURIComponent(email)}`,
      { headers: auth },
    );
    expect((await activeList.json()).items).toHaveLength(0);

    const anonymous = await browser.newContext();
    const anonRequest = anonymous.request;
    const notActivated = await login(anonRequest, email, PASSWORD);
    expect(notActivated.status()).toBe(403);
    expect((await notActivated.json()).code).toBe('AUTH_ACCOUNT_NOT_ACTIVATED');

    // Публичная страница: карточка приглашения отдаёт имя/отдел/почту.
    const apiInvite = `/api/v1/invitations/${invitation.token}`;
    const info = await anonRequest.get(apiInvite);
    expect(info.ok()).toBe(true);
    const infoBody = await info.json();
    expect(infoBody.kind).toBe('invite');
    expect(infoBody.email).toBe(email);
    expect(infoBody.displayName).toBe('Проверкин Пётр');

    // Чужая почта — отказ; правильная — активация.
    const mismatch = await anonRequest.post(`${apiInvite}/accept`, {
      data: { email: 'other@nodus.local', password: PASSWORD },
    });
    expect(mismatch.status()).toBe(400);
    expect((await mismatch.json()).code).toBe('INVITATION_EMAIL_MISMATCH');

    const accepted = await anonRequest.post(`${apiInvite}/accept`, {
      data: { email, password: PASSWORD },
    });
    expect(accepted.ok()).toBe(true);
    expect((await accepted.json()).email).toBe(email);

    // Ссылка одноразовая: повторный accept отклоняется.
    const reused = await anonRequest.post(`${apiInvite}/accept`, {
      data: { email, password: PASSWORD },
    });
    expect(reused.status()).toBe(409);
    expect((await reused.json()).code).toBe('INVITATION_ALREADY_USED');

    // Авто-вход после установки пароля — обычный login; права не пусты.
    const employeeLogin = await login(anonRequest, email, PASSWORD);
    expect(employeeLogin.ok()).toBe(true);
    const employeeToken = (await employeeLogin.json()).accessToken as string;
    const me = await anonRequest.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    expect(me.ok()).toBe(true);
    expect((await me.json()).permissions.length).toBeGreaterThan(0);

    // В активном справочнике сотрудник появился (структура/пикеры — те же active).
    const activeAfter = await admin.get(
      `/api/v1/directory/users?status=active&search=${encodeURIComponent(email)}`,
      { headers: auth },
    );
    expect((await activeAfter.json()).items).toHaveLength(1);

    // HR-поля из приглашения дошли до карточки.
    const card = await admin.get(`/api/v1/directory/users/${invitation.id}`, { headers: auth });
    expect(card.ok()).toBe(true);
    const cardBody = await card.json();
    expect(cardBody.workRate).toBe(0.5);
    expect(cardBody.hiredAt).toBe('2026-11-01');

    // Сброс пароля: админ выпускает ссылку на 24 часа, сотрудник задаёт новый.
    const reset = await admin.post(`/api/v1/directory/users/${invitation.id}/password-reset`, {
      headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(reset.ok()).toBe(true);
    const resetLink: { path: string; token: string } = await reset.json();
    const resetInfo = await anonRequest.get(`/api/v1/password-resets/${resetLink.token}`);
    expect(resetInfo.ok()).toBe(true);

    const newPassword = 'Night-Probe-101!';
    const resetAccepted = await anonRequest.post(
      `/api/v1/password-resets/${resetLink.token}/accept`,
      { data: { email, password: newPassword } },
    );
    expect(resetAccepted.ok()).toBe(true);
    expect((await login(anonRequest, email, newPassword)).ok()).toBe(true);

    await anonymous.close();
  });
});
