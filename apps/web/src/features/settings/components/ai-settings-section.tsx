import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import {
  ASSISTANT_PROVIDER_PRESETS,
  assistantProviderUrlSchema,
  ui,
  type AiSettingsBody,
  type AiSettingsResponse,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Label } from '@nodus/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Textarea } from '@nodus/ui/components/textarea';
import { toast } from 'sonner';

import { useAiSettingsQuery, useUpdateAiSettings } from '../api/ai-settings.js';
import { AiProviderCard, type ProviderDraft } from './ai-provider-card.js';

const strings = ui.assistant.settings;

/**
 * «Настройки портала → ИИ-агент» (#894, ADR-0044): провайдеры моделей,
 * дефолтный провайдер и модель, дополнительные правила ассистента и
 * технические предохранители (только чтение — без квот).
 *
 * Сохранение — один `PUT` полной заменой: ключ уходит, только если его
 * ввели; ответ сервера не содержит ключей, поэтому черновик после сохранения
 * перечитывается с сервера.
 */
export function AiSettingsSection() {
  const query = useAiSettingsQuery();
  const save = useUpdateAiSettings();
  const [draft, setDraft] = useState<AiSettingsBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && !draft) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  const providers = useMemo(() => (draft?.providers ?? []) as ProviderDraft[], [draft?.providers]);

  if (query.isPending) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (query.isError || !draft) {
    return (
      <div className="node-panel flex flex-col items-start gap-3 p-4">
        <span className="text-sm text-destructive">{strings.saveError}</span>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {ui.common.retry}
        </Button>
      </div>
    );
  }

  const data = query.data;

  function patchProvider(id: string, patch: Partial<ProviderDraft>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: (current.providers as ProviderDraft[]).map((provider) =>
              provider.id === id ? { ...provider, ...patch } : provider,
            ),
          }
        : current,
    );
  }

  function addProvider(preset: (typeof ASSISTANT_PROVIDER_PRESETS)[number]) {
    const provider: ProviderDraft = {
      id: crypto.randomUUID(),
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiFormat: 'openai-chat',
      authType: preset.authType,
      headers: [],
      enabled: true,
      models: [],
      persisted: false,
      hasKey: false,
      keyHint: null,
    };
    setDraft((current) =>
      current
        ? { ...current, providers: [...(current.providers as ProviderDraft[]), provider] }
        : current,
    );
  }

  function removeProvider(id: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: (current.providers as ProviderDraft[]).filter(
              (provider) => provider.id !== id,
            ),
            defaultProviderId: current.defaultProviderId === id ? null : current.defaultProviderId,
            defaultModelId: current.defaultProviderId === id ? null : current.defaultModelId,
          }
        : current,
    );
  }

  function validate(): string | null {
    for (const provider of providers) {
      if (!provider.name.trim()) return strings.nameRequired;
      if (!assistantProviderUrlSchema.safeParse(provider.baseUrl).success)
        return strings.urlInvalid;
    }
    if (draft?.defaultProviderId && !draft.defaultModelId) return strings.modelRequired;
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        providers: providers.map((provider) => ({
          // Новый провайдер уходит без id — сервер выдаст свой (UUID).
          id: provider.persisted ? provider.id : undefined,
          name: provider.name.trim(),
          baseUrl: provider.baseUrl.trim(),
          apiFormat: provider.apiFormat,
          authType: provider.authType,
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
          ...(provider.clearKey ? { clearKey: true } : {}),
          headers: provider.headers,
          enabled: provider.enabled,
          models: provider.models,
        })),
        defaultProviderId: draft?.defaultProviderId ?? null,
        defaultModelId: draft?.defaultModelId ?? null,
        instructions: draft?.instructions ?? '',
      });
      toast.success(strings.saved);
      setDraft(null);
      await query.refetch();
    } catch {
      setError(strings.saveError);
    }
  }

  const defaultProvider = providers.find((provider) => provider.id === draft.defaultProviderId);
  const defaultModels = defaultProvider?.models.filter((model) => model.enabled) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" data-no-scrollbar>
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <header className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">{strings.title}</h2>
            <p className="text-label leading-snug text-muted-foreground">{strings.description}</p>
          </header>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{strings.providersTitle}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {ASSISTANT_PROVIDER_PRESETS.map((preset) => (
                  <Button
                    key={preset.key}
                    variant="secondary"
                    size="sm"
                    onClick={() => addProvider(preset)}
                  >
                    <Plus className="size-3.5" />
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
            {providers.length === 0 ? (
              <div className="node-panel p-4 text-label text-muted-foreground">
                {strings.providersEmpty}
              </div>
            ) : (
              providers.map((provider) => (
                <AiProviderCard
                  key={provider.id}
                  provider={provider}
                  onChange={(patch) => patchProvider(provider.id, patch)}
                  onRemove={() => removeProvider(provider.id)}
                />
              ))
            )}
          </section>

          <section className="node-panel flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold text-foreground">{strings.defaultTitle}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>{strings.defaultProvider}</Label>
                <Select
                  value={draft.defaultProviderId ?? 'none'}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      defaultProviderId: value === 'none' ? null : value,
                      defaultModelId: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={strings.defaultNone} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{strings.defaultNone}</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{strings.defaultModel}</Label>
                <Select
                  value={draft.defaultModelId ?? 'none'}
                  onValueChange={(value) =>
                    setDraft({ ...draft, defaultModelId: value === 'none' ? null : value })
                  }
                  disabled={!defaultProvider}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={strings.defaultNone} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{strings.defaultNone}</SelectItem>
                    {defaultModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label ?? model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="node-panel flex flex-col gap-2 p-4">
            <h3 className="text-sm font-semibold text-foreground">{strings.instructionsTitle}</h3>
            <Textarea
              rows={4}
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              placeholder={strings.instructionsHint}
            />
          </section>

          <section className="node-panel flex flex-col gap-2 p-4">
            <h3 className="text-sm font-semibold text-foreground">{strings.limitsTitle}</h3>
            <p className="text-badge text-muted-foreground">{strings.limitsHint}</p>
            <div className="grid gap-2 text-label text-muted-foreground sm:grid-cols-3">
              <span>
                {strings.limitsSteps}: <b className="text-foreground">{data.limits.maxSteps}</b>
              </span>
              <span>
                {strings.limitsTimeout}:{' '}
                <b className="text-foreground">{data.limits.maxRunSeconds}</b>
              </span>
              <span>
                {strings.limitsResult}:{' '}
                <b className="text-foreground">{data.limits.maxToolResultChars}</b>
              </span>
            </div>
          </section>

          {error ? <span className="text-label text-destructive">{error}</span> : null}
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
        <Button onClick={() => void submit()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {strings.save}
        </Button>
      </footer>
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
    instructions: response.instructions,
  };
}
