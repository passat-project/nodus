import { useMemo, useState } from 'react';
import type {
  ProcessType,
  ProcessTypeIcon,
  StageColor,
  UpdateProcessTypeBody,
} from '@nodus/contracts';
import { processTypeIconSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useRoles } from '../../../../shared/api/roles.js';
import { stageColorOrder, stageTone } from '../../../../shared/ui/board/stage-tone.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { useUpdateProcessType } from '../../api/automation-api.js';
import {
  accessSummary,
  blocksSummary,
  numberingSummary,
  roleLabelsSummary,
} from '../../lib/type-settings-summary.js';
import { CommitInput, CommitTextarea } from '../../../../shared/ui/panel/commit-field.js';
import { PanelField, SectionLink } from '../../../../shared/ui/panel/panel-kit.js';
import { SidePanel } from '../../../../shared/ui/panel/side-panel.js';
import { TypeAccessSection } from '../editor/panel/type-settings-access.js';
import { TypeBlocksSection, TypeRoleLabelsSection } from '../editor/panel/type-settings-card.js';

type Section = 'root' | 'access' | 'blocks' | 'roles' | 'numbering';

const t = ui.automation.typeSettings;

/**
 * Настройки типа — та же правая панель, что у статуса и кнопки, и та же
 * анатомия (#378 ред. 2): в корне — поля самого типа (название, значок,
 * цвет, описание), дальше строки «›» со сводкой — «Доступ», «Блоки
 * карточки», «Названия ролей» (#432, В6); каждая открывает свой раздел со
 * стрелкой «назад» (и первым Esc). Колбасы до низа нет: в корне — только
 * сводки (вердикт владельца 26.10.2026). Всё сохраняется СРАЗУ
 * (оптимистично); публикации требует только маршрут. Панель монтирована
 * всегда: открытие плавное и в первый раз.
 */
