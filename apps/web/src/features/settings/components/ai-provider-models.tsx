import { useState } from 'react';
import { Loader2, PlugZap, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ui, type AssistantModel } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';

import { PanelAction } from '../../../shared/ui/panel/panel-kit.js';
import { useProviderModels, useTestProvider } from '../api/ai-settings.js';
import type { ProviderDraft } from './ai-provider-columns.js';

const strings = ui.assistant.settings;

/**
 * Блок «Модели» окна провайдера: каталог провайдера («Загрузить модели»),
 * проверка соединения, тумблеры моделей и ручное добавление. Механика та же,
 * что в прежней карточке (#894): модели и тест доступны только сохранённому
 * провайдеру (`persisted`), результат проверки — строкой под действиями.
 */
export function AiProviderModels({
  provider,
  onChange,
}: {
  provider: ProviderDraft;
  onChange: (patch: Partial<ProviderDraft>) => void;
}) {
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const loadModels = useProviderModels();
  const test = useTestProvider();

  async function runTest() {
    if (!provider.persisted) return;
    setTestResult(null);
    try {
      const result = await test.mutateAsync(provider.id);
      setTestOk(result.ok);
      setTestResult(
        result.ok
          ? `${strings.testOk}: ${result.latencyMs} ${ui.assistant.ms}${result.model ? `, ${result.model}` : ''}`
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
    <div className="flex min-w-0 flex-col gap-2">
      <NodeLabel label={strings.modelsTitle} count={provider.models.length} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PanelAction
          icon={RefreshCw}
          onClick={() => void pullModels()}
          disabled={!provider.persisted || loadModels.isPending}
        >
          {loadModels.isPending ? strings.loadingModels : strings.loadModels}
        </PanelAction>
        <PanelAction
          icon={PlugZap}
          onClick={() => void runTest()}
          disabled={!provider.persisted || test.isPending}
        >
          {test.isPending ? strings.testing : strings.test}
        </PanelAction>
        {loadModels.isPending || test.isPending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      {testResult ? (
        <span
          role="status"
          className={cn('text-label', testOk ? 'text-success' : 'text-destructive')}
        >
          {testResult}
        </span>
      ) : null}
      {provider.models.length === 0 ? (
        <span className="text-label text-muted-foreground">{strings.modelsEmpty}</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {provider.models.map((model, index) => (
            <div
              key={model.id}
              className="flex min-h-8 items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/40"
            >
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
              <span
                className="min-w-0 flex-1 truncate font-mono text-label-sm text-foreground"
                title={model.id}
              >
                {model.id}
              </span>
              {model.label ? (
                <span
                  className="max-w-40 truncate text-badge text-muted-foreground"
                  title={model.label}
                >
                  {model.label}
                </span>
              ) : null}
              {model.contextWindow ? (
                <span className="font-mono text-badge text-muted-foreground tabular-nums">
                  {model.contextWindow}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`${strings.remove}: ${model.id}`}
                onClick={() => onChange({ models: provider.models.filter((_, i) => i !== index) })}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </Button>
            </div>
          ))}
        </div>
      )}
      <ManualModelAdd onAdd={(model) => onChange({ models: [...provider.models, model] })} />
    </div>
  );
}

/** Ручное добавление модели: id обязателен, остальное — по желанию. */
function ManualModelAdd({ onAdd }: { onAdd: (model: AssistantModel) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  return open ? (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        className="font-mono text-label-sm"
        placeholder={strings.modelId}
        aria-label={strings.modelId}
        value={id}
        onChange={(event) => setId(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && id.trim()) {
            onAdd({ id: id.trim(), tools: true, vision: false, enabled: true });
            setId('');
            setOpen(false);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
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
  ) : (
    <PanelAction icon={Plus} onClick={() => setOpen(true)}>
      {strings.addModelManually}
    </PanelAction>
  );
}
