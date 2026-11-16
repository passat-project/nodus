import { HttpResponse, http } from 'msw';
import {
  ErrorCode,
  fileServersBodySchema,
  normalizeFileServer,
  Permission,
  type FileServersResponse,
} from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';

/**
 * Мок «Настроек портала → Файловые серверы» (#558): список в памяти
 * страницы, запись — только с правом `portal.settings.manage`, как на
 * сервере (I8). Стартовое состояние пустое — честное «ничего не открывается».
 */
let servers: string[] = [];
let updatedAt = new Date(0).toISOString();

function current(): FileServersResponse {
  return { servers: [...servers], updatedAt };
}

function canManage(): boolean {
  return (useAuthStore.getState().user?.permissions ?? []).includes(
    Permission.PORTAL_SETTINGS_MANAGE,
  );
}

export const fileServersHandlers = [
  http.get('/api/v1/settings/file-servers', () => HttpResponse.json(current())),

  http.put('/api/v1/settings/file-servers', async ({ request }) => {
    if (!canManage()) {
      return HttpResponse.json(
        { code: ErrorCode.FORBIDDEN, message: 'Forbidden' },
        { status: 403 },
      );
    }
    const parsed = fileServersBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json(
        {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Invalid file servers',
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        { status: 400 },
      );
    }
    servers = parsed.data.servers.map((server) => normalizeFileServer(server)!);
    updatedAt = new Date().toISOString();
    return HttpResponse.json(current());
  }),
];
