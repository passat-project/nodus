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
 *
 * Композиция: раздел открывается вкладкой топбара (левого перечисления нет —
 * вердикт владельца 16.11.2026), внутри — описание, форма добавления и
 * список одной мерой (max-w-xl) — правые края не «пляшут».
 * Список — панель с тоном-ступенью: пустое и ошибочное состояния живут в той
 * же рамке, что и строки, поэтому добавление не прыгает габаритом.
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
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
        <div className="flex max-w-xl flex-col">
          <h1 className="sr-only">{ui.portalSettings.sections.fileServers}</h1>

          <p className="text-sm text-muted-foreground">
            {ui.portalSettings.fileServers.description}
          </p>

          {query.isError ? null : (
            <>
              <form
                className="mt-4 flex items-start gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  add();
                }}
              >
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

          <div className="mt-4">
            {query.isPending ? (
              <div className="node-panel flex flex-col gap-0.5 p-1">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : query.isError ? (
              <div className="node-panel flex items-center justify-between gap-3 px-3.5 py-2.5">
                <p className="min-w-0 text-sm text-destructive">{ui.common.loadError}</p>
                <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                  {ui.common.retry}
                </Button>
              </div>
            ) : servers.length === 0 ? (
              <p className="node-panel px-3.5 py-3 text-sm text-muted-foreground">
                {ui.portalSettings.fileServers.empty}
              </p>
            ) : (
              <ul
                className="node-panel flex flex-col gap-0.5 p-1"
                aria-label={ui.portalSettings.sections.fileServers}
              >
                {servers.map((server) => (
                  <li
                    key={server}
                    className="flex min-h-9 items-center gap-2 rounded-lg pr-1 pl-2.5 text-sm transition-colors hover:bg-accent/40"
                  >
                    <Server
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={server}>
                      {server}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${ui.portalSettings.fileServers.remove}: ${server}`}
                      title={ui.portalSettings.fileServers.remove}
                      disabled={update.isPending}
                      onClick={() => remove(server)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">{ui.portalSettings.fileServers.note}</p>
        </div>
      </div>
    </div>
  );
}
