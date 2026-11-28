import type {
  CreateListExportBody,
  CreateListExportResult,
  ListExportStatus,
} from '@nodus/contracts';

import { api } from '../../api-client.js';

/**
 * Выгрузка CSV текущей выборки и колонок (#435): до 1000 строк — файл сразу
 * (done + подписанная ссылка выдачи), больше — фоновая очередь (queued +
 * exportId; статусы опрашиваются). Ссылка подписанная и публичная — скачивание
 * обычным <a download>, Content-Disposition с именем ставит сервер.
 */

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 200; // ~10 минут — дальше честная ошибка

export function downloadByUrl(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function waitForExport(
  id: string,
  onTick?: (status: ListExportStatus) => void,
): Promise<ListExportStatus> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const status = await api<ListExportStatus>(`/views/export/${id}`);
    onTick?.(status);
    if (status.status === 'done' || status.status === 'failed') return status;
  }
  return { status: 'failed', error: 'timeout' };
}

/** Заказ выгрузки: синхронный файл — готовая ссылка; фоновая — поллинг до
 *  done/failed. Скачивание вызывает потребитель (тосты — его забота). */
export async function createListExport(
  body: CreateListExportBody,
): Promise<{ kind: 'done'; url: string } | { kind: 'failed'; error: string }> {
  const result = await api<CreateListExportResult>('/views/export', {
    method: 'POST',
    body,
  });
  if (result.status === 'done') return { kind: 'done', url: result.url };
  const status = await waitForExport(result.exportId);
  return status.status === 'done'
    ? { kind: 'done', url: status.url }
    : { kind: 'failed', error: status.status === 'failed' ? status.error : 'unknown' };
}
