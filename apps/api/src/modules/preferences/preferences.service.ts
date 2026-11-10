import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  strictUiPreferencesSchema,
  uiPreferencesSchema,
  type UiPreferences,
  type UserPreferencesResponse,
} from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { PreferencesRepository } from './preferences.repository.js';

/** «Никогда не сохранялись»: стабильная метка для клиента/last-write-wins. */
const NEVER_UPDATED = new Date(0).toISOString();

/**
 * Личные настройки интерфейса (#745): чтение/замена `UiPreferences`
 * сотрудника. userId — только из access-токена (параметр сервиса, не тело
 * запроса); сервер не знает чужого профиля (I8). Last-write-wins: раскладка
 * личная, конфликт-UI избыточен; `baseUpdatedAt` принимается, но не
 * блокирует запись.
 *
 * Битые/устаревшие данные в БД не роняют портал: при чтении они проходят
 * `uiPreferencesSchema` (неизвестные поля отбрасываются, невалидная
 * раскладка одного вида — дефолт), при ошибке — пустые настройки.
 */
@Injectable()
export class PreferencesService {
  constructor(private readonly repo: PreferencesRepository) {}

  async get(userId: string): Promise<UserPreferencesResponse> {
    const row = await this.repo.get(userId);
    if (!row) return { preferences: {}, updatedAt: NEVER_UPDATED };
    const parsed = uiPreferencesSchema.safeParse(row.data);
    return {
      preferences: parsed.success ? parsed.data : {},
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async put(userId: string, preferences: UiPreferences): Promise<UserPreferencesResponse> {
    // Запись — строгая схема: мусор отклоняется (400), а не сохраняется
    // молча с потерянными полями. Чтение выше — мягкое (данные уже в БД).
    const parsed = strictUiPreferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid preferences', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const row = await this.repo.put(userId, parsed.data);
    return { preferences: parsed.data, updatedAt: row.updatedAt.toISOString() };
  }
}
