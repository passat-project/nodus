import type { WorkflowValidator, WorkflowValidatorDto } from '@nodus/contracts';

/**
 * Валидатор → DTO карточки (#635): настройка обхода (extraUserIds — до 50
 * uuid сотрудников) не уходит каждому, кто видит карточку; обходит ли актор
 * проверку, решает сервер (`canOverride`). Моки повторяют серверный
 * stripOverride — демо-ответы совпадают с живым API байт-в-байт.
 */
export function stripValidatorOverride(validator: WorkflowValidator): WorkflowValidatorDto {
  if (validator.kind === 'records') {
    return { kind: validator.kind, title: validator.title, query: validator.query };
  }
  if (validator.kind === 'formula') {
    return { kind: validator.kind, title: validator.title, formula: validator.formula };
  }
  return validator;
}
