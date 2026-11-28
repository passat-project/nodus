import { useCallback } from 'react';
import type { CreateListExportBody } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { createListExport, downloadByUrl } from './list-export-flow.js';

/**
 * Действие «Выгрузить CSV» (#435): до 1000 строк файл приходит сразу — тихий
 * тост и скачивание; больше — фоновая очередь, скромный тост со статусом по
 * поллингу (готов — скачивание, отказ — ошибка). Новых паттернов нет: те же
 * тосты sonner, что у остальных фоновых операций портала.
 */
export function useListExportAction() {
  return useCallback(async (body: CreateListExportBody) => {
    const t = ui.lists.export;
    const toastId = toast.loading(t.preparing);
    try {
      const result = await createListExport(body);
      if (result.kind === 'done') {
        downloadByUrl(result.url);
        toast.success(t.ready, { id: toastId, description: t.downloadHint });
        return;
      }
      toast.error(t.failed, { id: toastId, description: result.error });
    } catch {
      toast.error(t.failed, { id: toastId });
    }
  }, []);
}
