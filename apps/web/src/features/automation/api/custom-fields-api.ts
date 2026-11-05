import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldUsage,
  CustomFieldValue,
  CustomFieldBindingKind,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import { bindingsOf, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { customFieldsKeys } from '../../../shared/custom-fields/queries.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

type DefinitionLists = Array<[readonly unknown[], CustomFieldDefinition[]]>;

/** Все подгруженные списки определений (по модулям) — оптимистичные
 *  правки бьют в каждый, как списки задач в журнале. */
function definitionLists(queryClient: ReturnType<typeof useQueryClient>): DefinitionLists {
  return queryClient.getQueriesData<CustomFieldDefinition[]>({
    queryKey: customFieldsKeys.all,
  }) as DefinitionLists;
}

function patchLists(
  queryClient: ReturnType<typeof useQueryClient>,
  patch: (definition: CustomFieldDefinition) => CustomFieldDefinition,
): void {
  for (const [key, data] of definitionLists(queryClient)) {
    if (!data) continue;
    queryClient.setQueryData(
      key,
      data.map((definition) => patch(definition)),
    );
  }
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: customFieldsKeys.all });
}

/** Создание атрибута — пессимистично (составная операция «справочник →
 *  атрибут»); ошибки (имя, потолок, тип) показывает окно, включая
 *  предложение существующего при дубле имени (В3). */
export function useCreateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomFieldBody) =>
      api<CustomFieldDefinition>('/custom-fields/definitions', { method: 'POST', body }),
    onSuccess: () => invalidate(queryClient),
  });
}

/** Правка определения: имя, подсказка, тип, настройки, умолчание,
 *  привязки, отчёты. Оптимистично с откатом; ошибку разбирает вызывающий. */
export function useUpdateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateCustomFieldBody }) =>
      api<CustomFieldDefinition>(`/custom-fields/definitions/${vars.id}`, {
        method: 'PATCH',
        body: vars.body,
      }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: customFieldsKeys.all });
      const previous = definitionLists(queryClient);
      patchLists(queryClient, (definition) =>
        definition.id === id ? { ...definition, ...patchOf(definition, body) } : definition,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (definition) => {
      patchLists(queryClient, (current) => (current.id === definition.id ? definition : current));
    },
    onSettled: () => invalidate(queryClient),
  });
}

/** Поля тела правки → форма определения (сервер вернёт истину после ответа). */
function patchOf(
  definition: CustomFieldDefinition,
  body: UpdateCustomFieldBody,
): Partial<CustomFieldDefinition> {
  const patch: Partial<CustomFieldDefinition> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.hint !== undefined) patch.hint = body.hint;
  if (body.type !== undefined) patch.type = body.type;
  if (body.reportIndexed !== undefined) patch.reportIndexed = body.reportIndexed;
  if (body.defaultValue !== undefined) patch.defaultValue = body.defaultValue;
  if (body.settings !== undefined) {
    patch.settings = { ...definition.settings, ...body.settings };
  }
  if (body.bindings !== undefined) patch.bindings = body.bindings;
  return patch;
}

/** Где используется атрибут (окно удаления): агрегат последствий — значения
 *  по сущностям, формы, маршруты, привязки, глобальное значение. Без кэша:
 *  окно всегда проверяет свежую картину. */
export function useCustomFieldUsage(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      // Свой префикс, не customFieldsKeys.all: оптимистичные правки
      // перебирают кэши «all» как массивы определений.
      queryKey: ['custom-field-usage', id] as const,
      queryFn: () => api<CustomFieldUsage>(`/custom-fields/definitions/${id}/usage`),
      staleTime: 0,
      gcTime: 0,
    })),
  });
}

/** Удаление атрибутов (одного или пачки): пессимистично — необратимо.
 *  Разрешено всегда (Р8): значения стираются вместе с определением,
 *  карточки перечитываются по инвалидации задач. */
export function useDeleteCustomFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api<void>(`/custom-fields/definitions/${id}`, { method: 'DELETE' })),
      );
      return results.filter((result) => result.status === 'fulfilled').length;
    },
    onSettled: () => {
      invalidate(queryClient);
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
    },
  });
}

