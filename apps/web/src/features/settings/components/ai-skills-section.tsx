import { Plus } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@nodus/ui/components/empty';

import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { AiRegistryHeader } from './ai-registry-header.js';
import type { AiSettingsSectionId } from './ai-section-switcher.js';

const strings = ui.assistant.settings;
const VIEW_KEY = 'ai-skills.list';

/**
 * Раздел «Навыки» (#902): честное пустое состояние до Ф4 — никаких фейковых
 * строк и «Скоро». Навыки — инструкции, которые агент подключает по
 * требованию (ADR-0043 п. 9); раздел уже в структуре экрана, чтобы Ф4 не
 * меняла каркас.
 */
export function AiSkillsSection({
  section,
  onSection,
}: {
  section: AiSettingsSectionId;
  onSection: (next: AiSettingsSectionId) => void;
}) {
  const toolbar = useListToolbar(VIEW_KEY);
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <AiRegistryHeader
        count={0}
        section={section}
        onSection={onSection}
        toolbar={toolbar}
        defs={[]}
        searchPlaceholder={ui.common.searchPlaceholder}
        viewKey={VIEW_KEY}
        create={
          // Создание появится вместе с редактором навыков (Ф4): кнопка на
          // месте (закон кнопки создания), но честно недоступна.
          <Button disabled title={strings.skillsEmptyTitle}>
            <Plus data-icon="inline-start" />
            {ui.common.create}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-10">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{strings.skillsEmptyTitle}</EmptyTitle>
            <EmptyDescription>{strings.skillsEmptyBody}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  );
}
