import { useState } from 'react';
import type { ProcessType } from '@nodus/contracts';
import type { LucideIcon } from 'lucide-react';
import { Archive, Contact, Hash, LayoutList, Lock, MapPin, Type as TypeIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { useArchiveProcessType } from '../../api/automation-api.js';
import { numberingSummary } from '../../lib/type-settings-summary.js';
import { PanelDanger, PanelField, PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { SettingsSplitDialog } from '../../../../shared/ui/settings-split-dialog.js';
import { ProcessTypeMainSection } from './process-type-main-section.js';
import { ProcessTypePlacementSection } from './process-type-placement-section.js';
import { TypeAccessSection } from '../editor/panel/type-settings-access.js';
import { TypeBlocksSection, TypeRoleLabelsSection } from '../editor/panel/type-settings-card.js';

type Section = 'main' | 'placement' | 'access' | 'card' | 'roles' | 'numbering';

const SECTIONS: Record<Section, { label: string; icon: LucideIcon }> = {
  main: { label: ui.automation.entry.settingsSectionMain, icon: TypeIcon },
  placement: { label: ui.automation.entry.settingsSectionPlacement, icon: MapPin },
  access: { label: ui.automation.typeSettings.sections.access, icon: Lock },
  card: { label: ui.automation.entry.settingsSectionCard, icon: LayoutList },
  roles: { label: ui.automation.entry.settingsSectionRoles, icon: Contact },
  numbering: { label: ui.automation.typeSettings.sections.numbering, icon: Hash },
};
const TASK_SECTIONS: readonly Section[] = ['main', 'placement', 'access', 'card', 'roles'];
const LETTER_SECTIONS: readonly Section[] = ['main', 'access', 'numbering'];

/**
 * Окно настроек типа процесса (ревизия UI v3, #857): слева разделы, справа —
 * содержимое ОДНОГО активного (каркас `SettingsSplitDialog`, грамматика окна
 * атрибута). «Мелочь» больше не занимает вкладку на весь экран и не идёт
 * простынёй с общим скроллом: имя, значок, цвет, описание, «Место создания»,
 * доступ, блоки карточки, роли, нумерация и архив разложены по
 * разделам; сохранение немедленное. Открывается шестерёнкой бара и «⋯ →
 * Настройки типа…» через общий стор (хост — `TypeSettingsHost` уровня app).
 * У письма (каталог системный, #55) всё — только чтение.
 */
export function ProcessTypeSettingsDialog({
  type,
  onClose,
  onArchived,
}: {
  type: ProcessType;
  onClose: () => void;
  /** Тип ушёл в архив из этого окна: хост закрывает и окно, и карточку типа. */
  onArchived?: () => void;
}) {
  const archive = useArchiveProcessType(true);
  const task = type.category === 'task';
  const locked = !task;
  const sections = task ? TASK_SECTIONS : LETTER_SECTIONS;
  const [active, setActive] = useState<Section>('main');

  return (
    <SettingsSplitDialog
      title={`${ui.common.typeSettings.title[task ? 'task' : 'letter']} · ${type.name}`}
      sectionsLabel={ui.common.sections}
      sections={sections.map((id) => ({ id, ...SECTIONS[id] }))}
      active={active}
      onActivate={(id) => setActive(id as Section)}
      onClose={onClose}
      danger={
        <PanelDanger
          icon={Archive}
          onClick={() =>
            archive.mutate(type.id, {
              onSuccess: () => {
                onClose();
                onArchived?.();
              },
            })
          }
        >
          {ui.common.typeSettings.archive}
        </PanelDanger>
      }
    >
      {active === 'main' ? <ProcessTypeMainSection type={type} readOnly={locked} /> : null}
      {active === 'placement' ? <ProcessTypePlacementSection type={type} /> : null}
      {active === 'access' ? <TypeAccessSection type={type} readOnly={locked} /> : null}
      {active === 'card' ? <TypeBlocksSection type={type} readOnly={locked} /> : null}
      {active === 'roles' ? <TypeRoleLabelsSection type={type} readOnly={locked} /> : null}
      {active === 'numbering' ? (
        <div className="flex min-w-0 flex-col gap-4">
          <PanelField label={ui.automation.typeSettings.numbering.format}>
            <p className="font-mono text-sm text-secondary-foreground tabular-nums">
              {numberingSummary(type)}
            </p>
          </PanelField>
          <PanelNote>{ui.automation.typeSettings.numbering.readOnly}</PanelNote>
        </div>
      ) : null}
    </SettingsSplitDialog>
  );
}
