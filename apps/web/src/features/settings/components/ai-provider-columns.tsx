import { ui, type AssistantProviderInput } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import type { DataTableField } from '../../../shared/views/data-table.js';

const strings = ui.assistant.settings;

/** Провайдер в черновике настроек: `id` есть у сохранённых, у новых —
 *  временный (генерирует клиент, чтобы дефолт можно было выбрать до PUT). */
export interface ProviderDraft extends AssistantProviderInput {
  id: string;
  /** Признак «уже в портале»: только тогда можно грузить модели и тестировать. */
  persisted: boolean;
  /** Состояние ключа на сервере (в ответе только признак и хвост). */
  hasKey: boolean;
  keyHint: string | null;
}

/**
 * Колонки реестра провайдеров «Настройки портала → ИИ-агент» (замечание
 * владельца 17.11.2026: списочные сущности с полями, как задачи/проекты).
 * Клик по строке — окно правки; тумблер «Включён» и «По умолчанию» —
 * в строке и в окне, состояние ключа — чипом (ключ не показывается).
 */
export function providerColumns(
  defaultProviderId: string | null,
  onMakeDefault: (id: string) => void,
): DataTableField<ProviderDraft>[] {
  return [
    {
      id: 'name',
      label: strings.name,
      defaultVisible: true,
      defaultWidth: 160,
      minWidth: 120,
      locked: true,
      render: (provider) => (
        <span className="truncate text-sm font-medium" title={provider.name}>
          {provider.name}
        </span>
      ),
      sortValue: (provider) => provider.name.toLowerCase(),
    },
    {
      id: 'baseUrl',
      label: strings.baseUrl,
      defaultVisible: true,
      defaultWidth: 188,
      minWidth: 140,
      render: (provider) => (
        <span
          className="truncate font-mono text-label-sm text-muted-foreground"
          title={provider.baseUrl}
        >
          {provider.baseUrl}
        </span>
      ),
      sortValue: (provider) => provider.baseUrl,
    },
    {
      id: 'models',
      label: strings.modelsTitle,
      defaultVisible: true,
      defaultWidth: 56,
      minWidth: 50,
      render: (provider) => (
        <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
          {provider.models.length}
        </span>
      ),
      sortValue: (provider) => provider.models.length,
    },
    {
      id: 'key',
      label: strings.apiKey,
      defaultVisible: true,
      defaultWidth: 96,
      minWidth: 90,
      render: (provider) =>
        provider.hasKey ? (
          <NodeChip tone="success">{strings.providerBadgeOk}</NodeChip>
        ) : (
          <NodeChip tone="muted">{strings.providerBadgeNoKey}</NodeChip>
        ),
    },
    {
      id: 'default',
      label: strings.defaultTitle,
      defaultVisible: true,
      defaultWidth: 106,
      minWidth: 100,
      render: (provider) =>
        provider.id === defaultProviderId ? (
          <span className="truncate text-sm text-primary">{strings.defaultTitle}</span>
        ) : (
          <button
            type="button"
            className="truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
            // Клик не всплывает до строки (канон инлайн-контролов ячейки):
            // иначе вместе с назначением дефолта открылось бы окно правки.
            onClick={(event) => {
              event.stopPropagation();
              onMakeDefault(provider.id);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            title={strings.defaultSet}
          >
            {strings.defaultAssign}
          </button>
        ),
    },
    {
      id: 'state',
      label: strings.columnState,
      defaultVisible: true,
      defaultWidth: 88,
      minWidth: 80,
      render: (provider) => (
        <NodeChip tone={provider.enabled ? 'success' : 'muted'}>
          {provider.enabled ? strings.enabled : strings.disabled}
        </NodeChip>
      ),
    },
  ];
}
