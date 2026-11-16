import { useEffect } from 'react';

import { useFileServersStore } from '../../../shared/desktop/file-servers-store.js';
import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { useFileServersQuery } from '../api/file-servers.js';

/**
 * Один запрос списка файловых серверов на сессию оболочки (#558): кладёт
 * снимок в общий стор, который читает значение-путь. В браузере не нужен —
 * там путь только копируется; страница настроек грузит список сама.
 */
export function FileServersSync() {
  const enabled = isDesktopShell();
  const query = useFileServersQuery(enabled);
  const setServers = useFileServersStore((s) => s.setServers);
  const reset = useFileServersStore((s) => s.reset);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    if (query.data) setServers(query.data.servers);
  }, [enabled, query.data, setServers, reset]);

  return null;
}
