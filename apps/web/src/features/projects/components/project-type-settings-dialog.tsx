import { Archive, RotateCcw } from 'lucide-react';
import type { ProjectType } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { PanelDanger } from '../../../shared/ui/panel/panel-kit.js';
import { SettingsCompactDialog } from '../../../shared/ui/settings-compact-dialog.js';
import { TypeIdentityFields } from '../../../shared/ui/type-identity-fields.js';
import { PROCESS_TYPE_ICON_OPTIONS } from '../../../shared/workflow/process-type-icon-options.js';
import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';

/**
 * Окно настроек типа проекта (ревизия UI v3, #857) — КОМПАКТНОЕ: из него ушёл
 * раздел «Окно создания» (форма настраивается вкладкой «Форма создания»
 * рамы), осталось одно «Основное» — название, значок, цвет; большая колонка
 * навигации ради одной страницы — лишняя ступень. Открывается шестерёнкой
 * бара и «⋯ → Настройки типа…» строки колонки через общий стор (хост —
 * `TypeSettingsHost` уровня app). Сохранение немедленное; без права
 * `project.setup.manage` — только чтение.
 */
export function ProjectTypeSettingsDialog({
  type,
  canSetup,
  onClose,
  onArchived,
}: {
  type: ProjectType;
  canSetup: boolean;
  onClose: () => void;
  /** Тип ушёл в архив из этого окна: хост закрывает и окно, и карточку типа. */
  onArchived?: () => void;
}) {
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();
  const archived = type.archivedAt !== null;
  const patch = (body: {
    name?: string;
    icon?: ProjectType['icon'];
    color?: ProjectType['color'];
  }) => update.mutate({ id: type.id, ...body });

  return (
    <SettingsCompactDialog
      title={`${ui.common.typeSettings.title.project} · ${type.name}`}
      onClose={onClose}
      danger={
        canSetup ? (
          archived ? (
            <PanelDanger
              icon={RotateCcw}
              onClick={() => archive.mutate({ id: type.id, archived: false })}
            >
              {ui.common.typeSettings.restore}
            </PanelDanger>
          ) : (
            <PanelDanger
              icon={Archive}
              onClick={() =>
                archive.mutate(
                  { id: type.id, archived: true },
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
          name: ui.projects.fieldName,
          icon: ui.nodeKinds.panel.icon,
          color: ui.nodeKinds.panel.color,
        }}
        name={{ value: type.name, onChange: (name) => patch({ name }), disabled: !canSetup }}
        icon={{
          value: type.icon,
          options: PROCESS_TYPE_ICON_OPTIONS,
          onChange: (icon) => patch({ icon }),
          disabled: !canSetup,
        }}
        color={{
          value: type.color,
          options: projectColorSchema.options as readonly ProjectType['color'][],
          swatchOf: (color) => identityTone[color].dot,
          nameOf: (color) => ui.structure.colorNames[color],
          onChange: (color) => patch({ color }),
          disabled: !canSetup,
        }}
      />
    </SettingsCompactDialog>
  );
}
