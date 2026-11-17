import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

const strings = ui.assistant.settings;

/**
 * Разделы экрана «Настройки портала → ИИ-агент» (#902, решение владельца
 * 17.11.2026): выпадающий список МЕЖДУ «Создать» и поиском, выбор живёт в
 * URL (`?tab=ai&section=mcp`). Провайдеры — рабочий реестр моделей, Навыки —
 * честное пустое состояние до Ф4, MCP — реестр внешних серверов.
 */
export const AI_SETTINGS_SECTIONS = ['providers', 'skills', 'mcp'] as const;
export type AiSettingsSectionId = (typeof AI_SETTINGS_SECTIONS)[number];

const SECTION_LABELS: Record<AiSettingsSectionId, string> = {
  providers: strings.sectionProviders,
  skills: strings.sectionSkills,
  mcp: strings.sectionMcp,
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
  return (
    <Select value={value} onValueChange={(next) => onChange(next as AiSettingsSectionId)}>
      <SelectTrigger className="w-[148px]" aria-label={strings.sectionsLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AI_SETTINGS_SECTIONS.map((id) => (
          <SelectItem key={id} value={id}>
            {SECTION_LABELS[id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
