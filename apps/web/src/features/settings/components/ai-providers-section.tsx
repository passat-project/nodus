import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { ui, type AiSettingsBody, type AiSettingsResponse } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';
import { toast } from 'sonner';

import { BulkIsland, bulkActionClass } from '../../../shared/views/bulk-island.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { useAiSettingsQuery, useUpdateAiSettings } from '../api/ai-settings.js';
import { AiDefaultModelsBar, type DefaultModelsPatch } from './ai-default-models-bar.js';
import { providerColumns, type ProviderDraft } from './ai-provider-columns.js';
import { AiProviderDialog, type ProviderDialogMode } from './ai-provider-dialog.js';
import { AiRegistryHeader } from './ai-registry-header.js';
import type { AiSettingsSectionId } from './ai-section-switcher.js';

const strings = ui.assistant.settings;
const VIEW_KEY = 'ai-providers.list';

/**
 * Раздел «Провайдеры» экрана «Настройки портала → ИИ-агент» (#894, ADR-0044;
 * вынос в раздел — #902): реестр моделей с колонками-полями, «Создать» слева
 * от поиска, окно создания с полями столбиком. Клик по строке — окно правки;
 * пресеты — выбором при создании. Ниже списка НИЧЕГО нет: дефолт, правила и
 * модели живут в окне провайдера.
 *
 * Сохранение — один `PUT` полной заменой на каждое действие окна/удаления
 * (оптимистично, откат при ошибке): ключ уходит, только если его ввели;
 * ответ сервера не содержит ключей, черновик перечитывается с сервера.
 */
