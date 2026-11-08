import { useQuery } from '@tanstack/react-query';
import type {
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldValues,
  NumberHostAssignments,
  NumberHostKind,
} from '@nodus/contracts';

import { api } from '../api-client.js';

/** Фабрика ключей реестра атрибутов (канон patterns.md: ключи только фабрикой).
 *  Каталожные события `custom_field.*` инвалидируют префикс `all`. */
export const customFieldsKeys = {
  all: ['custom-fields'] as const,
  definitions: (module?: CustomFieldModule) =>
    [...customFieldsKeys.all, 'definitions', module ?? 'all'] as const,
};

/** Определения атрибутов портала, отфильтрованные по модулю «Где используется»
 *  (без модуля — весь реестр). Один запрос на операцию: потолок 1000 строк,
 *  кэш не нужен. */
export function useCustomFieldDefinitions(module?: CustomFieldModule) {
  return useQuery({
    queryKey: customFieldsKeys.definitions(module),
    queryFn: () =>
      api<CustomFieldDefinition[]>(
        `/custom-fields/definitions${module ? `?module=${module}` : ''}`,
      ),
  });
}

/** Терпимое чтение значений из сущности: старый API (:5173 владельца)
 *  атрибуты не отдаёт — блок просто не показывается, карточка не падает. */
export function customFieldValuesOf(entity: {
  customFields?: CustomFieldValues;
}): CustomFieldValues {
  return entity.customFields ?? {};
}

/** Номера одной записи (#630, П5): карточка «выдан когда, кем, в каком
 *  счёте». Чтение — право на запись, проверяет сервер. */
export function useNumberHostAssignments(kind: NumberHostKind, id: string | null) {
  return useQuery({
    queryKey: ['numbering', 'host', kind, id] as const,
    queryFn: () => api<NumberHostAssignments>(`/custom-fields/numbering/host/${kind}/${id}`),
    enabled: id !== null,
  });
}
