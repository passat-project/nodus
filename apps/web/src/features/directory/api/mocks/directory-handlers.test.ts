// @vitest-environment jsdom
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, type DepartmentNode } from '@nodus/contracts';

import { DEPARTMENTS_TREE_PATH } from '../../../../shared/api/departments-list.js';
import { demoDepartments } from '../../../../shared/mocks/data/departments.js';
import { demoPositions } from '../../../../shared/mocks/data/positions.js';
import { userIds } from '../../../../shared/mocks/data/users.js';
import { directoryHandlers } from './directory-handlers.js';

/**
 * Моки должностей (#768): семантика держателей — как на сервере и в панели
 * (вердикт 13.11.2026) — ВСЕ, включая уволенных; иначе в мок-режиме поток
 * «переназначить → удалить» не завершается: счётчик не обнуляется, DELETE снова
 * отвечает 409, хотя на живом контуре должность уже удалена.
 */
const server = setupServer(...directoryHandlers);
const URL = '/api/v1/directory/positions';
const DEPARTMENTS_URL = '/api/v1/directory/departments';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const positionId = (name: string): string => {
  const position = demoPositions.find((item) => item.name === name);
  if (!position) throw new Error(`Нет демо-должности ${name}`);
  return position.id;
};

describe('моки должностей (#768)', () => {
  it('переназначение переводит и уволенных держателей — должность удаляется', async () => {
    const sourceId = positionId('Инженер-проектировщик');
    const targetId = positionId('БИМ-менеджер');

    // В демо-данных у «Инженер-проектировщика» есть уволенный держатель:
    // без него должность удалилась бы сразу, а с ним — только после перевода.
    const blocked = await fetch(`${URL}/${sourceId}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { details?: { reason?: string } };
    expect(blockedBody.details).toMatchObject({ reason: 'holders' });

    const reassign = await fetch(`${URL}/${sourceId}/reassign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId }),
    });
    expect(reassign.status).toBe(204);

    const removed = await fetch(`${URL}/${sourceId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const list = await fetch(`${URL}?kind=management`);
    const positions = (await list.json()) as { id: string }[];
    expect(positions.some((position) => position.id === sourceId)).toBe(false);
  });

  it('дубль имени (без учёта регистра) — 409 как на сервере; после удаления имя свободно', async () => {
    const duplicate = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'дИРЕКТОР', kind: 'management', sortOrder: 0 }),
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe('DIRECTORY_POSITION_EXISTS');

    // Жёсткое удаление освобождает имя: та же строка создаётся заново.
    const create = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Проба мока 768', kind: 'management', sortOrder: 0 }),
    });
    expect(create.status).toBe(201);
    const createdId = ((await create.json()) as { id: string }).id;

    const removed = await fetch(`${URL}/${createdId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const recreated = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Проба мока 768', kind: 'management', sortOrder: 0 }),
    });
    expect(recreated.status).toBe(201);
    expect(((await recreated.json()) as { id: string }).id).not.toBe(createdId);
  });
});