export function TypeSettingsPanel({
  open,
  type,
  readOnly = false,
  onClose,
}: {
  open: boolean;
  type: ProcessType;
  /** Нет права `workflow.manage` — только просмотр. */
  readOnly?: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('root');
  // Каждое открытие и другой тип — с корня; на закрытии раздел остаётся до
  // конца анимации ширины (derive-during-render, без эффекта).
  const [prev, setPrev] = useState({ open, typeId: type.id });
  if (prev.open !== open || prev.typeId !== type.id) {
    setPrev({ open, typeId: type.id });
    if (open) setSection('root');
  }

  const { data: roles } = useRoles();
  const roleName = useMemo(() => {
    const names = new Map((roles ?? []).map((role) => [role.id, role.name]));
    return (id: string) => names.get(id);
  }, [roles]);
  const back = () => setSection('root');
  const task = type.category === 'task';
  // Каталог писем системный (#55, Р4): настройки типа письма — только чтение,
  // включая серию номеров (её правка — #504).
  const locked = !task;
  const canEdit = readOnly || locked;

  return (
    <SidePanel
      open={open}
      title={section === 'root' ? t.title : t.sections[section]}
      onClose={onClose}
      onBack={section === 'root' ? undefined : back}
    >
      {section === 'root' ? (
        <>
          <TypeBasics type={type} readOnly={canEdit} />
          <div className="flex min-w-0 flex-col">
            <SectionLink
              title={t.sections.access}
              summary={accessSummary(type, roleName)}
              onClick={() => setSection('access')}
            />
            {!task ? (
              <SectionLink
                title={t.sections.numbering}
                summary={numberingSummary(type)}
                onClick={() => setSection('numbering')}
              />
            ) : null}
            {task ? (
              <>
                <SectionLink
                  title={t.sections.blocks}
                  summary={blocksSummary(type)}
                  onClick={() => setSection('blocks')}
                />
                <SectionLink
                  title={t.sections.roles}
                  summary={roleLabelsSummary(type)}
                  onClick={() => setSection('roles')}
                />
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {section === 'access' ? <TypeAccessSection type={type} readOnly={canEdit} /> : null}
      {section === 'blocks' ? <TypeBlocksSection type={type} readOnly={canEdit} /> : null}
      {section === 'roles' ? <TypeRoleLabelsSection type={type} readOnly={canEdit} /> : null}
      {section === 'numbering' ? <TypeNumberingSection type={type} /> : null}
    </SidePanel>
  );
}

/** Поля самого типа — первые в панели (название — первое поле, в шапке
 *  не дублируется). Текст сохраняется по уходу фокуса, значок и цвет —
 *  кликом. */
function TypeBasics({ type, readOnly }: { type: ProcessType; readOnly: boolean }) {
  const update = useUpdateProcessType();
  const patch = (body: UpdateProcessTypeBody) => update.mutate({ id: type.id, body });

  return (
    <>
      <PanelField label={ui.automation.fieldName}>
        <CommitInput
          value={type.name}
          required
          maxLength={60}
          readOnly={readOnly}
          aria-label={ui.automation.fieldName}
          onCommit={(name) => patch({ name })}
        />
      </PanelField>

      <PanelField label={ui.automation.fieldIcon}>
        {/* Ячейки — доли ширины, а не size-8: восемь кнопок по 40px с
            зазорами не помещались в колонку панели и наезжали друг на друга. */}
        <div className="grid grid-cols-8 gap-1">
          {processTypeIconSchema.options.map((key: ProcessTypeIcon, index) => (
            <button
              key={key}
              type="button"
              aria-pressed={type.icon === key}
              aria-label={`${ui.automation.fieldIcon} ${index + 1}`}
              disabled={readOnly}
              onClick={() => type.icon !== key && patch({ icon: key })}
              className={cn(
                'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-default',
                type.icon === key
                  ? 'border-ring bg-accent text-foreground'
                  : 'border-border text-muted-foreground enabled:hover:border-input enabled:hover:text-foreground',
              )}
            >
              <ProcessTypeGlyph icon={key} className="size-4" />
            </button>
          ))}
        </div>
      </PanelField>

      <PanelField label={ui.automation.fieldColor}>
        <div className="grid w-fit grid-cols-5 gap-2">
          {stageColorOrder.map((tone: StageColor) => (
            <button
              key={tone}
              type="button"
              aria-pressed={type.color === tone}
              aria-label={ui.tasks.stageColors[tone]}
              title={ui.tasks.stageColors[tone]}
              disabled={readOnly}
              onClick={() => type.color !== tone && patch({ color: tone })}
              className={cn(
                'size-6 rounded-full border-2 transition-colors disabled:cursor-default',
                stageTone[tone].swatch,
                type.color === tone ? 'border-foreground' : 'border-transparent',
              )}
            />
          ))}
        </div>
      </PanelField>

      <PanelField label={ui.automation.fieldDescription}>
        <CommitTextarea
          value={type.description}
          rows={3}
          maxLength={500}
          readOnly={readOnly}
          aria-label={ui.automation.fieldDescription}
          className="resize-none text-sm"
          onCommit={(description) => patch({ description })}
        />
      </PanelField>
    </>
  );
}

/** Раздел «Нумерация» (#55, Р2): формат серии и сброс счётчика — только
 *  чтение до #504; серию выдаёт кнопка маршрута с «Присвоить номер». */
function TypeNumberingSection({ type }: { type: ProcessType }) {
  return (
    <>
      <PanelField label={t.numbering.format}>
        <p className="font-mono text-sm text-secondary-foreground tabular-nums">
          {numberingSummary(type)}
        </p>
      </PanelField>
      <PanelField label={t.numbering.reset}>
        <p className="text-sm text-secondary-foreground">{t.numbering.resetYear}</p>
      </PanelField>
      <p className="text-xs break-words text-muted-foreground">{t.numbering.lead}</p>
      <p className="text-xs break-words text-muted-foreground">{t.numbering.readOnly}</p>
    </>
  );
}
