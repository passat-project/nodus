import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ASSISTANT_PROVIDER_PRESETS,
  assistantProviderUrlSchema,
  ui,
  type AssistantAuthType,
  type AssistantHeader,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { ModeChoices, PanelAction, PanelField } from '../../../shared/ui/panel/panel-kit.js';
import type { ProviderDraft } from './ai-provider-columns.js';
import { resolveProviderDefaults } from './ai-provider-defaults.js';
import { ProviderEditBlock } from './ai-provider-edit-block.js';
import { providerPresetOptions } from './ai-provider-presets.js';

const strings = ui.assistant.settings;

export type ProviderDialogMode = { kind: 'create' } | { kind: 'edit'; provider: ProviderDraft };

/** Поля окна: общие для создания и правки (ключ — только запись). */
interface FormState {
  name: string;
  baseUrl: string;
  authType: AssistantAuthType;
  headers: AssistantHeader[];
  enabled: boolean;
  models: ProviderDraft['models'];
}

/**
 * Окно провайдера (замечание владельца 17.11.2026: канон окон сущностей,
 * как проект): создание — пресеты СТРОКАМИ (не ряд кнопок на экране),
 * правка — поля сущности, дефолт портала (тумблер + модель), модели и
 * общие правила ассистента. Окно заполняемое: мимо-клик не закрывает,
 * отмена — кнопка или Esc. «Сохранить» применяет поля и сразу сохраняет
 * настройки портала одним PUT (экран-реестр, кнопки «Сохранить» внизу нет).
 */
