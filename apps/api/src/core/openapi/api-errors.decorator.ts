import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { apiErrorResponseSchema } from '@nodus/contracts';

/**
 * Документирование ошибок единого формата (api-conventions.md): каждая ошибка —
 * `{ code, message, details?, traceId }`. `@ApiErrors(400, 401, …)` на маршруте
 * добавляет ответы с общей схемой `apiErrorResponseSchema` — без дублирования.
 */

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 502 | 503;

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'Ошибка валидации (VALIDATION_FAILED) или доменного правила',
  401: 'Нет или просрочена аутентификация (UNAUTHENTICATED)',
  403: 'Недостаточно прав (FORBIDDEN)',
  404: 'Сущность не найдена или нет доступа (NOT_FOUND)',
  409: 'Конфликт состояния, в т.ч. идемпотентность с иным телом (CONFLICT)',
  410: 'Ресурс больше недоступен (файл в карантине, FILE_QUARANTINED)',
  413: 'Файл больше лимита вложений (CHAT_ATTACHMENT_TOO_LARGE)',
  422: 'Документ семантически неверен или требуется выбор (WORKFLOW_*, #378)',
  429: 'Превышен лимит запросов (RATE_LIMITED)',
  500: 'Непредвиденная ошибка сервера (INTERNAL_ERROR)',
  502: 'Внешний сервис не ответил (ASSISTANT_PROVIDER_UNAVAILABLE, #889)',
  503: 'Сервис временно недоступен (FILE_OFFICE_DISABLED и подобные)',
};

export function ApiErrors(...statuses: ErrorStatus[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status],
        standardSchema: apiErrorResponseSchema,
      }),
    ),
  );
}
