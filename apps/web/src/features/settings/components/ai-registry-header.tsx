import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';

import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ListToolbarState } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import type { DataTableField } from '../../../shared/views/data-table.js';
import { AiSectionSwitcher, type AiSettingsSectionId } from './ai-section-switcher.js';

const strings = ui.assistant.settings;

/**
 * Шапка реестра «Настройки портала → ИИ-агент» (#902): ОДНА строка h-14 без
 * border-b (канон журналов) — заголовок экрана и счётчик строк активного
 * раздела, затем строка инструментов: «Создать» СЛЕВА от поиска (закон
 * кнопки создания), сразу за ним — переключатель разделов (решение владельца
 * 17.11.2026: список между «Создать» и поиском), справа — шестерёнка полей.
 * Заголовок — имя экрана («ИИ-агент»), а не имя раздела: раздел показывает
 * переключатель, дублировать его в заголовке незачем.
 */
export function AiRegistryHeader<T>({
  count,
  create,
  section,
  onSection,
  toolbar,
  defs,
  searchPlaceholder,
  viewKey,
}: {
  count: number;
  create: ReactNode;
  section: AiSettingsSectionId;
  onSection: (next: AiSettingsSectionId) => void;
  toolbar: ListToolbarState;
  defs: DataTableField<T>[];
  searchPlaceholder: string;
  viewKey: string;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-6">
      <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
        {strings.title}
        <span className="ml-2 align-middle font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      </h1>
      <ListToolbar
        className="min-w-0 flex-1 px-0"
        toolbar={toolbar}
        defs={[]}
        searchPlaceholder={searchPlaceholder}
        left={
          <>
            {create}
            <AiSectionSwitcher value={section} onChange={onSection} />
          </>
        }
        right={<ViewSettings viewKey={viewKey} defs={defs} />}
      />
    </div>
  );
}
