import { useState } from 'react';
import type { NodeKind, NodeKindIcon } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { CommitInput } from '../../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, SectionLink } from '../../../../shared/ui/panel/panel-kit.js';
import { SidePanel } from '../../../../shared/ui/panel/side-panel.js';
import { useArchiveNodeKind, useUpdateNodeKind } from '../api/node-kinds-api.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindCapabilitiesSection } from './node-kind-capabilities-section.js';
import { NodeKindFormSection } from './node-kind-form-section.js';
import { NODE_KIND_ICON_KEYS, NodeKindGlyph } from '../../structure/lib/node-kind-icon.js';
import { capabilitiesSummary, formSummary } from './node-kind-summary.js';

type Section = 'root' | 'form' | 'capabilities';

/**
 * Панель вида папки (#556, §4c): корень (название, значок, цвет) →
 * раздел «При создании папки» (шифр и атрибуты: скрыто / по желанию /
 * обязательно) → раздел «Возможности» (три переключателя). Разделы
 * заменяются целиком и сохраняются сразу — как конфигурация типа
 * процесса (#432). Без права `project.setup.manage` — только просмотр.
 */
export function NodeKindPanel({
  kind,
  canSetup,
  canCreateField,
  onClose,
  renderCreateField,
}: {
  kind: NodeKind | null;
  canSetup: boolean;
  /** Право `custom_field.manage` — «Создать атрибут…» в форме вида. */
  canCreateField: boolean;
  onClose: () => void;
  renderCreateField?: RenderCreateField;
}) {
  const update = useUpdateNodeKind();
  const archive = useArchiveNodeKind();
  const [section, setSection] = useState<Section>('root');
  const [shownId, setShownId] = useState<string | null>(kind?.id ?? null);
  // Раздел «корень» при каждом открытии другого вида (derive-render).
  if ((kind?.id ?? null) !== shownId) {
    setShownId(kind?.id ?? null);
    setSection('root');
  }

  if (!kind) {
    return (
      <SidePanel open={false} title={ui.nodeKinds.title} onClose={onClose}>
        {null}
      </SidePanel>
    );
  }

  return (
    <SidePanel
      open
      title={section === 'root' ? kind.name : ui.nodeKinds.title}
      onClose={onClose}
      onBack={section === 'root' ? undefined : () => setSection('root')}
    >
      {section === 'root' ? (
        <KindRoot
          kind={kind}
          canSetup={canSetup}
          onName={(name) => update.mutate({ id: kind.id, name })}
          onIcon={(icon) => update.mutate({ id: kind.id, icon })}
          onColor={(color) => update.mutate({ id: kind.id, color })}
          onForm={() => setSection('form')}
          onCapabilities={() => setSection('capabilities')}
          onArchive={() => archive.mutate({ id: kind.id, archived: true })}
          onRestore={() => archive.mutate({ id: kind.id, archived: false })}
        />
      ) : section === 'form' ? (
        <NodeKindFormSection
          kind={kind}
          canSetup={canSetup}
          canCreateField={canCreateField}
          renderCreateField={renderCreateField}
          onSave={(form) => update.mutate({ id: kind.id, form })}
        />
      ) : (
        <NodeKindCapabilitiesSection
          kind={kind}
          canSetup={canSetup}
          onToggle={(capabilities) => update.mutate({ id: kind.id, capabilities })}
        />
      )}
    </SidePanel>
  );
}

function KindRoot({
  kind,
  canSetup,
  onName,
  onIcon,
  onColor,
  onForm,
  onCapabilities,
  onArchive,
  onRestore,
}: {
  kind: NodeKind;
  canSetup: boolean;
  onName: (name: string) => void;
  onIcon: (icon: NodeKindIcon) => void;
  onColor: (color: NodeKind['color']) => void;
  onForm: () => void;
  onCapabilities: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const archived = kind.archivedAt !== null;
  return (
    <>
      <PanelField label={ui.nodeKinds.panel.name}>
        <CommitInput
          value={kind.name}
          required
          disabled={!canSetup}
          onCommit={onName}
          className="h-8 text-sm"
        />
      </PanelField>

      <PanelField label={ui.nodeKinds.panel.icon}>
        <div className="grid grid-cols-7 gap-1">
          {NODE_KIND_ICON_KEYS.map((icon) => (
            <button
              key={icon}
              type="button"
              disabled={!canSetup}
              onClick={() => onIcon(icon)}
              aria-label={ui.structure.iconNames[icon]}
              title={ui.structure.iconNames[icon]}
              aria-pressed={kind.icon === icon}
              className={cn(
                'flex size-8 items-center justify-center rounded-md border transition-colors',
                kind.icon === icon
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground enabled:hover:bg-accent/60',
              )}
            >
              <NodeKindGlyph icon={icon} className="size-4" />
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
              onClick={() => onColor(color)}
              aria-label={ui.structure.colorNames[color]}
              title={ui.structure.colorNames[color]}
              aria-pressed={kind.color === color}
              className={cn(
                'flex size-7 items-center justify-center rounded-md border transition-colors',
                kind.color === color
                  ? 'border-primary'
                  : 'border-transparent enabled:hover:bg-accent',
              )}
            >
              <span aria-hidden className={cn('size-4 rounded-full', identityTone[color].dot)} />
            </button>
          ))}
        </div>
      </PanelField>

      <SectionLink
        title={ui.nodeKinds.panel.formSection}
        summary={formSummary(kind)}
        onClick={onForm}
      />
      <SectionLink
        title={ui.nodeKinds.panel.capabilitiesSection}
        summary={capabilitiesSummary(kind)}
        onClick={onCapabilities}
      />

      {canSetup ? (
        archived ? (
          <PanelDanger onClick={onRestore}>{ui.nodeKinds.panel.restore}</PanelDanger>
        ) : (
          <PanelDanger onClick={onArchive}>{ui.nodeKinds.panel.archive}</PanelDanger>
        )
      ) : null}
    </>
  );
}
