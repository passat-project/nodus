import type { ProcessType, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { ChevronRight } from 'lucide-react';

import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';

/**
 * Дорожка «Договор → Задание смежнику» (#857, единая модель §5): тип
 * процесса открыт из типа проекта — клик по проекту возвращает в его
 * рабочую область (снимает `type`, оставляя `ptype`). Стоит над редактором
 * маршрута; тонкая строка, не полоса инструментов.
 */
export function TypeTrail({
  from,
  to,
  onBackToProject,
}: {
  from: ProjectType;
  to: ProcessType;
  onBackToProject: () => void;
}) {
  return (
    <nav
      aria-label={ui.automation.entry.trailAria}
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-4 text-sm"
    >
      <button
        type="button"
        onClick={onBackToProject}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        title={from.name}
      >
        <ProcessTypeGlyph icon={from.icon} className="size-3.5 shrink-0" />
        <span className="truncate">{from.name}</span>
      </button>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 truncate px-1 font-medium" title={to.name}>
        {to.name}
      </span>
    </nav>
  );
}
