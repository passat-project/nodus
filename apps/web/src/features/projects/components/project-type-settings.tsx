import { Archive, RotateCcw } from 'lucide-react';
import type { NodeKind, ProjectType, ProjectTypeUpdateBody } from '@nodus/contracts';
import { processTypeIconSchema, projectColorSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { CommitInput } from '../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, SectionLink } from '../../../shared/ui/panel/panel-kit.js';
import { SidePanel } from '../../../shared/ui/panel/side-panel.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';
import { fieldsSummary, kindsSummary } from '../lib/project-type-summary.js';
import { ProjectTypeFieldsSection } from './project-type-fields.js';
import { ProjectTypeKindsSection } from './project-type-kinds.js';

/** Разделы панели типа: корень и страницы поверх него (как «Настройки
 *  типа» в «Процессах» — раздел заменяет содержимое, «назад» в шапке). */
export type ProjectTypeSection = 'root' | 'kinds' | 'fields';

/**
 * Настройки типа проекта (#556) — правая панель окна-сплита и та же
 * анатомия, что у настроек типа процесса (#432): в корне — поля самого типа
 * (название, значок, цвет), дальше строки «›» со сводкой — «Виды папок» и
 * «Атрибуты»; каждая открывает свой раздел со стрелкой «назад» и первым
 * Esc. Атрибуты — слоты формы типа (Р10 #631): политика шифра стала обычным
 * слотом «Шифр». Всё сохраняется сразу (оптимистично); архив — внизу, это
 * не удаление.
 */
export function ProjectTypeSettingsPanel({
  type,
  kinds,
  open,
  section,
  canSetup,
  onSection,
  onClose,
  onOpenKind,
}: {
  type: ProjectType | null;
  kinds: NodeKind[];
  open: boolean;
  section: ProjectTypeSection;
  /** Право `project.setup.manage` — правка; иначе только просмотр. */
  canSetup: boolean;
  onSection: (section: ProjectTypeSection) => void;
  onClose: () => void;
  onOpenKind: (id: string) => void;
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
      title={
        section === 'root'
          ? ui.projects.schemasTypeSettings
          : section === 'kinds'
            ? ui.projects.schemasKinds
            : ui.customFields.block.title
      }
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
      onBack={section === 'root' ? undefined : () => onSection('root')}
    >
      {section === 'root' ? (
        <TypeRoot type={type} kinds={kinds} canSetup={canSetup} onSection={onSection} />
      ) : section === 'kinds' ? (
        <ProjectTypeKindsSection
          type={type}
          kinds={kinds}
          canSetup={canSetup}
          onOpenKind={onOpenKind}
        />
      ) : (
        <ProjectTypeFieldsSection type={type} canSetup={canSetup} />
      )}
    </SidePanel>
  );
}

/** Корень панели: поля элемента, затем разделы строками «›» со сводкой —
 *  «колбасы» до низа нет (вердикт владельца 26.10.2026, #432). */
function TypeRoot({
  type,
  kinds,
  canSetup,
  onSection,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  onSection: (section: ProjectTypeSection) => void;
}) {
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();
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
          title={ui.projects.schemasKinds}
          summary={kindsSummary(type, kinds)}
          onClick={() => onSection('kinds')}
        />
        <SectionLink
          title={ui.customFields.block.title}
          summary={fieldsSummary(type)}
          onClick={() => onSection('fields')}
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
