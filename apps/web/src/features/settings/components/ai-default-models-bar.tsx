import { ui, type AiSettingsBody } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import type { ProviderDraft } from './ai-provider-columns.js';

const strings = ui.assistant.settings;

/** Модель-диспетчер и основная модель — пара «провайдер + модель». */
export interface DefaultModelsPatch {
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  routerProviderId?: string | null;
  routerModelId?: string | null;
}

const NONE = '__none__';

/**
 * «Модели по умолчанию» (#917): основная модель и необязательная
 * модель-диспетчер. Живут в разделе «Провайдеры» — отдельной вкладки нет
 * (решение владельца 18.11.2026): это выбор модели, а не реестр.
 *
 * Диспетчер может быть у ДРУГОГО провайдера, поэтому пара выбирается здесь,
 * а не в окне одного провайдера. Сохранение — тот же общий PUT экрана.
 */
export function AiDefaultModelsBar({
  draft,
  providers,
  onChange,
}: {
  draft: AiSettingsBody;
  providers: readonly ProviderDraft[];
  onChange: (patch: DefaultModelsPatch) => void;
}) {
  const defaultProvider = providers.find((item) => item.id === draft.defaultProviderId) ?? null;
  const routerProvider = providers.find((item) => item.id === draft.routerProviderId) ?? null;
  const modelsOf = (provider: ProviderDraft | null) =>
    (provider?.models ?? []).filter((model) => model.enabled);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
      <ModelPair
        label={strings.defaultTitle}
        providers={providers}
        providerId={draft.defaultProviderId}
        modelId={draft.defaultModelId}
        noneLabel={strings.defaultNone}
        models={modelsOf(defaultProvider).map((model) => model.id)}
        onProvider={(id) =>
          onChange({
            defaultProviderId: id,
            defaultModelId: id
              ? (modelsOf(providers.find((item) => item.id === id) ?? null)[0]?.id ?? null)
              : null,
          })
        }
        onModel={(id) => onChange({ defaultModelId: id })}
      />
      <ModelPair
        label={strings.routerTitle}
        hint={strings.routerHint}
        providers={providers}
        providerId={draft.routerProviderId ?? null}
        modelId={draft.routerModelId ?? null}
        noneLabel={strings.routerOff}
        models={modelsOf(routerProvider).map((model) => model.id)}
        onProvider={(id) => {
          // Пара «диспетчер» обязательна целиком (refine aiSettingsBodySchema):
          // провайдер без включённых моделей оставил бы modelId=null и PUT
          // падал бы — выбираем первую модель или очищаем ОБА поля.
          const first = id
            ? (modelsOf(providers.find((item) => item.id === id) ?? null)[0]?.id ?? null)
            : null;
          onChange({
            routerProviderId: first ? id : null,
            routerModelId: first,
          });
        }}
        onModel={(id) =>
          onChange(id ? { routerModelId: id } : { routerProviderId: null, routerModelId: null })
        }
      />
    </div>
  );
}

function ModelPair({
  label,
  hint,
  providers,
  providerId,
  modelId,
  models,
  noneLabel,
  onProvider,
  onModel,
}: {
  label: string;
  hint?: string;
  providers: readonly ProviderDraft[];
  providerId: string | null;
  modelId: string | null;
  models: readonly string[];
  noneLabel: string;
  onProvider: (id: string | null) => void;
  onModel: (id: string | null) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" title={hint}>
      <span className="text-label font-medium text-muted-foreground">{label}:</span>
      <Select
        value={providerId ?? NONE}
        onValueChange={(value) => onProvider(value === NONE ? null : value)}
      >
        <SelectTrigger className="h-7 w-auto min-w-32 text-label">
          <SelectValue placeholder={strings.defaultNone} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={modelId ?? NONE}
        disabled={!providerId}
        onValueChange={(value) => onModel(value === NONE ? null : value)}
      >
        <SelectTrigger className="h-7 w-auto min-w-36 text-label">
          <SelectValue placeholder={strings.defaultNone} />
        </SelectTrigger>
        <SelectContent>
          {models.length === 0 ? (
            <SelectItem value={NONE}>{strings.defaultNone}</SelectItem>
          ) : (
            models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
