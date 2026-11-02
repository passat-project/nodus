import { RotateCcw, Archive } from 'lucide-react';
import type { ProjectType } from '@nodus/contracts';
import { processTypeIconSchema, projectColorSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { CommitInput } from '../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField } from '../../../shared/ui/panel/panel-kit.js';
import { SidePanel } from '../../../shared/ui/panel/side-panel.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';

/**
 * Настройки типа проекта (#556): грамматика панели «Настроек типа» из
 * «Процессов» — название, значок сеткой, цвет свотчами, архив внизу.
 * Политика шифра живёт в шапке рабочей зоны (частая правка). Архив — не
 * удаление: проекты сохраняют ссылку.
 */
export function ProjectTypePanel({
  type,
  open,
  canSetup,
  onClose,
}: {
  type: ProjectType | null;
  open: boolean;
  canSetup: boolean;
  onClose: () => void;
}) {
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();

  if (!type) {
    return (
      <SidePanel open={false} title={ui.projects.schemasTypes} onClose={onClose}>
        {null}
      </SidePanel>
    );
  }

  const archived = type.archivedAt !== null;

  return (
    <SidePanel
      open={open}
      title={ui.projects.schemasTypes}
      leading={
        <span
          aria-hidden
          className={cn(
            'flex size-6 items-center justify-center rounded border',
            identityTone[type.color].tile,
          )}
        >
          <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
        </span>
      }
      onClose={onClose}
    >
      <PanelField label={ui.nodeKinds.panel.name}>
        <CommitInput
          value={type.name}
          required
          disabled={!canSetup}
          onCommit={(name) => update.mutate({ id: type.id, name })}
          className="h-8 text-sm"
        />
      </PanelField>

      <PanelField label={ui.nodeKinds.panel.icon}>
        <div className="grid grid-cols-8 gap-1">
          {processTypeIconSchema.options.map((icon) => (
            <button
              key={icon}
              type="button"
              disabled={!canSetup}
              onClick={() => update.mutate({ id: type.id, icon })}
              aria-pressed={type.icon === icon}
              aria-label={icon}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md border transition-colors',
                type.icon === icon
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground enabled:hover:bg-accent/60',
              )}
            >
              <ProcessTypeGlyph icon={icon} className="size-4" />
            </button>
          ))}
        </div>
      </PanelField>

      <PanelField label={ui.nodeKinds.panel.color}>
        <div className="flex gap-1.5">
          {projectColorSchema.options.map((color) => (
            <button
              key={color}
              type="button"
              disabled={!canSetup}
              onClick={() => update.mutate({ id: type.id, color })}
              aria-label={ui.structure.colorNames[color]}
              title={ui.structure.colorNames[color]}
              aria-pressed={type.color === color}
              className={cn(
                'flex size-7 items-center justify-center rounded-md border transition-colors',
                type.color === color
                  ? 'border-primary'
                  : 'border-transparent enabled:hover:bg-accent',
              )}
            >
              <span aria-hidden className={cn('size-4 rounded-full', identityTone[color].dot)} />
            </button>
          ))}
        </div>
      </PanelField>

      {canSetup ? (
        archived ? (
          <PanelDanger
            icon={RotateCcw}
            onClick={() => archive.mutate({ id: type.id, archived: false })}
          >
            {ui.projects.typesRestore}
          </PanelDanger>
        ) : (
          <PanelDanger
            icon={Archive}
            onClick={() => archive.mutate({ id: type.id, archived: true })}
          >
            {ui.projects.typesArchive}
          </PanelDanger>
        )
      ) : null}
    </SidePanel>
  );
}
