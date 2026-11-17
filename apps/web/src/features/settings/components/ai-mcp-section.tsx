import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlugZap, Plus, Trash2 } from 'lucide-react';
import { ui, type AssistantMcpBody, type AssistantMcpResponse } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';
import { toast } from 'sonner';

import { BulkIsland, bulkActionClass } from '../../../shared/views/bulk-island.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import {
  useMcpSettingsQuery,
  useTestMcpServer,
  useUpdateMcpSettings,
} from '../api/mcp-settings.js';
import { mcpColumns, type McpServerDraft } from './ai-mcp-columns.js';
import { AiMcpDialog, toMcpInput, type McpDialogMode } from './ai-mcp-dialog.js';
import { AiRegistryHeader } from './ai-registry-header.js';
import type { AiSettingsSectionId } from './ai-section-switcher.js';

const strings = ui.assistant.settings;
const VIEW_KEY = 'ai-mcp.list';

/**
 * Раздел «MCP» экрана «Настройки портала → ИИ-агент» (#902): реестр внешних
 * серверов. Первый — Exa (hosted, Streamable HTTP): агент ищет в интернете и
 * читает страницы от имени сотрудника. Ключ шифруется и наружу не уходит;
 * «Проверить соединение» делает handshake и показывает число инструментов —
 * при открытии экрана внешняя сеть не дёргается.
 */
export function AiMcpSection({
  section,
  onSection,
}: {
  section: AiSettingsSectionId;
  onSection: (next: AiSettingsSectionId) => void;
}) {
  const query = useMcpSettingsQuery();
  const save = useUpdateMcpSettings();
  const test = useTestMcpServer();
  const toolbar = useListToolbar(VIEW_KEY);
  const [draft, setDraft] = useState<AssistantMcpBody | null>(null);
  const [dialog, setDialog] = useState<McpDialogMode | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && !draft) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  const servers = useMemo(() => (draft?.servers ?? []) as McpServerDraft[], [draft?.servers]);
  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      q
        ? servers.filter(
            (server) =>
              server.name.toLowerCase().includes(q) || server.url.toLowerCase().includes(q),
          )
        : servers,
    [servers, q],
  );
  const selection = useRowSelection(useMemo(() => rows.map((server) => server.id), [rows]));

  /** Один PUT на действие: черновик сразу, при ошибке — серверная правда. */
  const persist = useCallback(
    async (next: AssistantMcpBody) => {
      setDraft(next);
      try {
        await save.mutateAsync(next);
        toast.success(strings.saved);
      } catch {
        toast.error(strings.saveError);
      }
      setDraft(null);
    },
    [save],
  );

  function createServer(fields: { name: string; url: string; apiKey?: string }) {
    if (!draft) return;
    const input = toMcpInput(crypto.randomUUID(), fields) as McpServerDraft;
    void persist({
      servers: [
        ...servers,
        { ...input, persisted: false, hasKey: Boolean(fields.apiKey), keyHint: null },
      ],
    });
  }

  function applyServer(id: string, patch: Partial<McpServerDraft>) {
    if (!draft) return;
    void persist({
      servers: servers.map((server) => (server.id === id ? { ...server, ...patch } : server)),
    });
  }

  function removeServer(id: string) {
    void persist({ servers: servers.filter((server) => server.id !== id) });
    selection.deselect(id);
    setToolCounts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function testServer(id: string) {
    setTestingId(id);
    try {
      const result = await test.mutateAsync(id);
      if (result.ok) {
        setToolCounts((current) => ({ ...current, [id]: result.tools.length }));
        toast.success(
          `${strings.mcpTestOk}: ${strings.mcpTestTools.toLowerCase()} — ${result.tools.length}`,
        );
      } else {
        toast.error(result.errorMessage ?? strings.mcpTestFailed);
      }
    } catch {
      toast.error(strings.mcpTestFailed);
    } finally {
      setTestingId(null);
    }
  }

  const columns = useMemo(() => mcpColumns(toolCounts), [toolCounts]);
  const selectedCount = selection.selected.size;
  const deleteTitle =
    deleteIds && deleteIds.length > 1
      ? strings.mcpDeleteConfirmBulk
      : strings.mcpDeleteConfirmTitle;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <AiRegistryHeader
        count={servers.length}
        section={section}
        onSection={onSection}
        toolbar={toolbar}
        defs={columns}
        searchPlaceholder={strings.mcpSearchPlaceholder}
        viewKey={VIEW_KEY}
        create={
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={!draft}>
            <Plus data-icon="inline-start" />
            {ui.common.create}
          </Button>
        }
      />

      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={columns}
          rows={rows}
          rowKey={(server) => server.id}
          selection={selection}
          isLoading={query.isPending}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          label={strings.mcpTitle}
          emptyTitle={q ? ui.customFields.page.emptySearch : strings.mcpEmpty}
          onOpenRow={(server) => setDialog({ kind: 'edit', server })}
          rowMenu={(server) => [
            // Новый сервер ещё летит в PUT: проверка дала бы 404 (как у
            // провайдеров — пункт появляется только у сохранённого).
            ...(server.persisted
              ? [
                  {
                    id: 'test',
                    icon: <PlugZap className="size-3.5" strokeWidth={1.75} />,
                    label: testingId === server.id ? strings.mcpTesting : strings.mcpTest,
                    onSelect: () => void testServer(server.id),
                  },
                ]
              : []),
            {
              id: 'remove',
              icon: <Trash2 className="size-3.5" strokeWidth={1.75} />,
              label: strings.mcpRemove,
              danger: true,
              separatorBefore: true,
              onSelect: () => setDeleteId(server.id),
            },
          ]}
        />
      </div>

      <BulkIsland
        visible={selectedCount > 0}
        count={selectedCount}
        ariaLabel={strings.mcpTitle}
        onClear={selection.clear}
      >
        <button
          type="button"
          className={bulkActionClass}
          onClick={() => setDeleteIds([...selection.selected])}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          {strings.deleteSelected}
        </button>
      </BulkIsland>

      {dialog && draft ? (
        <AiMcpDialog
          key={dialog.kind === 'edit' ? dialog.server.id : 'create'}
          mode={dialog}
          onClose={() => setDialog(null)}
          onCreate={createServer}
          onApply={applyServer}
        />
      ) : null}

      {deleteId ? (
        <Dialog open onOpenChange={(open) => !open && setDeleteId(null)}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogTitle>{strings.mcpDeleteConfirmTitle}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {strings.mcpDeleteConfirmHint}
            </DialogDescription>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>
                {ui.common.cancel}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeServer(deleteId);
                  setDeleteId(null);
                }}
              >
                {strings.deleteAction}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {deleteIds ? (
        <Dialog open onOpenChange={(open) => !open && setDeleteIds(null)}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogTitle>{deleteTitle}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {strings.mcpDeleteConfirmHint}
            </DialogDescription>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteIds(null)}>
                {ui.common.cancel}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  // Один PUT на пачку — как «Удалить выбранные» у провайдеров.
                  const ids = new Set(deleteIds);
                  void persist({ servers: servers.filter((server) => !ids.has(server.id)) });
                  ids.forEach((id) => selection.deselect(id));
                  setDeleteIds(null);
                }}
              >
                {strings.deleteAction}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Ответ сервера → черновик: сохранённые серверы помечаются `persisted`. */
function toDraft(response: AssistantMcpResponse): AssistantMcpBody {
  return {
    servers: response.servers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      persisted: true,
      hasKey: server.hasKey,
      keyHint: server.keyHint,
    })) as unknown as AssistantMcpBody['servers'],
  };
}
