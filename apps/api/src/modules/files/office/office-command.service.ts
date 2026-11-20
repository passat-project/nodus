import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { OFFICE_CONFIG, type OfficeConfig } from './office.config.js';
import { OfficeTokenService } from './office-token.service.js';

/** Результат команды `drop` для одного документа. */
export type OfficeDropResult =
  /** Пользователь отключён от редактирования. */
  | 'dropped'
  /** Документа уже нет в DS (сессия закрыта) — цель достигнута. */
  | 'gone'
  /** Повтор не поможет (неверный токен/команда) — только лог. */
  | 'permanent';

const COMMAND_TIMEOUT_MS = 5_000;
/** DS ≥ 8.2 — `/command`; старый путь оставлен фолбэком для совместимости. */
const COMMAND_PATHS = ['/command', '/coauthoring/CommandService.ashx'] as const;

/**
 * Document Command Service ONLYOFFICE (#356): команда `drop` отключает
 * пользователя от редактирования документа, не закрывая его остальным
 * соавторам. Нужна при деактивации сотрудника: сессия DS подписана на 24 ч
 * и сама статус не проверяет, а сохранения идут через колбэк.
 *
 * Токен — тот же `OFFICE_JWT_SECRET`, payload — сама команда (DS ≥ 7.1
 * принимает token в теле). Ошибки:
 * - `error: 0` — отключён; `1` — документа нет (сессия уже закрыта);
 * - `5`/`6` — команда/токен неверны: повтор не поможет, логируем;
 * - сеть/5xx/иные коды — бросаем: подписчик деактивации повторит событие.
 */
@Injectable()
export class OfficeCommandService {
  constructor(
    @Inject(OFFICE_CONFIG) private readonly config: OfficeConfig,
    private readonly tokens: OfficeTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfficeCommandService.name);
  }

  /** Отключить пользователя от редактирования конкретного документа. */
  async dropUser(documentKey: string, userId: string): Promise<OfficeDropResult> {
    if (!this.config.enabled) return 'permanent';
    const token = await this.tokens.sign({ c: 'drop', key: documentKey, users: [userId] });
    let lastNotFound: Error | null = null;
    for (const path of COMMAND_PATHS) {
      const response = await fetch(`${this.config.internalUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      });
      if (response.status === 404) {
        lastNotFound = new Error(`Office command endpoint not found: ${path}`);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Office command failed: HTTP ${response.status}`);
      }
      const result = (await response.json()) as { error?: number };
      if (result.error === 0) return 'dropped';
      if (result.error === 1) return 'gone';
      if (result.error === 5 || result.error === 6) {
        this.logger.error(
          { documentKey, userId, code: result.error },
          'office command drop: постоянная ошибка, повтор не поможет',
        );
        return 'permanent';
      }
      throw new Error(`Office command error: ${String(result.error)}`);
    }
    throw lastNotFound ?? new Error('Office command endpoint is unavailable');
  }
}