/** Порядок атрибутов портала (ids = ровно все атрибуты реестра). */
export function useReorderCustomFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderCustomFieldsBody) =>
      api<void>('/custom-fields/definitions/order', { method: 'PUT', body }),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: customFieldsKeys.all });
      const previous = definitionLists(queryClient);
      const order = new Map(ids.map((id, index) => [id, index]));
      patchLists(queryClient, (definition) =>
        order.has(definition.id) ? { ...definition, sortOrder: order.get(definition.id)! } : definition,
      );
      return { previous };
    },
    onError: (_error, _body, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      toast.error(ui.common.saveError);
    },
    onSettled: () => invalidate(queryClient),
  });
}

/** Список привязок нужного вида у определения (для оптимистичной правки). */
function bindingListOf(definition: CustomFieldDefinition, kind: CustomFieldBindingKind): string[] {
  const bindings = bindingsOf(definition);
  return kind === 'process-type'
    ? bindings.processTypeIds
    : kind === 'project-type'
      ? bindings.projectTypeIds
      : bindings.nodeKindIds;
}

function withBindingList(
  definition: CustomFieldDefinition,
  kind: CustomFieldBindingKind,
  list: string[],
): CustomFieldDefinition {
  const bindings = bindingsOf(definition);
  return {
    ...definition,
    bindings: {
      processTypeIds: kind === 'process-type' ? list : bindings.processTypeIds,
      projectTypeIds: kind === 'project-type' ? list : bindings.projectTypeIds,
      nodeKindIds: kind === 'node-kind' ? list : bindings.nodeKindIds,
    },
  };
}

/**
 * Привязка атрибута к месту «Где используется» (#631, Р3): оптимистично
 * (I4) и по очереди на атрибут: два быстрых клика по разным местам не
 * перетирают список друг друга. Идемпотентна и всегда разрешена (В4).
 */
export function useBindFieldTarget(fieldId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: `field-bindings:${fieldId}` },
    mutationFn: (vars: { kind: CustomFieldBindingKind; targetId: string }) =>
      api<CustomFieldDefinition>(
        `/custom-fields/definitions/${fieldId}/bindings/${vars.kind}/${vars.targetId}`,
        { method: 'PUT' },
      ),
    onMutate: async ({ kind, targetId }) => {
      await queryClient.cancelQueries({ queryKey: customFieldsKeys.all });
      const previous = definitionLists(queryClient);
      patchLists(queryClient, (definition) =>
        definition.id === fieldId && !bindingListOf(definition, kind).includes(targetId)
          ? withBindingList(definition, kind, [...bindingListOf(definition, kind), targetId])
          : definition,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (definition) => {
      patchLists(queryClient, (current) => (current.id === definition.id ? definition : current));
    },
    onSettled: () => invalidate(queryClient),
  });
}

/** Снятие привязки (#631): оптимистично; ошибка — откат. */
export function useUnbindFieldTarget(fieldId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: `field-bindings:${fieldId}` },
    mutationFn: (vars: { kind: CustomFieldBindingKind; targetId: string }) =>
      api<CustomFieldDefinition>(
        `/custom-fields/definitions/${fieldId}/bindings/${vars.kind}/${vars.targetId}`,
        { method: 'DELETE' },
      ),
    onMutate: async ({ kind, targetId }) => {
      await queryClient.cancelQueries({ queryKey: customFieldsKeys.all });
      const previous = definitionLists(queryClient);
      patchLists(queryClient, (definition) =>
        definition.id === fieldId
          ? withBindingList(
              definition,
              kind,
              bindingListOf(definition, kind).filter((id) => id !== targetId),
            )
          : definition,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (definition) => {
      patchLists(queryClient, (current) => (current.id === definition.id ? definition : current));
    },
    onSettled: () => invalidate(queryClient),
  });
}

/** Значение глобальной переменной (Р7): правит администратор из реестра;
 *  оптимистично — значение видно сразу, ошибка откатывает. */
export function useSetCompanyValue() {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: 'company-value' },
    mutationFn: (vars: { fieldId: string; value: CustomFieldValue }) =>
      api<CustomFieldDefinition>(`/custom-fields/definitions/${vars.fieldId}/company-value`, {
        method: 'PUT',
        body: { value: vars.value },
      }),
    onMutate: async ({ fieldId, value }) => {
      await queryClient.cancelQueries({ queryKey: customFieldsKeys.all });
      const previous = definitionLists(queryClient);
      patchLists(queryClient, (definition) =>
        definition.id === fieldId ? { ...definition, companyValue: value } : definition,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      toast.error(ui.common.saveError);
    },
    onSuccess: (definition) => {
      patchLists(queryClient, (current) => (current.id === definition.id ? definition : current));
    },
    onSettled: () => invalidate(queryClient),
  });
}
