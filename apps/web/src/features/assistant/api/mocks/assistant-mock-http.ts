import { HttpResponse } from 'msw';
import { ErrorCode, Permission } from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';

/**
 * Общие ответы MSW-моков ассистента (#895): право использования, 403/404/409
 * и время ISO. Вынесено из обработчиков (I5): один язык ошибок на все моки.
 */

export function canUse(): boolean {
  return Boolean(useAuthStore.getState().user?.permissions.includes(Permission.ASSISTANT_USE));
}

export function forbidden() {
  return HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
}

export function notFound() {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Not found' }, { status: 404 });
}

export function conflict(message: string) {
  return HttpResponse.json({ code: ErrorCode.CONFLICT, message }, { status: 409 });
}

export const nowIso = (): string => new Date().toISOString();
