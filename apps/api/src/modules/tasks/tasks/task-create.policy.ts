import { Inject, Injectable } from '@nestjs/common';
import {
  applyCreationPresets,
  CREATION_FORM_LIMITS,
  effectiveCreationForm,
  ErrorCode,
  missingCreateFields,
  type CreateTaskBody,
  type CreationFieldKey,
  type CreationForm,
  type ProcessType,
  creationSlots,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';

/**
 * Политика создания задачи по типу (#432, Р4–Р6) — ОДНА точка для всех
 * путей: `POST /tasks`, подзадачи, «В задачу» из чата, будущий ИИ-агент и
 * #436. Доступ к типу проверяет каталог (`resolveType` с актором), здесь —
 * скрытые значения формы и обязательность:
 *
 * 1. недействительный пресет (уволенный сотрудник) — 422 `PRESET_INVALID`:
 *    публикация такие значения отсекает, но сотрудник мог уволиться позже;
 * 2. скрытые значения формы ставятся поверх введённого — значение формы
 *    важнее (Р4), даже если клиент прислал своё;
 * 3. обязательные проверяются ПОСЛЕ умолчаний и пресетов: ответственного
 *    сервер ставит сам (постановщик), поэтому его «не хватает» не считает.
 */
@Injectable()
export class TaskCreatePolicy {
  constructor(@Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader) {}

  /** Тело после скрытых значений формы; недействительный пресет — 422. */
  async withPresets(type: ProcessType, body: CreateTaskBody): Promise<CreateTaskBody> {
    const form = formOf(type);
    const invalid = await this.invalidPresetFields(form);
    if (invalid.length > 0) {
      throw new DomainException(
        ErrorCode.PROCESS_TYPE_PRESET_INVALID,
        'Form preset references an unavailable value',
        { typeId: type.id, fields: invalid },
      );
    }
    return applyCreationPresets(form, body);
  }

  /** Обязательные поля формы, которых нет после умолчаний, — 422 (Р5). */
  assertComplete(type: ProcessType, body: CreateTaskBody): void {
    const missing = missingCreateFields(formOf(type), body, {
      // Ответственного ставит сервер (постановщик), если форма его не задала.
      defaultsFilled: new Set(['assignee']),
    });
    if (missing.length === 0) return;
    throw new DomainException(
      ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      'Required creation fields are missing',
      { typeId: type.id, fields: missing, reason: 'create' },
    );
  }

  /** Слоты-пресеты сотрудников, чьи значения не ссылаются на живых. */
  private async invalidPresetFields(form: CreationForm): Promise<CreationFieldKey[]> {
    const slots = creationSlots(form).filter(
      (slot) =>
        slot.preset !== null &&
        (slot.key === 'assignee' || slot.key === 'coexecutors' || slot.key === 'observers'),
    );
    if (slots.length === 0) return [];
    const idsOf = (key: CreationFieldKey, preset: unknown): string[] =>
      key === 'assignee'
        ? typeof preset === 'string'
          ? [preset]
          : []
        : Array.isArray(preset)
          ? preset.slice(0, CREATION_FORM_LIMITS.presetList)
          : [];
    const all = slots.flatMap((slot) => idsOf(slot.key, slot.preset));
    if (all.length === 0) return [];
    const active = new Set(await this.profiles.filterActiveUserIds([...new Set(all)]));
    return slots
      .filter((slot) => idsOf(slot.key, slot.preset).some((id) => !active.has(id)))
      .map((slot) => slot.key);
  }
}

/** Эффективная форма типа: DTO уже несёт форму по умолчанию при `null`. */
function formOf(type: ProcessType): CreationForm {
  return effectiveCreationForm(type.creationForm, type.category);
}
