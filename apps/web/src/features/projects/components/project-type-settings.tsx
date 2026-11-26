import { Archive, RotateCcw } from 'lucide-react';
import type { NodeKind, ProjectType, ProjectTypeUpdateBody } from '@nodus/contracts';
import { processTypeIconSchema, projectColorSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { useLiveProcessTypes } from '../../../shared/api/process-types-api.js';
import { CommitInput } from '../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, SectionLink } from '../../../shared/ui/panel/panel-kit.js';
import { SidePanel } from '../../../shared/ui/panel/side-panel.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';
import { kindsSummary, creationSummary } from '../lib/project-type-summary.js';

/**
 * «Настройки типа» проекта (#556, #857) — правая панель рабочей области
 * типа: корень с полями самого типа (название, значок, цвет) и строками-
 * ссылками на отдельные страницы («Что здесь можно создавать», «Какие
 * папки здесь бывают») — глубже одного уровня вложенности панель не
 * растёт (единая модель §5). Окно создания проекта открывается с узла
 * «Создание проекта» на канвасе. Всё сохраняется сразу (оптимистично);
 * архив — внизу, это не удаление.
 */
export function ProjectTypeSettingsPanel({
  type,
  kinds,
  open,
  canSetup,
  onClose,
  onOpenCreation,
  onOpenKinds,
}: {
  type: ProjectType | null;
  kinds: NodeKind[];
  open: boolean;
  /** Право `project.setup.manage` — правка; иначе только просмотр. */
  canSetup: boolean;
  onClose: () => void;
  /** Страница «Что здесь можно создавать» (#665) на всю правую область. */
  onOpenCreation: () => void;
  /** Страница «Какие папки здесь бывают» на всю правую область. */
  onOpenKinds: () => void;
}) {
  if (!type) {
    return (
      <SidePanel open={false} title={ui.projects.schemasTypeSettings} onClose={onClose}>
        {null}
      </SidePanel>
    );
  }

  return (
    <SidePanel
      open={open}
      title={ui.projects.schemasTypeSettings}
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
      <TypeRoot
        type={type}
        kinds={kinds}
        canSetup={canSetup}
        onOpenCreation={onOpenCreation}
        onOpenKinds={onOpenKinds}
      />
    </SidePanel>
  );
}

/** Корень панели: поля элемента, затем разделы строками «›» со сводкой —
 *  «колбасы» до низа нет (вердикт владельца 26.10.2026, #432). */
function TypeRoot({
  type,
  kinds,
  canSetup,
  onOpenCreation,
  onOpenKinds,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  onOpenCreation: () => void;
  onOpenKinds: () => void;
}) {
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const processTypes = [...(tasks.data ?? []), ...(letters.data ?? [])];
  const archived = type.archivedAt !== null;
  const patch = (body: { id: string } & ProjectTypeUpdateBody) => update.mutate(body);

  return (
    <>
      <PanelField label={ui.projects.fieldName}>
        <CommitInput
          value={type.name}
          required
          disabled={!canSetup}
          onCommit={(name) => patch({ id: type.id, name })}
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
              onClick={() => patch({ id: type.id, icon })}
              aria-pressed={type.icon === icon}
              aria-label={icon}
              className={cn(
                'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-default',
                type.icon === icon
                  ? 'border-ring bg-accent text-foreground'
                  : 'border-border text-muted-foreground enabled:hover:border-input enabled:hover:text-foreground',
              )}
            >
              <ProcessTypeGlyph icon={icon} className="size-4" />
            </button>
          ))}
        </div>
      </PanelField>

      <PanelField label={ui.nodeKinds.panel.color}>
        <div className="flex flex-wrap gap-2">
          {projectColorSchema.options.map((color) => (
            <button
              key={color}
              type="button"
              disabled={!canSetup}
              onClick={() => patch({ id: type.id, color })}
              aria-label={ui.structure.colorNames[color]}
              title={ui.structure.colorNames[color]}
              aria-pressed={type.color === color}
              className={cn(
                'size-6 rounded-full border-2 transition-colors disabled:cursor-default',
                identityTone[color].dot,
                type.color === color ? 'border-foreground' : 'border-transparent',
              )}
            />
          ))}
        </div>
      </PanelField>

      <div className="flex min-w-0 flex-col">
        <SectionLink
          title={ui.projects.schemasCreationPage}
          summary={creationSummary(type, processTypes)}
          onClick={onOpenCreation}
        />
        <SectionLink
          title={ui.projects.schemasKinds}
          summary={kindsSummary(type, kinds)}
          onClick={onOpenKinds}
        />
      </div>

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
    </>
  );
}
