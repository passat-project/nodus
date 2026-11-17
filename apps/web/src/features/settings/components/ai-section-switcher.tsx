import { useState } from 'react';
import { Check, ChevronDown, Plug, Server, Wrench } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

const strings = ui.assistant.settings;

/**
 * Разделы экрана «Настройки портала → ИИ-агент» (#902, решение владельца
 * 17.11.2026): выпадающий список МЕЖДУ «Создать» и поиском, выбор живёт в
 * URL (`?tab=ai&section=mcp`). Провайдеры — рабочий реестр моделей, Навыки —
 * честное пустое состояние до Ф4, MCP — реестр внешних серверов.
 *
 * Вид — ТОТ ЖЕ, что у «Портфелей» журнала проектов (вердикт владельца
 * 18.11.2026): не системный Select, а кнопка-триггер канона (бордюр, иконка
 * раздела, шеврон с разворотом) и поповер со списком строк, галочка у
 * текущего раздела. Новый визуальный язык не изобретаем.
 */
export const AI_SETTINGS_SECTIONS = ['providers', 'skills', 'mcp'] as const;
export type AiSettingsSectionId = (typeof AI_SETTINGS_SECTIONS)[number];

const SECTION_META: Record<AiSettingsSectionId, { label: string; icon: typeof Plug }> = {
  providers: { label: strings.sectionProviders, icon: Plug },
  skills: { label: strings.sectionSkills, icon: Wrench },
  mcp: { label: strings.sectionMcp, icon: Server },
};

/** Секция из URL: неизвестное значение → «Провайдеры» (ссылка не ломается). */
export function parseAiSettingsSection(raw: string | undefined): AiSettingsSectionId {
  return AI_SETTINGS_SECTIONS.find((id) => id === raw) ?? 'providers';
}

/** Переключатель разделов: единственный вход в «Навыки» и «MCP». */
export function AiSectionSwitcher({
  value,
  onChange,
}: {
  value: AiSettingsSectionId;
  onChange: (next: AiSettingsSectionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = SECTION_META[value];
  const Icon = current.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${strings.sectionsLabel}: ${current.label}`}
          aria-expanded={open}
          title={current.label}
          className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="max-w-40 truncate">{current.label}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        {AI_SETTINGS_SECTIONS.map((id) => {
          const meta = SECTION_META[id];
          const RowIcon = meta.icon;
          const active = id === value;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
              )}
            >
              <span aria-hidden className="shrink-0 text-muted-foreground">
                <RowIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1 truncate">{meta.label}</span>
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {active ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