export function AiProvidersSection({
  section,
  onSection,
}: {
  section: AiSettingsSectionId;
  onSection: (next: AiSettingsSectionId) => void;
}) {
  const query = useAiSettingsQuery();
  const save = useUpdateAiSettings();
  const toolbar = useListToolbar(VIEW_KEY);
  const [draft, setDraft] = useState<AiSettingsBody | null>(null);
  const [dialog, setDialog] = useState<ProviderDialogMode | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (query.data && !draft) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  const providers = useMemo(() => (draft?.providers ?? []) as ProviderDraft[], [draft?.providers]);
  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      q
        ? providers.filter(
            (provider) =>
              provider.name.toLowerCase().includes(q) ||
              provider.baseUrl.toLowerCase().includes(q) ||
              provider.models.some((model) => model.id.toLowerCase().includes(q)),
          )
        : providers,
    [providers, q],
  );
  const rowKeys = useMemo(() => rows.map((provider) => provider.id), [rows]);
  const selection = useRowSelection(rowKeys);

  /** Один PUT на действие: черновик применяется сразу, при ошибке — откат
   *  к серверной правде (канон оптимистичных мутаций I4). */
  const persist = useCallback(
    async (next: AiSettingsBody) => {
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

  function createProvider(fields: {
    name: string;
    baseUrl: string;
    authType: ProviderDraft['authType'];
    apiKey?: string;
  }) {
    if (!draft) return;
    const provider: ProviderDraft = {
      id: crypto.randomUUID(),
      ...fields,
      apiFormat: 'openai-chat',
      headers: [],
      enabled: true,
      models: [],
      persisted: false,
      hasKey: Boolean(fields.apiKey),
      keyHint: null,
    };
    void persist({ ...draft, providers: [...providers, provider] });
  }

  function applyProvider(
    id: string,
    patch: Partial<ProviderDraft>,
    defaults: { defaultProviderId: string | null; defaultModelId: string | null },
    instructions: string,
  ) {
    if (!draft) return;
    void persist({
      ...draft,
      providers: providers.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
      defaultProviderId: defaults.defaultProviderId,
      defaultModelId: defaults.defaultModelId,
      instructions,
    });
  }

  function removeProviders(ids: string[]) {
    if (!draft) return;
    const removed = new Set(ids);
    const defaultRemoved = Boolean(draft.defaultProviderId && removed.has(draft.defaultProviderId));
    const routerRemoved = Boolean(draft.routerProviderId && removed.has(draft.routerProviderId));
    void persist({
      ...draft,
      providers: providers.filter((provider) => !removed.has(provider.id)),
      defaultProviderId: defaultRemoved ? null : draft.defaultProviderId,
      defaultModelId: defaultRemoved ? null : draft.defaultModelId,
      // Модель-диспетчер (#917) того же провайдера: пара очищается вместе.
      routerProviderId: routerRemoved ? null : draft.routerProviderId,
      routerModelId: routerRemoved ? null : draft.routerModelId,
    });
    for (const id of ids) selection.deselect(id);
  }

  /** Модели по умолчанию (#917): основная и диспетчер — тем же общим PUT. */
  function applyModels(patch: DefaultModelsPatch) {
    if (!draft) return;
    void persist({ ...draft, ...patch });
  }

  /** Звезда в строке: дефолтный провайдер + его первая включённая модель. */
  const makeDefault = useCallback(
    (id: string) => {
      if (!draft) return;
      const provider = providers.find((item) => item.id === id);
      const model = provider?.models.find((item) => item.enabled)?.id ?? null;
      void persist({ ...draft, defaultProviderId: id, defaultModelId: model });
    },
    [draft, providers, persist],
  );

  const columns = useMemo(
    () => providerColumns(draft?.defaultProviderId ?? null, makeDefault),
    [draft?.defaultProviderId, makeDefault],
  );

  const selectedCount = selection.selected.size;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <AiRegistryHeader
        count={providers.length}
        section={section}
        onSection={onSection}
        toolbar={toolbar}
        defs={columns}
        searchPlaceholder={strings.searchPlaceholder}
        viewKey={VIEW_KEY}
        create={
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={!draft}>
            <Plus data-icon="inline-start" />
            {ui.common.create}
          </Button>
        }
      />

      {draft && providers.length > 0 ? (
        <AiDefaultModelsBar draft={draft} providers={providers} onChange={applyModels} />
      ) : null}

      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={columns}
          rows={rows}
          rowKey={(provider) => provider.id}
          selection={selection}
          isLoading={query.isPending}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          label={strings.providersTitle}
          emptyTitle={q ? ui.customFields.page.emptySearch : strings.providersEmpty}
          onOpenRow={(provider) => setDialog({ kind: 'edit', provider })}
          rowMenu={(provider) => [
            ...(provider.id === draft?.defaultProviderId
              ? []
              : [
                  {
                    id: 'default',
                    icon: <Star className="size-3.5" strokeWidth={1.75} />,
                    label: strings.defaultSet,
                    onSelect: () => makeDefault(provider.id),
                  },
                ]),
            {
              id: 'remove',
              icon: <Trash2 className="size-3.5" strokeWidth={1.75} />,
              label: strings.remove,
              danger: true,
              separatorBefore: true,
              onSelect: () => setDeleteIds([provider.id]),
            },
          ]}
        />
      </div>

      <BulkIsland
        visible={selectedCount > 0}
        count={selectedCount}
        ariaLabel={strings.providersTitle}
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
        <AiProviderDialog
          key={dialog.kind === 'edit' ? dialog.provider.id : 'create'}
          mode={dialog}
          defaultProviderId={draft.defaultProviderId}
          defaultModelId={draft.defaultModelId}
          instructions={draft.instructions}
          onClose={() => setDialog(null)}
          onCreate={createProvider}
          onApply={applyProvider}
        />
      ) : null}

      {deleteIds ? (
        <Dialog open onOpenChange={(open) => !open && setDeleteIds(null)}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogTitle>
              {deleteIds.length === 1 ? strings.deleteConfirmTitle : strings.deleteConfirmBulk}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {strings.deleteConfirmHint}
            </DialogDescription>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteIds(null)}>
                {ui.common.cancel}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeProviders(deleteIds);
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

/** Ответ сервера → черновик: сохранённые провайдеры помечаются `persisted`. */
function toDraft(response: AiSettingsResponse): AiSettingsBody {
  return {
    providers: response.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      authType: provider.authType,
      headers: provider.headers,
      enabled: provider.enabled,
      models: provider.models,
      persisted: true,
      hasKey: provider.hasKey,
      keyHint: provider.keyHint,
    })) as unknown as AiSettingsBody['providers'],
    defaultProviderId: response.defaultProviderId,
    defaultModelId: response.defaultModelId,
    routerProviderId: response.routerProviderId,
    routerModelId: response.routerModelId,
    instructions: response.instructions,
  };
}
