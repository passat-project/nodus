import { Archive, RotateCcw } from 'lucide-react';
import type { NodeKind } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';

import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { NODE_KIND_ICON_KEYS, NodeKindGlyph } from '../../../../shared/ui/node-kind-icon.js';
import { PanelDanger, PanelField } from '../../../../shared/ui/panel/panel-kit.js';
import { SettingsCompactDialog } from '../../../../shared/ui/settings-compact-dialog.js';
import { TypeIdentityFields } from '../../../../shared/ui/type-identity-fields.js';
import { useArchiveNodeKind, useUpdateNodeKind } from '../api/node-kinds-api.js';
import { NodeKindCapabilitiesSection } from './node-kind-capabilities-section.js';

/** Варианты значка типа папки: ключи реестра с русскими именами. */
const ICON_OPTIONS = NODE_KIND_ICON_KEYS.map((icon) => ({
  value: icon,
  label: ui.structure.iconNames[icon],
  title: ui.structure.iconNames[icon],
  glyph: <NodeKindGlyph icon={icon} className="size-4" />,
}));

/**
 * Окно настроек типа папки (ревизия UI v3, #857) — КОМПАКТНОЕ: тип папки —
 * незначимая сущность, большой карточки и окна с разделами ему не нужно
 * (вердикт владельца). Одна колонка: название, значок, цвет, затем
 * «Возможности»; настройки немного, навигация по разделам — лишняя ступень.
 * Сами «Поля и форма» остаются вкладкой рамы. Открывается шестерёнкой бара,
 * строкой и меню «⋯» вкладки «Какие папки здесь бывают» и «⋯ → Настройки
 * типа…» строки колонки через общий стор (хост — `TypeSettingsHost` уровня
 * app). Сохранение немедленное; без права — только чтение.
 */
export function NodeKindSettingsDialog({
  kind,
  canSetup,
  onClose,
  onArchived,
}: {
  kind: NodeKind;
  canSetup: boolean;
  onClose: () => void;
  /** Тип ушёл в архив из этого окна: хост закрывает и окно, и карточку типа. */
  onArchived?: () => void;
}) {
  const update = useUpdateNodeKind();
  const archive = useArchiveNodeKind();
  const archived = kind.archivedAt !== null;

  return (
    <SettingsCompactDialog
      title={`${ui.common.typeSettings.title.folder} · ${kind.name}`}
      onClose={onClose}
      danger={
        canSetup ? (
          archived ? (
            <PanelDanger
              icon={RotateCcw}
              onClick={() => archive.mutate({ id: kind.id, archived: false })}
            >
              {ui.common.typeSettings.restore}
            </PanelDanger>
          ) : (
            <PanelDanger
              icon={Archive}
              onClick={() =>
                archive.mutate(
                  { id: kind.id, archived: true },
                  {
                    onSuccess: () => {
                      onClose();
                      onArchived?.();
                    },
                  },
                )
              }
            >
              {ui.common.typeSettings.archive}
            </PanelDanger>
          )
        ) : undefined
      }
    >
      <TypeIdentityFields
        labels={{
          name: ui.nodeKinds.panel.name,
          icon: ui.nodeKinds.panel.icon,
          color: ui.nodeKinds.panel.color,
        }}
        name={{
          value: kind.name,
          onChange: (name) => update.mutate({ id: kind.id, name }),
          disabled: !canSetup,
        }}
        icon={{
          value: kind.icon,
          options: ICON_OPTIONS,
          onChange: (icon) => update.mutate({ id: kind.id, icon }),
          disabled: !canSetup,
        }}
        color={{
          value: kind.color,
          options: projectColorSchema.options as readonly NodeKind['color'][],
          swatchOf: (color) => identityTone[color].dot,
          nameOf: (color) => ui.structure.colorNames[color],
          onChange: (color) => update.mutate({ id: kind.id, color }),
          disabled: !canSetup,
        }}
      />
      <PanelField label={ui.nodeKinds.panel.settingsSections.capabilities}>
        <NodeKindCapabilitiesSection
          kind={kind}
          canSetup={canSetup}
          onToggle={(capabilities) => update.mutate({ id: kind.id, capabilities })}
        />
      </PanelField>
    </SettingsCompactDialog>
  );
}
