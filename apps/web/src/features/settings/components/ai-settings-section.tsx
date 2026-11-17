import { useNavigate, useSearch } from '@tanstack/react-router';

import { AiMcpSection } from './ai-mcp-section.js';
import { AiProvidersSection } from './ai-providers-section.js';
import { parseAiSettingsSection, type AiSettingsSectionId } from './ai-section-switcher.js';
import { AiSkillsSection } from './ai-skills-section.js';

/**
 * Экран «Настройки портала → ИИ-агент» (#894, разделы — #902): реестр с
 * переключателем **Провайдеры / Навыки / MCP** между «Создать» и поиском.
 * Выбранный раздел живёт в URL (`?tab=ai&section=mcp`) — ссылку на MCP можно
 * дать коллеге, F5 не сбрасывает.
 *
 * Каждый раздел — самостоятельный реестр на общем каркасе (шапка h-14,
 * тулбар, таблица `shared/views`, окно создания полями столбиком): никакого
 * нового визуального языка у разделов нет.
 */
export function AiSettingsSection() {
  const search = useSearch({ strict: false }) as { section?: string };
  const navigate = useNavigate();
  const section = parseAiSettingsSection(search.section);
  const onSection = (next: AiSettingsSectionId) => {
    void navigate({ to: '/settings', search: (prev) => ({ ...prev, tab: 'ai', section: next }) });
  };

  if (section === 'skills') return <AiSkillsSection section={section} onSection={onSection} />;
  if (section === 'mcp') return <AiMcpSection section={section} onSection={onSection} />;
  return <AiProvidersSection section={section} onSection={onSection} />;
}
