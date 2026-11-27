import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { HealthCheckService } from '@nestjs/terminus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from '@nodus/contracts';

import { HealthController } from '../../src/health/health.controller.js';
import { DatabaseHealthIndicator } from '../../src/health/database-health.indicator.js';
import { RedisHealthIndicator } from '../../src/health/redis-health.indicator.js';
import { AuthController } from '../../src/modules/auth/auth.controller.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { ContactsController } from '../../src/modules/crm/contacts/contacts.controller.js';
import { ContactsService } from '../../src/modules/crm/contacts/contacts.service.js';
import { CounterpartiesController } from '../../src/modules/crm/counterparties/counterparties.controller.js';
import { CounterpartiesQueryService } from '../../src/modules/crm/counterparties/counterparties-query.service.js';
import { CounterpartiesService } from '../../src/modules/crm/counterparties/counterparties.service.js';
import { DefinitionsController } from '../../src/modules/custom-fields/definitions/definitions.controller.js';
import { DefinitionsBindingService } from '../../src/modules/custom-fields/definitions/definitions-binding.service.js';
import { DefinitionsService } from '../../src/modules/custom-fields/definitions/definitions.service.js';
import { DictionariesController } from '../../src/modules/dictionaries/dictionaries.controller.js';
import { DictionariesService } from '../../src/modules/dictionaries/dictionaries.service.js';
import { DictionaryItemsService } from '../../src/modules/dictionaries/dictionary-items.service.js';
import { DepartmentsController } from '../../src/modules/directory/departments.controller.js';
import { DepartmentsService } from '../../src/modules/directory/departments.service.js';
import { PositionsController } from '../../src/modules/directory/positions.controller.js';
import { PositionsService } from '../../src/modules/directory/positions.service.js';
import { RoleMembersService } from '../../src/modules/directory/role-members.service.js';
import { RolesController } from '../../src/modules/directory/roles.controller.js';
import { RolesService } from '../../src/modules/directory/roles.service.js';
import { UsersController } from '../../src/modules/directory/users.controller.js';
import { UsersService } from '../../src/modules/directory/users.service.js';
import { setupOpenApi } from '../../src/core/openapi/openapi.setup.js';

/**
 * OpenAPI из кода (критерии приёмки issue #19): спека генерируется из декораторов
 * и zod-схем без ручного yaml, покрывает все маршруты, `/api/docs*` доступна
 * только авторизованным. БД/Redis не нужны: сервисы заменены заглушками —
 * проверяются метаданные, а не поведение. Запуск под SWC (metadata для рефлексии).
 */

const VALID_TOKEN = 'valid-access-token';

/** Минимальная типизация среза OpenAPI-документа, нужного проверкам (без `any`). */
interface OpenApiSchema {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}
interface OpenApiContent {
  schema: OpenApiSchema;
}
interface OpenApiOperation {
  parameters?: { name: string; in: string }[];
  requestBody?: { content: Record<string, OpenApiContent> };
  responses?: Record<string, { content?: Record<string, OpenApiContent> }>;
  security?: unknown;
}
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

@Module({
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    DepartmentsController,
    PositionsController,
    RolesController,
    DictionariesController,
    DefinitionsController,
    CounterpartiesController,
    ContactsController,
  ],
  providers: [
    { provide: HealthCheckService, useValue: { check: async () => ({ status: 'ok' }) } },
    { provide: DatabaseHealthIndicator, useValue: {} },
    { provide: RedisHealthIndicator, useValue: {} },
    { provide: AuthService, useValue: {} },
    { provide: TokenService, useValue: {} },
    { provide: UsersService, useValue: {} },
    { provide: DepartmentsService, useValue: {} },
    { provide: PositionsService, useValue: {} },
    { provide: RolesService, useValue: {} },
    { provide: RoleMembersService, useValue: {} },
    { provide: DictionariesService, useValue: {} },
    { provide: DictionaryItemsService, useValue: {} },
    { provide: DefinitionsService, useValue: {} },
    { provide: DefinitionsBindingService, useValue: {} },
    { provide: CounterpartiesQueryService, useValue: {} },
    { provide: CounterpartiesService, useValue: {} },
    { provide: ContactsService, useValue: {} },
  ],
})
class OpenApiTestModule {}

