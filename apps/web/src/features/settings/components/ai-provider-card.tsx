import { useState } from 'react';
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { ui, type AssistantModel, type AssistantProviderInput } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Label } from '@nodus/ui/components/label';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';

import { useProviderModels, useTestProvider } from '../api/ai-settings.js';

const strings = ui.assistant.settings;

/** Провайдер в черновике формы: `id` есть у сохранённых, у новых — временный. */
export interface ProviderDraft extends AssistantProviderInput {
  id: string;
  /** Признак «уже в портале»: только тогда можно грузить модели и тестировать. */
  persisted: boolean;
  /** Состояние ключа на сервере (в ответе только признак и хвост). */
  hasKey: boolean;
  keyHint: string | null;
}

/**
 * Карточка провайдера в «Настройках портала → ИИ-агент» (#894): адрес, ключ
 * (только запись — показываем хвост), заголовки, модели, проверка соединения.
 * Форма не хранит ключ: сервер отдаёт `hasKey` и хвост, новый ключ уходит
 * только если администратор его ввёл.
 */
export function AiProviderCard({
  provider,
  onChange,
  onRemove,
}: {
  provider: ProviderDraft;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onRemove: () => void;
}) {
  const [keyDraft, setKeyDraft] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const loadModels = useProviderModels();
  const test = useTestProvider();
  const modelsOpen = provider.models.length > 0;

  function applyKey() {
    if (!keyDraft.trim()) return;
    onChange({ apiKey: keyDraft.trim(), clearKey: false });
    setKeyDraft('');
    setKeyEditing(false);
  }

  async function runTest() {
    if (!provider.persisted) return;
    setTestResult(null);
    try {
      const result = await test.mutateAsync(provider.id);
      setTestOk(result.ok);
      setTestResult(
        result.ok
          ? `${strings.testOk}: ${result.latencyMs} мс${result.model ? `, ${result.model}` : ''}`
          : `${strings.testFailed}: ${result.errorMessage ?? result.errorCode ?? ''}`,
      );
    } catch {
      setTestOk(false);
      setTestResult(strings.testFailed);
    }
  }

  async function pullModels() {
    if (!provider.persisted) return;
    try {
      const response = await loadModels.mutateAsync(provider.id);
      const known = new Map(provider.models.map((model) => [model.id, model]));
      const merged: AssistantModel[] = response.models.map((catalog) => ({
        ...(known.get(catalog.id) ?? {
          id: catalog.id,
          tools: true,
          vision: false,
          enabled: true,
        }),
        label: known.get(catalog.id)?.label ?? catalog.label ?? undefined,
        contextWindow: catalog.contextWindow ?? undefined,
        maxOutput: catalog.maxOutput ?? undefined,
        inputPricePerM: catalog.inputPricePerM ?? undefined,
        outputPricePerM: catalog.outputPricePerM ?? undefined,
      }));
      onChange({ models: merged });
    } catch {
      setTestOk(false);
      setTestResult(`${strings.testFailed}: ${strings.loadModels}`);
    }
  }

  return (
    <div className="node-panel flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{provider.name}</span>
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-badge',
                provider.hasKey ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {provider.hasKey ? strings.providerBadgeOk : strings.providerBadgeNoKey}
            </span>
            {!provider.enabled ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-badge text-muted-foreground">
                {strings.disabled}
              </span>
            ) : null}
          </div>
          <span className="truncate font-mono text-badge text-muted-foreground">
            {provider.baseUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={provider.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
            aria-label={strings.enabled}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={strings.remove}
            title={strings.remove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 @container sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ai-name-${provider.id}`}>{strings.name}</Label>
          <Input
            id={`ai-name-${provider.id}`}
            value={provider.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ai-url-${provider.id}`}>{strings.baseUrl}</Label>
          <Input
            id={`ai-url-${provider.id}`}
            className="font-mono text-label"
            value={provider.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
          <span className="text-badge text-muted-foreground">{strings.baseUrlHint}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{strings.apiKey}</Label>
        {provider.hasKey && !keyEditing ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-label text-muted-foreground">
              {strings.apiKeyStored} {provider.keyHint ? `(…${provider.keyHint})` : ''}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setKeyEditing(true)}>
              {strings.apiKeyReplace}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                onChange({ clearKey: true, apiKey: undefined, hasKey: false, keyHint: null })
              }
            >
              {strings.apiKeyClear}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder={strings.apiKeyPlaceholder}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={applyKey} disabled={!keyDraft.trim()}>
              {strings.save}
            </Button>
          </div>
        )}
        <span className="text-badge text-muted-foreground">{strings.apiKeyNote}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void pullModels()}
          disabled={!provider.persisted || loadModels.isPending}
        >
          {loadModels.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {loadModels.isPending ? strings.loadingModels : strings.loadModels}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void runTest()}
          disabled={!provider.persisted || test.isPending}
        >
          {test.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {test.isPending ? strings.testing : strings.test}
        </Button>
        <span className="text-badge text-muted-foreground">
          {strings.modelsCount}: {provider.models.length}
        </span>
        {testResult ? (
          <span className={cn('text-label', testOk ? 'text-foreground' : 'text-destructive')}>
            {testResult}
          </span>
        ) : null}
      </div>

      <details open={modelsOpen} className="group rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-foreground">
          <ChevronDown className="size-4 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
          {strings.modelsTitle}
        </summary>
        <div className="flex flex-col gap-1 border-t border-border p-2">
          {provider.models.length === 0 ? (
            <span className="px-1 py-2 text-label text-muted-foreground">
              {strings.modelsEmpty}
            </span>
          ) : (
            provider.models.map((model, index) => (
              <div key={model.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                <Switch
                  checked={model.enabled}
                  onCheckedChange={(enabled) =>
                    onChange({
                      models: provider.models.map((item, i) =>
                        i === index ? { ...item, enabled } : item,
                      ),
                    })
                  }
                  aria-label={`${strings.enabled}: ${model.id}`}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">
                  {model.id}
                </span>
                {model.label ? (
                  <span className="truncate text-badge text-muted-foreground">{model.label}</span>
                ) : null}
                {model.contextWindow ? (
                  <span className="text-badge text-muted-foreground">{model.contextWindow}</span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`${strings.remove}: ${model.id}`}
                  onClick={() =>
                    onChange({ models: provider.models.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
          <ManualModelAdd onAdd={(model) => onChange({ models: [...provider.models, model] })} />
        </div>
      </details>
    </div>
  );
}

/** Ручное добавление модели: id обязателен, остальное — по желанию. */
function ManualModelAdd({ onAdd }: { onAdd: (model: AssistantModel) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-border pt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 self-start px-1 text-label text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="size-3.5" />
        {strings.addModelManually}
      </button>
      {open ? (
        <div className="flex items-center gap-2 px-1">
          <Input
            className="font-mono text-label"
            placeholder={strings.modelId}
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!id.trim()}
            onClick={() => {
              onAdd({ id: id.trim(), tools: true, vision: false, enabled: true });
              setId('');
              setOpen(false);
            }}
          >
            {ui.common.add}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
