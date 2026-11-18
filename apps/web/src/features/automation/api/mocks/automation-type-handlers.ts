import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  createProcessTypeBodySchema,
  isDefaultProcessType,
  normalizeTypeConfig,
  updateProcessTypeBodySchema,
  updateProcessTypeConfigBodySchema,
} from '@nodus/contracts';

import { mockWorkflows } from '../../../../shared/mocks/data/workflows-store.js';
import { quickDocument } from '../../../../shared/mocks/data/workflows.js';
import { canSeeAllTypes, typeDto } from '../../../../shared/mocks/data/process-types-dto.js';
import {
  mockTypes,
  nextId,
  type DemoProcessType,
} from '../../../../shared/mocks/data/process-types-store.js';

/** Хендлеры библиотеки типов процессов (#378; конфигурация — #432):
 *  список с доступом зрителя, создание/правка, «Настройки типа», архив. */

const invalid = (status: number, code: keyof typeof ErrorCode, details?: unknown) =>
  HttpResponse.json({ code: ErrorCode[code], message: code, details }, { status });
const validationFailed = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Not found' }, { status: 404 });

/** Замок каталога писем (#55, Р4): типы и маршруты писем — только
 *  просмотр до #463/#464 (направления incoming/outgoing). */
export const letterCatalogLocked = () =>
  invalid(409, 'PROCESS_TYPE_SYSTEM_LOCKED', { reason: 'letter_catalog' });

export function isLockedLetterType(type: Pick<DemoProcessType, 'category'> | undefined): boolean {
  return type?.category === 'letter';
}

/** Копия маршрута с НОВЫМИ id стадий/переходов (коды — null). */
function cloneDocument(source: typeof quickDocument) {
  const remap = new Map<string, string>();
  const stages = source.stages.map((s) => {
    const id = nextId();
    remap.set(s.id, id);
    return { ...s, id, code: null };
  });
  const transitions = source.transitions.map((t) => ({
    ...t,
    id: nextId(),
    code: null,
    fromStageId: t.fromStageId ? remap.get(t.fromStageId)! : null,
    toStageId: remap.get(t.toStageId)!,
  }));
  return { stages, transitions, ...(source.creation ? { creation: source.creation } : {}) };
}

function simpleDocument() {
  // Новый тип без основы: Ожидает → В работе → Завершена (как «Быстрый»).
  return {
    stages: quickDocument.stages,
    transitions: [
      quickDocument.transitions.find((t) => t.code === 'start')!,
      quickDocument.transitions.find((t) => t.code === 'complete')!,
    ],
  };
}

export const automationTypeHandlers = [
  http.get('/api/v1/workflows/types', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const archived = params.get('archived');
    const category = params.get('category');
    const scoped = category ? mockTypes.filter((t) => t.category === category) : mockTypes;
    // Без `workflow.manage` сервер отдаёт только видимые типы (Р6, I8).
    const seen = canSeeAllTypes() ? scoped : scoped.filter((t) => typeDto(t).viewer.canView);
    const items =
      archived === 'only'
        ? seen.filter((t) => t.archivedAt)
        : archived === 'include'
          ? seen
          : seen.filter((t) => !t.archivedAt);
    return HttpResponse.json(items.map(typeDto));
  }),

  http.post('/api/v1/workflows/types', async ({ request }) => {
    const parsed = createProcessTypeBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const { name, category, direction, icon, color, description, base } = parsed.data;
    if (category === 'letter') return letterCatalogLocked();
    if (mockTypes.some((t) => !t.archivedAt && t.name === name))
      return invalid(409, 'PROCESS_TYPE_NAME_TAKEN');
    const baseType = base.kind === 'copy' ? mockTypes.find((t) => t.id === base.typeId) : null;
    const workflowId = nextId();
    const source = baseType ? mockWorkflows.get(baseType.workflowId)?.document : undefined;
    const document = source ? cloneDocument(source) : simpleDocument();
    mockWorkflows.set(workflowId, {
      id: workflowId,
      typeIds: [],
      version: 1,
      publishedAt: null,
      publishedBy: null,
      document,
      stageEntityCounts: Object.fromEntries(document.stages.map((s) => [s.id, 0])),
    });
    const type: DemoProcessType = {
      id: nextId(),
      // Код генерирует сервер; в UI не показывается.
      code: `custom-${String(nextId()).slice(-4)}`,
      name,
      icon,
      color,
      description: description ?? '',
      creatable: false,
      category,
      direction: direction ?? null,
      isSystem: false,
      sortOrder: mockTypes.length,
      archivedAt: null,
      workflowId,
      numbering: null,
      // Новый тип: доступ всем, карточка полная.
      config: normalizeTypeConfig({}),
    };
    mockTypes.push(type);
    mockWorkflows.get(workflowId)!.typeIds = [type.id];
    return HttpResponse.json(typeDto(type), { status: 201 });
  }),

  http.patch('/api/v1/workflows/types/:id', async ({ request, params }) => {
    const parsed = updateProcessTypeBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const type = mockTypes.find((t) => t.id === params.id);
    if (!type) return notFound();
    if (isLockedLetterType(type)) return letterCatalogLocked();
    if (
      parsed.data.name !== undefined &&
      mockTypes.some((t) => t.id !== type.id && !t.archivedAt && t.name === parsed.data.name)
    ) {
      return invalid(409, 'PROCESS_TYPE_NAME_TAKEN');
    }
    // «Стандартный» — тип быстрых входов: создание у него заблокировано (О8).
    if (isDefaultProcessType(type) && parsed.data.creatable === false) {
      return invalid(409, 'PROCESS_TYPE_SYSTEM_LOCKED', { reason: 'default_type' });
    }
    Object.assign(type, parsed.data);
    return HttpResponse.json(typeDto(type));
  }),

  // Настройки типа (#432, Р11): разделы заменяются целиком, сохраняются сразу.
  http.patch('/api/v1/workflows/types/:id/config', async ({ request, params }) => {
    const parsed = updateProcessTypeConfigBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const type = mockTypes.find((t) => t.id === params.id);
    if (!type) return notFound();
    // Каталог писем системный; исключение — «где создаётся» (#665), как на сервере.
    const creationOnly =
      Object.keys(parsed.data).length === 1 && parsed.data.creation !== undefined;
    if (isLockedLetterType(type) && !creationOnly) return letterCatalogLocked();
    // «Стандартный»: списки только «всем», создание только разрешено (О8).
    const access = parsed.data.access;
    if (isDefaultProcessType(type) && access && (access.view !== null || access.create !== null)) {
      return invalid(409, 'PROCESS_TYPE_SYSTEM_LOCKED', { reason: 'default_type' });
    }
    type.config = normalizeTypeConfig({ ...type.config, ...parsed.data });
    return HttpResponse.json(typeDto(type));
  }),

  http.post('/api/v1/workflows/types/:id/archive', ({ params }) => {
    const type = mockTypes.find((t) => t.id === params.id);
    if (!type) return notFound();
    if (isLockedLetterType(type)) return letterCatalogLocked();
    if (type.isSystem) return invalid(409, 'PROCESS_TYPE_SYSTEM_LOCKED');
    type.archivedAt = new Date().toISOString();
    return HttpResponse.json(typeDto(type));
  }),

  http.post('/api/v1/workflows/types/:id/restore', ({ params }) => {
    const type = mockTypes.find((t) => t.id === params.id);
    if (!type) return notFound();
    if (isLockedLetterType(type)) return letterCatalogLocked();
    type.archivedAt = null;
    return HttpResponse.json(typeDto(type));
  }),
];