describe('OpenAPI: генерация из кода и публикация /api/docs (issue #19)', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OpenApiTestModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    setupOpenApi(app, async (token) => {
      if (token !== VALID_TOKEN) throw new Error('invalid token');
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/docs-json`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    document = (await response.json()) as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('спека генерируется из кода: заголовок, версия, все маршруты', () => {
    expect(document.openapi).toMatch(/^3\./);
    expect((document.info as { title: string }).title).toBe('Nodus API');
    const paths = Object.keys(document.paths as Record<string, unknown>);
    for (const expected of [
      '/api/v1/health',
      '/api/v1/health/live',
      '/api/v1/health/ready',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/logout-all',
      '/api/v1/auth/me',
      '/api/v1/auth/sessions',
      '/api/v1/auth/sessions/{id}',
      '/api/v1/auth/change-password',
      '/api/v1/directory/users',
      '/api/v1/directory/users/me',
      '/api/v1/directory/users/{id}',
      '/api/v1/directory/users/{id}/deactivate',
      '/api/v1/directory/users/{id}/activate',
      '/api/v1/directory/departments/tree',
      '/api/v1/directory/departments/{id}',
      '/api/v1/directory/positions',
      '/api/v1/directory/positions/{id}',
      '/api/v1/directory/positions/{id}/reassign',
      '/api/v1/directory/roles',
      '/api/v1/directory/roles/{id}',
      '/api/v1/directory/roles/{id}/members',
      '/api/v1/directory/roles/{id}/members/users/{userId}',
      '/api/v1/directory/roles/{id}/members/departments/{departmentId}',
      '/api/v1/directory/roles/{id}/permissions/{permission}',
      '/api/v1/dictionaries',
      '/api/v1/dictionaries/{code}/items',
      '/api/v1/counterparties',
      '/api/v1/counterparties/similar',
      '/api/v1/counterparties/bulk',
      '/api/v1/counterparties/{id}',
      '/api/v1/counterparties/{id}/archive',
      '/api/v1/counterparties/{id}/restore',
      '/api/v1/counterparties/{counterpartyId}/contacts',
      '/api/v1/counterparties/{counterpartyId}/contacts/{contactId}',
      '/api/v1/counterparties/{counterpartyId}/contacts/{contactId}/archive',
      '/api/v1/counterparties/{counterpartyId}/contacts/{contactId}/restore',
      '/api/v1/counterparties/{counterpartyId}/contacts/{contactId}',
    ]) {
      expect(paths, `нет маршрута ${expected}`).toContain(expected);
    }
  });

  it('схемы приходят из zod-контрактов: тело логина и ответ токенами', () => {
    const login = (document.paths as OpenApiPaths)['/api/v1/auth/login']!.post!;
    const bodySchema = login.requestBody!.content['application/json']!.schema;
    expect(Object.keys(bodySchema.properties ?? {})).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    const okSchema = login.responses!['200']!.content!['application/json']!.schema;
    expect(Object.keys(okSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['accessToken', 'expiresIn']),
    );
  });

  it('query-параметры списка сотрудников развёрнуты из listUsersQuerySchema', () => {
    const list = (document.paths as OpenApiPaths)['/api/v1/directory/users']!.get!;
    const names = (list.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['cursor', 'limit', 'search', 'departmentId', 'status']),
    );
  });

  it('ответ списка — канон { items, nextCursor } из paginatedSchema', () => {
    const list = (document.paths as OpenApiPaths)['/api/v1/directory/users']!.get!;
    const schema = list.responses!['200']!.content!['application/json']!.schema;
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['items', 'nextCursor']),
    );
  });

  it('ошибки документированы единым форматом { code, message, traceId }', () => {
    const login = (document.paths as OpenApiPaths)['/api/v1/auth/login']!.post!;
    const bad = login.responses!['400']!.content!['application/json']!.schema;
    expect(Object.keys(bad.properties ?? {})).toEqual(
      expect.arrayContaining(['code', 'message', 'traceId']),
    );
  });

  it('безопасность: Bearer-схема и требования на защищённых маршрутах', () => {
    const schemes = (document.components as { securitySchemes: Record<string, unknown> })
      .securitySchemes;
    expect(schemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    const me = (document.paths as OpenApiPaths)['/api/v1/auth/me']!.get!;
    expect(JSON.stringify(me.security)).toContain('bearer');
    const login = (document.paths as OpenApiPaths)['/api/v1/auth/login']!.post!;
    expect(login.security).toBeUndefined();
  });

  it('/api/docs недоступна без токена: 401 единого формата', async () => {
    const response = await fetch(`${baseUrl}/api/docs`);
    expect(response.status).toBe(401);
    const body = apiErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(body.traceId).toBeTruthy();
  });

  it('/api/docs-json недоступна с невалидным токеном: 401', async () => {
    const response = await fetch(`${baseUrl}/api/docs-json`, {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(response.status).toBe(401);
  });

  it('обход через percent-кодирование закрыт: /api/%64ocs-json без токена → 401', async () => {
    // Роутер Fastify декодирует путь при матчинге — посредник обязан тоже.
    const response = await fetch(`${baseUrl}/api/%64ocs-json`);
    expect(response.status).toBe(401);
    const encodedUi = await fetch(`${baseUrl}/api/%64ocs`);
    expect(encodedUi.status).toBe(401);
  });

  it('/api/docs доступна авторизованному: UI и спека', async () => {
    const ui = await fetch(`${baseUrl}/api/docs`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('swagger');
    const spec = await fetch(`${baseUrl}/api/docs-json`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(spec.status).toBe(200);
    expect(((await spec.json()) as { openapi: string }).openapi).toMatch(/^3\./);
  });

  it('остальной API не затронут посредником документации', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.status).toBe(200);
  });
});
