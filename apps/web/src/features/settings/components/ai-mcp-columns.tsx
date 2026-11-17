import { ui, type AssistantMcpServerInput } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import type { DataTableField } from '../../../shared/views/data-table.js';

const strings = ui.assistant.settings;

/** Сервер в черновике реестра: `id` у сохранённых; у нового — временный
 *  (генерирует клиент, чтобы «по умолчанию» можно было выбрать до PUT). */
export interface McpServerDraft extends AssistantMcpServerInput {
  id: string;
  /** Признак «уже в портале»: только тогда можно проверять соединение. */
  persisted: boolean;
  /** Состояние ключа на сервере (в ответе только признак и хвост). */
  hasKey: boolean;
  keyHint: string | null;
}

/**
 * Колонки реестра MCP-серверов (#902) — те же примитивы `shared/views`, что
 * у провайдеров: никакого нового визуального языка. `tools` — результат
 * проверки соединения за эту сессию экрана («—» до проверки): экран не
 * ходит во внешнюю сеть сам по себе при открытии.
 */
export function mcpColumns(
  defaultServerId: string | null,
  onMakeDefault: (id: string) => void,
  toolCounts: Record<string, number>,
): DataTableField<McpServerDraft>[] {
  return [
    {
      id: 'name',
      label: strings.mcpName,
      defaultVisible: true,
      defaultWidth: 150,
      minWidth: 110,
      locked: true,
      render: (server) => (
        <span className="truncate text-sm font-medium" title={server.name}>
          {server.name}
        </span>
      ),
      sortValue: (server) => server.name.toLowerCase(),
    },
    {
      id: 'url',
      label: strings.mcpUrl,
      defaultVisible: true,
      defaultWidth: 220,
      minWidth: 150,
      render: (server) => (
        <span className="truncate font-mono text-label-sm text-muted-foreground" title={server.url}>
          {server.url}
        </span>
      ),
      sortValue: (server) => server.url,
    },
    {
      id: 'key',
      label: strings.mcpKey,
      defaultVisible: true,
      defaultWidth: 96,
      minWidth: 90,
      render: (server) =>
        server.hasKey ? (
          <NodeChip tone="success">{strings.mcpKeySet}</NodeChip>
        ) : (
          <NodeChip tone="muted">{strings.mcpKeyMissing}</NodeChip>
        ),
    },
    {
      id: 'tools',
      label: strings.mcpColumnTools,
      defaultVisible: true,
      defaultWidth: 92,
      minWidth: 84,
      render: (server) => (
        <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
          {toolCounts[server.id] ?? '—'}
        </span>
      ),
    },
    {
      id: 'default',
      label: strings.mcpDefaultForSearch,
      defaultVisible: true,
      defaultWidth: 150,
      minWidth: 130,
      render: (server) =>
        server.id === defaultServerId ? (
          <span className="truncate text-sm text-primary">{strings.mcpDefaultForSearch}</span>
        ) : (
          <button
            type="button"
            className="truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
            // Клик не всплывает до строки (канон инлайн-контролов ячейки):
            // иначе вместе с назначением открылось бы окно правки.
            onClick={(event) => {
              event.stopPropagation();
              onMakeDefault(server.id);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            title={strings.mcpDefaultHint}
          >
            {strings.mcpDefaultAssign}
          </button>
        ),
    },
    {
      id: 'state',
      label: strings.mcpColumnState,
      defaultVisible: true,
      defaultWidth: 88,
      minWidth: 80,
      render: (server) => (
        <NodeChip tone={server.enabled ? 'success' : 'muted'}>
          {server.enabled ? strings.enabled : strings.disabled}
        </NodeChip>
      ),
    },
  ];
}
