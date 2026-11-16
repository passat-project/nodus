import { useState } from 'react';
import { Plus, Server, Trash2 } from 'lucide-react';
import {
  FILE_SERVER_LIMITS,
  fileServerKey,
  normalizeFileServer,
  parseFileServer,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { toast } from 'sonner';

import { useFileServersQuery, useUpdateFileServers } from '../api/file-servers.js';

/**
 * Раздел «Файловые серверы» (#558): список `\\server\share`, внутри которых
 * десктоп-приложение открывает файлы значений «Ссылка или путь». Добавление
 * и удаление сохраняются сразу (оптимистично, откат при ошибке): список —
 * короткий перечень, отдельная кнопка «Сохранить» была бы лишним шагом.
 */
export function FileServersSection() {
  const query = useFileServersQuery();
  const update = useUpdateFileServers();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const servers = query.data?.servers ?? [];
  const atLimit = servers.length >= FILE_SERVER_LIMITS.count;
  const ready = query.isSuccess;

  const add = () => {
    if (!ready || atLimit) return;
    const normalized = normalizeFileServer(draft);
    if (!normalized || normalized.length > FILE_SERVER_LIMITS.length) {
      setError(ui.portalSettings.fileServers.invalid);
      return;
    }
    const parsed = parseFileServer(normalized);
    if (!parsed) {
      setError(ui.portalSettings.fileServers.invalid);
      return;
    }
    const key = fileServerKey(parsed.server, parsed.share);
    if (
      servers.some((value) => {
        const existing = parseFileServer(value);
        return existing !== null && fileServerKey(existing.server, existing.share) === key;
      })
    ) {
      setError(ui.portalSettings.fileServers.duplicate);
      return;
    }
    setError(null);
    update.mutate([...servers, normalized], {
      onSuccess: () => setDraft(''),
      onError: () => toast.error(ui.portalSettings.fileServers.saveError),
    });
  };

  const remove = (value: string) => {
    setError(null);
    update.mutate(
      servers.filter((server) => server !== value),
      { onError: () => toast.error(ui.portalSettings.fileServers.saveError) },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h2 className="text-lg font-semibold text-foreground">
          {ui.portalSettings.sections.fileServers}
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {servers.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {ui.portalSettings.fileServers.description}
        </p>

        {query.isError ? null : (
          <>
            <form
              className="mt-4 flex max-w-xl items-start gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={ui.portalSettings.fileServers.placeholder}
                  aria-label={ui.portalSettings.fileServers.placeholder}
                  aria-invalid={error !== null}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-[13px]"
                />
              </div>
              <Button
                type="submit"
                disabled={!ready || update.isPending || atLimit || draft.trim() === ''}
              >
                <Plus data-icon="inline-start" />
                {ui.portalSettings.fileServers.add}
              </Button>
            </form>
            {error ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : atLimit ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {ui.portalSettings.fileServers.limit}
              </p>
            ) : null}
          </>
        )}

        {query.isPending ? (
          <div className="mt-6 flex max-w-xl flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <div className="mt-6 flex max-w-xl items-center gap-3">
            <p className="text-sm text-destructive">{ui.common.loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {ui.common.retry}
            </Button>
          </div>
        ) : servers.length === 0 ? (
          <p className="mt-6 max-w-xl text-sm text-muted-foreground">
            {ui.portalSettings.fileServers.empty}
          </p>
        ) : (
          <ul
            className="mt-4 flex max-w-xl flex-col gap-1"
            aria-label={ui.portalSettings.sections.fileServers}
          >
            {servers.map((server) => (
              <li
                key={server}
                className="group/row flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors hover:bg-accent/40"
              >
                <Server
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={server}>
                  {server}
                </span>
                <button
                  type="button"
                  aria-label={`${ui.portalSettings.fileServers.remove}: ${server}`}
                  title={ui.portalSettings.fileServers.remove}
                  disabled={update.isPending}
                  onClick={() => remove(server)}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 max-w-xl text-xs text-muted-foreground">
          {ui.portalSettings.fileServers.note}
        </p>
      </div>
    </div>
  );
}
