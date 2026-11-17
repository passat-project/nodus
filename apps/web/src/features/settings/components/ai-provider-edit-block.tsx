import { ui, type AssistantHeader } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Textarea } from '@nodus/ui/components/textarea';

import { PanelField, SwitchRow } from '../../../shared/ui/panel/panel-kit.js';
import type { ProviderDraft } from './ai-provider-columns.js';
import { HeadersEditor } from './ai-provider-headers.js';
import { AiProviderModels } from './ai-provider-models.js';

const strings = ui.assistant.settings;

/** Правка провайдера: состояние, дефолт портала, заголовки, модели, правила. */
export function ProviderEditBlock({
  provider,
  enabled,
  onEnabled,
  isDefault,
  onDefault,
  pickedModel,
  onPickedModel,
  enabledModels,
  headers,
  onHeaders,
  models,
  onModels,
  rules,
  onRules,
}: {
  provider: ProviderDraft;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  isDefault: boolean;
  onDefault: (isDefault: boolean) => void;
  pickedModel: string | null;
  onPickedModel: (model: string | null) => void;
  enabledModels: ProviderDraft['models'];
  headers: AssistantHeader[];
  onHeaders: (headers: AssistantHeader[]) => void;
  models: ProviderDraft['models'];
  onModels: (models: ProviderDraft['models']) => void;
  rules: string;
  onRules: (rules: string) => void;
}) {
  return (
    <>
      <SwitchRow title={strings.enabled} checked={enabled} onChange={onEnabled} />
      <SwitchRow
        title={strings.defaultSwitch}
        checked={isDefault}
        onChange={(checked) => {
          onDefault(checked);
          if (checked && !pickedModel) onPickedModel(enabledModels[0]?.id ?? null);
        }}
      />
      {isDefault ? (
        <PanelField label={strings.defaultModel}>
          <Select
            value={pickedModel ?? 'none'}
            onValueChange={(value) => onPickedModel(value === 'none' ? null : value)}
          >
            <SelectTrigger aria-label={strings.defaultModel}>
              <SelectValue placeholder={strings.defaultNone} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{strings.defaultNone}</SelectItem>
              {enabledModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label ?? model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!pickedModel ? (
            <span role="alert" className="text-xs text-destructive">
              {strings.defaultModelRequired}
            </span>
          ) : null}
        </PanelField>
      ) : null}
      <HeadersEditor headers={headers} onChange={onHeaders} />
      <AiProviderModels
        provider={{ ...provider, headers, models }}
        onChange={(next) => {
          if (next.models) onModels(next.models);
        }}
      />
      <PanelField label={`${strings.instructionsTitle} · ${strings.instructionsScope}`}>
        <Textarea
          rows={3}
          value={rules}
          onChange={(event) => onRules(event.target.value)}
          placeholder={strings.instructionsHint}
          aria-label={strings.instructionsTitle}
        />
      </PanelField>
    </>
  );
}
