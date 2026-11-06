import { ApiError } from '../../../../shared/api-client.js';

/** Ошибки полей окна атрибута (ключ — секция формы). */
export interface Errors {
  name?: string;
  options?: string;
  form?: string;
}

/** details 409 CUSTOM_FIELD_NAME_TAKEN: существующий атрибут (В3) —
 *  диалог предлагает открыть его вместо создания дубля. */
export function suggestionOf(error: unknown): { definitionId: string; name: string } | null {
  if (!(error instanceof ApiError)) return null;
  const suggestion = (error.details as { suggestion?: { definitionId: string; name: string } })
    ?.suggestion;
  return suggestion ?? null;
}
