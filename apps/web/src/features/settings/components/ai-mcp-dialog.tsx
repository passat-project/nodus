import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ASSISTANT_MCP_PRESETS,
  assistantMcpUrlSchema,
  ui,
  type AssistantMcpServerInput,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import {
  ModeChoices,
  PanelAction,
  PanelField,
  SwitchRow,
} from '../../../shared/ui/panel/panel-kit.js';
import type { McpServerDraft } from './ai-mcp-columns.js';

const strings = ui.assistant.settings;

export type McpDialogMode = { kind: 'create' } | { kind: 'edit'; server: McpServerDraft };

/** Поля окна: общие для создания и правки (ключ — только запись). */
interface McpFormState {
  name: string;
  url: string;
  enabled: boolean;
}

const presetOptions = [
  ...ASSISTANT_MCP_PRESETS.map((preset) => ({
    value: preset.key as string,
    label: preset.name,
    hint: preset.url,
  })),
  { value: 'custom', label: strings.mcpPresetCustom, hint: strings.mcpPresetCustomHint },
];

/**
 * Окно MCP-сервера (#902) — канон окон сущностей (как провайдер): создание —
 * готовые серверы СТРОКАМИ (не ряд кнопок), правка — поля столбиком.
 * Заполняемое окно: мимо-клик не закрывает, отмена — кнопка или Esc.
 */
export function AiMcpDialog({
  mode,
  onClose,
  onCreate,
  onApply,
}: {
  mode: McpDialogMode;
  onClose: () => void;
  onCreate: (fields: { name: string; url: string; apiKey?: string }) => void;
  onApply: (id: string, patch: Partial<McpServerDraft>) => void;
}) {
  const editing = mode.kind === 'edit' ? mode.server : null;
  const contentRef = useRef<HTMLDivElement>(null);
  const first = ASSISTANT_MCP_PRESETS[0];
  const [preset, setPreset] = useState<string>(first.key);
  const [form, setForm] = useState<McpFormState>(() =>
    editing
      ? {
          name: editing.name,
          url: editing.url,
          enabled: editing.enabled,
        }
      : {
          name: first.name,
          url: first.url,
          enabled: true,
        },
  );
  const [keyDraft, setKeyDraft] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [clearKey, setClearKey] = useState(false);

  const patch = (next: Partial<McpFormState>) => setForm((current) => ({ ...current, ...next }));
  const urlOk = assistantMcpUrlSchema.safeParse(form.url).success;
  const canSubmit = form.name.trim().length > 0 && urlOk;
  const hasKey = editing?.hasKey && !clearKey;

  function pickPreset(value: string) {
    setPreset(value);
    const found = ASSISTANT_MCP_PRESETS.find((item) => item.key === value);
    if (found) patch({ name: found.name, url: found.url });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (editing) {
      const nextKey = keyDraft.trim();
      // «Заменить» и «Удалить ключ» взаимоисключающие: введённый ключ сильнее
      // нажатого ранее «Удалить» — иначе ввод молча терялся, а сохранённый
      // ключ удалялся (находка code-review 17.11.2026).
      const keyPatch = nextKey
        ? { apiKey: nextKey, clearKey: false }
        : clearKey
          ? { clearKey: true, apiKey: undefined, hasKey: false, keyHint: null }
          : {};
      onApply(editing.id, {
        name: form.name.trim(),
        url: form.url.trim(),
        enabled: form.enabled,
        ...keyPatch,
      });
    } else {
      onCreate({
        name: form.name.trim(),
        url: form.url.trim(),
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
        className="max-w-xl gap-0 p-0 sm:max-w-xl outline-none"
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
          {editing ? strings.mcpEditTitle : strings.mcpCreateTitle}
        </DialogTitle>
        <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {!editing ? (
              <PanelField label={strings.mcpPresetLabel}>
                <ModeChoices
                  value={preset}
                  options={presetOptions}
                  disabled={false}
                  ariaLabel={strings.mcpPresetLabel}
                  onChange={pickPreset}
                />
              </PanelField>
            ) : null}

            <PanelField label={strings.mcpName}>
              <Input
                autoFocus={!editing}
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
                aria-label={strings.mcpName}
              />
            </PanelField>

            <PanelField label={strings.mcpUrl} hint={strings.mcpUrlHint}>
              <Input
                className="font-mono text-label-sm"
                value={form.url}
                onChange={(event) => patch({ url: event.target.value })}
                aria-label={strings.mcpUrl}
                aria-invalid={form.url.length > 0 && !urlOk}
                spellCheck={false}
                autoComplete="off"
              />
              {form.url.length > 0 && !urlOk ? (
                <span role="alert" className="text-xs text-destructive">
                  {strings.mcpUrlInvalid}
                </span>
              ) : null}
            </PanelField>

            <PanelField label={strings.mcpTransport} hint={strings.mcpTransportHint}>
              <span className="text-sm">{strings.mcpTransportStreamable}</span>
            </PanelField>

            <PanelField label={strings.mcpKey} hint={strings.mcpKeyNote}>
              {hasKey && !keyEditing ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-label-sm text-muted-foreground">
                    {strings.mcpKeyStored} {editing?.keyHint ? `(…${editing.keyHint})` : ''}
                  </span>
                  <PanelAction icon={Plus} onClick={() => setKeyEditing(true)}>
                    {strings.mcpKeyReplace}
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
                    {strings.mcpKeyClear}
                  </PanelAction>
                </div>
              ) : (
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={strings.mcpKeyPlaceholder}
                  aria-label={strings.mcpKey}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
              )}
            </PanelField>
            {editing ? (
              <SwitchRow
                title={strings.enabled}
                checked={form.enabled}
                onChange={(enabled) => patch({ enabled })}
              />
            ) : null}
          </div>
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

/** Хелпер для экрана: поля нового сервера → входная схема PUT. */
export function toMcpInput(
  id: string,
  fields: { name: string; url: string; apiKey?: string },
): AssistantMcpServerInput {
  return {
    id,
    name: fields.name,
    url: fields.url,
    transport: 'streamable-http',
    enabled: true,
    ...(fields.apiKey ? { apiKey: fields.apiKey } : {}),
  };
}