export function AiProviderDialog({
  mode,
  defaultProviderId,
  defaultModelId,
  routerProviderId,
  routerModelId,
  instructions,
  onClose,
  onCreate,
  onApply,
}: {
  mode: ProviderDialogMode;
  defaultProviderId: string | null;
  defaultModelId: string | null;
  routerProviderId: string | null;
  routerModelId: string | null;
  instructions: string;
  onClose: () => void;
  onCreate: (
    fields: Pick<FormState, 'name' | 'baseUrl' | 'authType'> & { apiKey?: string },
  ) => void;
  onApply: (
    id: string,
    patch: Partial<ProviderDraft>,
    defaults: {
      defaultProviderId: string | null;
      defaultModelId: string | null;
      routerProviderId: string | null;
      routerModelId: string | null;
    },
    instructions: string,
  ) => void;
}) {
  const editing = mode.kind === 'edit' ? mode.provider : null;
  // Правка: фокус на контейнере окна, не на первом поле (канон окон правки —
  // случайный Enter не должен менять название сущности). Создание — autoFocus
  // названия, как в окне проекта.
  const contentRef = useRef<HTMLDivElement>(null);
  const first = ASSISTANT_PROVIDER_PRESETS[0];
  const [preset, setPreset] = useState<string>(first.key);
  const [form, setForm] = useState<FormState>(() =>
    editing
      ? {
          name: editing.name,
          baseUrl: editing.baseUrl,
          authType: editing.authType,
          headers: editing.headers,
          enabled: editing.enabled,
          models: editing.models,
        }
      : {
          name: first.name,
          baseUrl: first.baseUrl,
          authType: first.authType,
          headers: [],
          enabled: true,
          models: [],
        },
  );
  const [keyDraft, setKeyDraft] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [isDefault, setIsDefault] = useState(editing?.id === defaultProviderId);
  const [pickedModel, setPickedModel] = useState<string | null>(
    editing?.id === defaultProviderId ? defaultModelId : null,
  );
  const [isRouter, setIsRouter] = useState(editing?.id === routerProviderId);
  const [routerModel, setRouterModel] = useState<string | null>(
    editing?.id === routerProviderId ? routerModelId : null,
  );
  const [rules, setRules] = useState(instructions);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));
  const urlOk = assistantProviderUrlSchema.safeParse(form.baseUrl).success;
  const enabledModels = form.models.filter((model) => model.enabled);
  const canSubmit =
    form.name.trim().length > 0 &&
    urlOk &&
    (!isDefault || Boolean(pickedModel)) &&
    (!isRouter || Boolean(routerModel));
  const hasKey = editing?.hasKey && !clearKey;

  function pickPreset(value: string) {
    setPreset(value);
    const found = ASSISTANT_PROVIDER_PRESETS.find((item) => item.key === value);
    if (found) patch({ name: found.name, baseUrl: found.baseUrl, authType: found.authType });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (editing) {
      // Дефолт и диспетчер — две независимые пары; модель обязательна при
      // назначении (иначе ассистенту нечем отвечать).
      const defaults = resolveProviderDefaults({
        editingId: editing.id,
        defaultProviderId,
        defaultModelId,
        routerProviderId,
        routerModelId,
        isDefault,
        pickedModel,
        isRouter,
        routerModel,
      });
      onApply(
        editing.id,
        {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          authType: form.authType,
          headers: form.headers,
          enabled: form.enabled,
          models: form.models,
          ...(keyDraft.trim() ? { apiKey: keyDraft.trim(), clearKey: false } : {}),
          ...(clearKey ? { clearKey: true, apiKey: undefined, hasKey: false, keyHint: null } : {}),
        },
        defaults,
        rules,
      );
    } else {
      onCreate({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        authType: form.authType,
        ...(keyDraft.trim() ? { apiKey: keyDraft.trim() } : {}),
      });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className="max-w-2xl gap-0 p-0 sm:max-w-2xl outline-none"
        aria-describedby={undefined}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          if (editing) {
            event.preventDefault();
            contentRef.current?.focus();
          }
        }}
      >
        <DialogTitle className="px-5 pt-4 text-base font-semibold">
          {editing ? strings.editTitle : strings.createTitle}
        </DialogTitle>
        <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {!editing ? (
              <PanelField label={strings.presetLabel}>
                <ModeChoices
                  value={preset}
                  options={providerPresetOptions}
                  disabled={false}
                  ariaLabel={strings.pickPreset}
                  onChange={pickPreset}
                />
              </PanelField>
            ) : null}

            <PanelField label={strings.name}>
              <Input
                autoFocus={!editing}
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
                aria-label={strings.name}
              />
            </PanelField>
            <PanelField label={strings.baseUrl}>
              <Input
                className="font-mono text-label-sm"
                value={form.baseUrl}
                onChange={(event) => patch({ baseUrl: event.target.value })}
                aria-label={strings.baseUrl}
                aria-invalid={form.baseUrl.length > 0 && !urlOk}
                spellCheck={false}
                autoComplete="off"
              />
              {form.baseUrl.length > 0 && !urlOk ? (
                <span role="alert" className="text-xs text-destructive">
                  {strings.urlInvalid}
                </span>
              ) : null}
            </PanelField>
            <PanelField label={strings.authType}>
              <Select
                value={form.authType}
                onValueChange={(value) => patch({ authType: value as AssistantAuthType })}
              >
                <SelectTrigger aria-label={strings.authType}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">{strings.authTypeBearer}</SelectItem>
                  <SelectItem value="x-api-key">{strings.authTypeApiKey}</SelectItem>
                </SelectContent>
              </Select>
            </PanelField>

            <PanelField label={strings.apiKey}>
              {hasKey && !keyEditing ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-label-sm text-muted-foreground">
                    {strings.apiKeyStored} {editing?.keyHint ? `(…${editing.keyHint})` : ''}
                  </span>
                  <PanelAction icon={Plus} onClick={() => setKeyEditing(true)}>
                    {strings.apiKeyReplace}
                  </PanelAction>
                  <PanelAction
                    icon={Trash2}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setClearKey(true);
                      setKeyDraft('');
                      setKeyEditing(false);
                    }}
                  >
                    {strings.apiKeyClear}
                  </PanelAction>
                </div>
              ) : (
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={strings.apiKeyPlaceholder}
                  aria-label={strings.apiKey}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
              )}
            </PanelField>

            {editing ? (
              <ProviderEditBlock
                provider={editing}
                enabled={form.enabled}
                onEnabled={(enabled) => patch({ enabled })}
                isDefault={isDefault}
                onDefault={setIsDefault}
                pickedModel={pickedModel}
                onPickedModel={setPickedModel}
                isRouter={isRouter}
                onRouter={setIsRouter}
                routerModel={routerModel}
                onRouterModel={setRouterModel}
                enabledModels={enabledModels}
                headers={form.headers}
                onHeaders={(headers) => patch({ headers })}
                models={form.models}
                onModels={(models) => patch({ models })}
                rules={rules}
                onRules={setRules}
              />
            ) : null}
          </div>
          {/* Кнопки окна — СПРАВА (канон окон портала): отмена тихая,
              главное действие — primary. */}
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-5">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {ui.common.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {editing ? ui.common.save : ui.common.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
