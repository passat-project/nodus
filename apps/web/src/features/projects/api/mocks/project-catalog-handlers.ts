import { http, HttpResponse } from 'msw';
import {
  DEFAULT_PROJECT_TYPE_FORM,
  ErrorCode,
  Permission,
  portalSettingsUpdateBodySchema,
  projectGroupCreateBodySchema,
  projectGroupUpdateBodySchema,
  projectTypeCreateBodySchema,
  projectTypeUpdateBodySchema,
  type ProjectGroup,
  type ProjectType,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  demoPortalSettings,
  demoProjectGroups,
  demoProjectTypes,
} from '../../../../shared/mocks/data/projects.js';

const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
const notFound = () =>
  HttpResponse.json(
    { code: ErrorCode.NOT_FOUND, message: 'Catalog entry not found' },
    { status: 404 },
  );
const conflict = () =>
  HttpResponse.json(
    { code: ErrorCode.CONFLICT, message: 'Name is already taken' },
    { status: 409 },
  );

function includeArchivedOf(request: Request): boolean {
  return new URL(request.url).searchParams.get('includeArchived') === 'true';
}

/** Слот формы типа ↔ привязка атрибута к типу (сервер держит их вместе,
 *  Р10 #631): добавленный слот привязывает атрибут к типу, убранный —
 *  снимает привязку (значения живых проектов не трогаются). */
function syncFieldBindings(
  typeId: string,
  before: readonly string[],
  after: readonly string[],
): void {
  for (const fieldId of after) {
    if (before.includes(fieldId)) continue;
    const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
    if (definition && !definition.bindings.projectTypeIds.includes(typeId)) {
      definition.bindings.projectTypeIds.push(typeId);
    }
  }
  for (const fieldId of before) {
    if (after.includes(fieldId)) continue;
    const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
    if (definition) {
      definition.bindings.projectTypeIds = definition.bindings.projectTypeIds.filter(
        (id) => id !== typeId,
      );
    }
  }
}

/**
 * Справочники модуля в моках (#52): типы проектов, портфели, настройки
 * портала. Регистрируются ДО параметрического `/projects/:id` (gotcha
 * msw-query: MSW матчит по порядку массива, `/projects/types` иначе уйдёт
 * в карточку проекта).
 */
export const projectCatalogHandlers = [
  http.get('/api/v1/projects/types', ({ request }) => {
    const includeArchived = includeArchivedOf(request);
    return HttpResponse.json(
      demoProjectTypes.filter((entry) => includeArchived || entry.archivedAt === null),
    );
  }),

  http.post('/api/v1/projects/types', async ({ request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const parsed = projectTypeCreateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    if (demoProjectTypes.some((entry) => entry.name === parsed.data.name)) return conflict();
    const type: ProjectType = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      icon: parsed.data.icon ?? 'file-text',
      color: parsed.data.color ?? 'blue',
      form: parsed.data.form ?? DEFAULT_PROJECT_TYPE_FORM,
      kindIds: null,
      archivedAt: null,
    };
    syncFieldBindings(
      type.id,
      [],
      type.form.fields.map((slot) => slot.fieldId),
    );
    demoProjectTypes.push(type);
    return HttpResponse.json(type, { status: 201 });
  }),

  http.patch('/api/v1/projects/types/:id', async ({ params, request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const parsed = projectTypeUpdateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const type = demoProjectTypes.find((entry) => entry.id === String(params.id));
    if (!type) return notFound();
    if (
      parsed.data.name &&
      demoProjectTypes.some((entry) => entry.id !== type.id && entry.name === parsed.data.name)
    ) {
      return conflict();
    }
    if (parsed.data.name) type.name = parsed.data.name;
    if (parsed.data.icon) type.icon = parsed.data.icon;
    if (parsed.data.color) type.color = parsed.data.color;
    // Форма — замена целиком; дубль fieldId режет схема (422), привязки
    // атрибутов типа синхронизируются со слотами.
    if (parsed.data.form) {
      syncFieldBindings(
        type.id,
        type.form.fields.map((slot) => slot.fieldId),
        parsed.data.form.fields.map((slot) => slot.fieldId),
      );
      type.form = parsed.data.form;
    }
    if (parsed.data.kindIds !== undefined) type.kindIds = parsed.data.kindIds;
    return HttpResponse.json(type);
  }),

  http.delete('/api/v1/projects/types/:id', ({ params }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const type = demoProjectTypes.find((entry) => entry.id === String(params.id));
    if (!type) return notFound();
    type.archivedAt = new Date().toISOString();
    return HttpResponse.json(type);
  }),

  http.post('/api/v1/projects/types/:id/restore', ({ params }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const type = demoProjectTypes.find((entry) => entry.id === String(params.id));
    if (!type) return notFound();
    type.archivedAt = null;
    return HttpResponse.json(type);
  }),

  http.get('/api/v1/projects/groups', ({ request }) => {
    const includeArchived = includeArchivedOf(request);
    return HttpResponse.json(
      demoProjectGroups.filter((entry) => includeArchived || entry.archivedAt === null),
    );
  }),

  http.post('/api/v1/projects/groups', async ({ request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_CREATE)) return forbidden();
    const parsed = projectGroupCreateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const group: ProjectGroup = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      archivedAt: null,
    };
    demoProjectGroups.push(group);
    return HttpResponse.json(group, { status: 201 });
  }),

  http.patch('/api/v1/projects/groups/:id', async ({ params, request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_MANAGE)) return forbidden();
    const parsed = projectGroupUpdateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const group = demoProjectGroups.find((entry) => entry.id === String(params.id));
    if (!group) return notFound();
    if (parsed.data.name) group.name = parsed.data.name;
    return HttpResponse.json(group);
  }),

  http.delete('/api/v1/projects/groups/:id', ({ params }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_MANAGE)) return forbidden();
    const group = demoProjectGroups.find((entry) => entry.id === String(params.id));
    if (!group) return notFound();
    group.archivedAt = new Date().toISOString();
    return HttpResponse.json(group);
  }),

  http.get('/api/v1/settings/portal', () => HttpResponse.json(demoPortalSettings)),

  http.put('/api/v1/settings/portal', async ({ request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const parsed = portalSettingsUpdateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    demoPortalSettings.projects.defaultVisibility = parsed.data.projects.defaultVisibility;
    return HttpResponse.json(demoPortalSettings);
  }),
];