describe('моки подразделений: глава/зам — одно место (#946)', () => {
  const DEPARTMENTS = '/api/v1/directory/departments';
  const TREE = `/api/v1${DEPARTMENTS_TREE_PATH}?kind=management`;

  const create = (body: Record<string, unknown>) =>
    fetch(DEPARTMENTS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('назначение главы переводит сотрудника; прежний узел теряет роль', async () => {
    const response = await create({
      name: 'Мок-перевод #946',
      kind: 'management',
      headId: userIds.karpovich,
    });
    expect(response.status).toBe(201);
    const department = (await response.json()) as { id: string };

    const tree = (await (await fetch(TREE)).json()) as DepartmentNode[];
    const flatten = (nodes: DepartmentNode[]): DepartmentNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const all = flatten(tree);
    const createdNode = all.find((node) => node.id === department.id);
    expect(createdNode?.memberCount).toBe(1);
    expect(createdNode?.headName).toContain('Карпович');
    // Прежний узел Карпович («Административное») остался без главы.
    const previous = all.find((node) => node.name === 'Административное');
    expect(previous?.headId).toBeNull();
  });

  it('глава и зам — один сотрудник → 400 как на сервере', async () => {
    const response = await create({
      name: 'Мок-дубль #946',
      kind: 'management',
      headId: userIds.polomar,
      deputyIds: [userIds.polomar],
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('моки подразделений (#982)', () => {
  it('управленческое подразделение в корень не открепляется — 409 тем же кодом, что у API', async () => {
    const bim = demoDepartments.find((department) => department.name === 'BIM-отдел');
    expect(bim?.parentId).toBeTruthy();

    const response = await fetch(`${DEPARTMENTS_URL}/${bim!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: null }),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
    );
    // Отказ ничего не мутировал: узел остался под прежним родителем.
    const tree = (await (await fetch(`${DEPARTMENTS_URL}/tree?kind=management`)).json()) as {
      id: string;
      parentId: string | null;
      children: unknown[];
    }[];
    type Node = { id: string; parentId: string | null; children: Node[] };
    const flat = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...flat(node.children)]);
    const stored = flat(tree as unknown as Node[]).find((node) => node.id === bim!.id);
    expect(stored?.parentId).toBe(bim!.parentId);
  });
});

describe('приглашения по ссылке (#101)', () => {
  const management = demoDepartments.find(
    (department) => department.kind === 'management' && department.isActive,
  )!;

  async function createInvite(email: string): Promise<{
    id: string;
    token: string;
    path: string;
    expiresAt: string;
  }> {
    const response = await fetch('/api/v1/directory/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        lastName: 'Приглашённый',
        firstName: 'Иван',
        middleName: null,
        positionId: positionId('Директор'),
        departmentId: management.id,
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      id: string;
      token: string;
      path: string;
      expiresAt: string;
    };
  }

  it('создание → сверка почты → принятие; ссылка одноразовая', async () => {
    const email = 'invite-accept-101@nodus.local';
    const created = await createInvite(email);
    expect(created.path.startsWith('/invite/')).toBe(true);

    const info = await fetch(`/api/v1/invitations/${created.token}`);
    expect(info.status).toBe(200);
    expect(((await info.json()) as { email: string }).email).toBe(email);

    const mismatch = await fetch(`/api/v1/invitations/${created.token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@nodus.local', password: 'Strong!Passw0rd' }),
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { code: string }).code).toBe(
      ErrorCode.INVITATION_EMAIL_MISMATCH,
    );

    const accepted = await fetch(`/api/v1/invitations/${created.token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Strong!Passw0rd' }),
    });
    expect(accepted.status).toBe(200);

    const reused = await fetch(`/api/v1/invitations/${created.token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Strong!Passw0rd' }),
    });
    expect(reused.status).toBe(409);
    expect(((await reused.json()) as { code: string }).code).toBe(
      ErrorCode.INVITATION_ALREADY_USED,
    );

    const list = await fetch('/api/v1/directory/users?limit=100');
    const items = ((await list.json()) as { items: { email: string; status: string }[] }).items;
    expect(items.find((user) => user.email === email)?.status).toBe('active');
  });

  it('перевыпуск гасит прежнюю ссылку, отмена убирает строку', async () => {
    const email = 'invite-reissue-101@nodus.local';
    const created = await createInvite(email);

    const reissue = await fetch(`/api/v1/directory/invitations/${created.id}/reissue`, {
      method: 'POST',
    });
    expect(reissue.status).toBe(200);
    const next = (await reissue.json()) as { token: string };
    expect(next.token).not.toBe(created.token);

    expect((await fetch(`/api/v1/invitations/${created.token}`)).status).toBe(400);
    expect((await fetch(`/api/v1/invitations/${next.token}`)).status).toBe(200);

    const cancel = await fetch(`/api/v1/directory/invitations/${created.id}`, {
      method: 'DELETE',
    });
    expect(cancel.status).toBe(204);
    expect((await fetch(`/api/v1/directory/users/${created.id}`)).status).toBe(404);
    expect((await fetch(`/api/v1/invitations/${next.token}`)).status).toBe(400);
  });

  it('сброс пароля: ссылка 24 часа и сверка почты', async () => {
    const users = (await (await fetch('/api/v1/directory/users?limit=100')).json()) as {
      items: { id: string; email: string; status: string }[];
    };
    const target = users.items.find((user) => user.status === 'active')!;
    const issue = await fetch(`/api/v1/directory/users/${target.id}/password-reset`, {
      method: 'POST',
    });
    expect(issue.status).toBe(200);
    const reset = (await issue.json()) as { token: string; path: string; expiresAt: string };
    expect(reset.path.startsWith('/reset/')).toBe(true);

    const info = await fetch(`/api/v1/password-resets/${reset.token}`);
    expect(info.status).toBe(200);
    expect(((await info.json()) as { email: string }).email).toBe(target.email);

    const mismatch = await fetch(`/api/v1/password-resets/${reset.token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@nodus.local', password: 'Strong!Passw0rd' }),
    });
    expect(mismatch.status).toBe(400);

    const accepted = await fetch(`/api/v1/password-resets/${reset.token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: target.email, password: 'Strong!Passw0rd' }),
    });
    expect(accepted.status).toBe(200);
  });
});
