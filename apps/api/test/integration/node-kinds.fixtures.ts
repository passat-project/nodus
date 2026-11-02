import { expect } from 'vitest';
import {
  ErrorCode,
  Permission,
  apiErrorResponseSchema,
  customFieldDefinitionSchema,
  nodeKindSchema,
  projectDetailSchema,
  projectTypeSchema,
  type CustomFieldDefinition,
  type NodeKind,
} from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import type { ChatUser } from './chat-fixtures.js';
import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * Фикстура набора «Виды папок как настраиваемые типы» (#556): свой тип
 * проекта, проект, два атрибута области `node` и два вида папок («Проба
 * 556 …»). Общая тестовая БД делится с соседними наборами — посевной
 * «Комплект» только читается, свои данные убираются в cleanup.
 */
export interface NodeKindsFixture {
  fx: ProjectNodeFixture;
  admin: ChatUser;
  dispatcher: EventDispatcher;
  projectId: string;
  ownTypeId: string;
  textField: string;
  userField: string;
  kindA: NodeKind;
  kindB: NodeKind;
  definitionIds: string[];
  typeIds: string[];
  key(prefix: string): string;
  createDefinition(type: string, name: string): Promise<string>;
  createKind(name: string, config?: Record<string, unknown>): Promise<NodeKind>;
  kinds(actor?: ChatUser): Promise<NodeKind[]>;
  definitions(): Promise<CustomFieldDefinition[]>;
  expectError(
    res: Response,
    status: number,
    code: ErrorCode,
  ): Promise<{ details?: Record<string, unknown> }>;
  patchNode(nodeId: string, body: Record<string, unknown>, actor?: ChatUser): Promise<Response>;
  cleanup(): Promise<void>;
}

export async function setupNodeKindsFixture(): Promise<NodeKindsFixture> {
  const fx = await setupProjectNodeFixture();
  const tokens = fx.fx.app.get(TokenService);
  const admin: ChatUser = {
    ...fx.alice,
    token: await tokens.signAccessToken(
      {
        id: fx.alice.id,
        email: fx.alice.email,
        displayName: fx.alice.displayName,
        permissions: [
          Permission.PROJECT_CREATE,
          Permission.PROJECT_SETUP_MANAGE,
          Permission.CUSTOM_FIELD_MANAGE,
        ],
      },
      'integration-test-session',
    ),
  };
  const dispatcher = fx.fx.app.get(EventDispatcher);
  const definitionIds: string[] = [];
  const typeIds: string[] = [];
  let seq = 0;

  const key = (prefix: string): string => `it556-${prefix}-${fx.fx.runId}-${seq++}`;

  const fixture: NodeKindsFixture = {
    fx,
    admin,
    dispatcher,
    projectId: '',
    ownTypeId: '',
    textField: '',
    userField: '',
    kindA: null as unknown as NodeKind,
    kindB: null as unknown as NodeKind,
    definitionIds,
    typeIds,
    key,
    async createDefinition(type, name) {
      const res = await fx.fx.api(admin, 'POST', '/custom-fields/definitions', {
        body: { scope: 'node', type, name },
        key: key('cf'),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const dto = customFieldDefinitionSchema.parse(await res.json());
      definitionIds.push(dto.id);
      return dto.id;
    },
    async createKind(name, config) {
      const created = await fx.fx.api(admin, 'POST', '/projects/node-kinds', {
        body: { name, icon: 'folder', color: 'green' },
        key: key('kind'),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const kind = nodeKindSchema.parse(await created.json());
      fx.nodeKindIds.push(kind.id);
      if (!config) return kind;
      const patched = await fx.fx.api(admin, 'PATCH', `/projects/node-kinds/${kind.id}`, {
        body: config,
        key: key('kind-patch'),
      });
      expect(patched.status, await patched.clone().text()).toBe(200);
      return nodeKindSchema.parse(await patched.json());
    },
    async kinds(actor = admin) {
      const res = await fx.fx.api(actor, 'GET', '/projects/node-kinds');
      expect(res.status).toBe(200);
      return nodeKindSchema.array().parse(await res.json());
    },
    async definitions() {
      const res = await fx.fx.api(admin, 'GET', '/custom-fields/definitions?scope=node');
      expect(res.status).toBe(200);
      return customFieldDefinitionSchema.array().parse(await res.json());
    },
    async expectError(res, status, code) {
      const text = await res.text();
      expect(res.status, text).toBe(status);
      const body = apiErrorResponseSchema.parse(JSON.parse(text));
      expect(body.code).toBe(code);
      return body as { details?: Record<string, unknown> };
    },
    patchNode(nodeId, body, actor = fx.alice) {
      return fx.fx.api(actor, 'PATCH', `/projects/${fixture.projectId}/nodes/${nodeId}`, {
        body,
        key: key('node-patch'),
      });
    },
    async cleanup() {
      await fx.cleanup();
      if (definitionIds.length > 0) {
        await fx.fx.prisma.fieldDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      }
      if (typeIds.length > 0) {
        await fx.fx.prisma.projectType.deleteMany({ where: { id: { in: typeIds } } });
      }
    },
  };

  const typeRes = await fx.fx.api(admin, 'POST', '/projects/types', {
    body: { name: `Проба 556 тип ${fx.fx.runId}`, icon: 'flag', color: 'green' },
    key: key('type'),
  });
  expect(typeRes.status, await typeRes.clone().text()).toBe(201);
  const ownType = projectTypeSchema.parse(await typeRes.json());
  fixture.ownTypeId = ownType.id;
  typeIds.push(ownType.id);

  const projectRes = await fx.fx.api(fx.alice, 'POST', '/projects', {
    body: { typeId: ownType.id, name: `Проба 556 проект ${fx.fx.runId}`, code: fx.unique('P556') },
    key: key('project'),
  });
  expect(projectRes.status, await projectRes.clone().text()).toBe(201);
  fixture.projectId = projectDetailSchema.parse(await projectRes.json()).id;
  fx.projectIds.push(fixture.projectId);

  fixture.textField = await fixture.createDefinition('text', `Проба 556 текст ${fx.fx.runId}`);
  fixture.userField = await fixture.createDefinition('user', `Проба 556 сотрудник ${fx.fx.runId}`);

  fixture.kindA = await fixture.createKind(`Проба 556 вид А ${fx.fx.runId}`, {
    form: { code: 'optional', fields: [{ fieldId: fixture.textField, state: 'required' }] },
    capabilities: ['pulse_row'],
  });
  fixture.kindB = await fixture.createKind(`Проба 556 вид Б ${fx.fx.runId}`, {
    form: {
      code: 'required',
      fields: [
        { fieldId: fixture.textField, state: 'optional' },
        { fieldId: fixture.userField, state: 'optional' },
      ],
    },
    capabilities: ['schema_row', 'document_changes'],
  });
  return fixture;
}
