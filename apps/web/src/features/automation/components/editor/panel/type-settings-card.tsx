import type { ProcessType, TaskCardBlock, TaskRoleKey } from '@nodus/contracts';
import { taskCardBlockOrder, taskRoleKeySchema, typeConfigOf, ui } from '@nodus/contracts';

import { useUpdateProcessTypeConfig } from '../../../api/automation-api.js';
import { CommitInput } from '../../../../../shared/ui/panel/commit-field.js';
import { PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';

const t = ui.automation.typeSettings.card;

/**
 * Раздел «Блоки карточки» настроек типа (#432, В6/Р7; переход внутрь из
 * корня): семь тумблеров с пояснением, что именно прячет блок. Состав
 * карточки — представление, не права: скрытый блок просто не рисуется.
 * Сохраняется сразу; раздел `card` уходит целиком (названия ролей — те же).
 */
export function TypeBlocksSection({ type, readOnly }: { type: ProcessType; readOnly: boolean }) {
  const update = useUpdateProcessTypeConfig(type.id);
  const { hiddenBlocks, roleLabels } = typeConfigOf(type).card;

  const toggleBlock = (block: TaskCardBlock, visible: boolean) =>
    update.mutate({
      card: {
        hiddenBlocks: visible
          ? hiddenBlocks.filter((entry) => entry !== block)
          : [...hiddenBlocks, block],
        roleLabels,
      },
    });

  return (
    <>
      <p className="text-sm break-words text-muted-foreground">{t.blocksLead}</p>
      <div className="flex min-w-0 flex-col gap-3.5">
        {taskCardBlockOrder.map((block) => (
          <SwitchRow
            key={block}
            title={t.blocksNames[block]}
            hint={t.blocksHints[block]}
            checked={!hiddenBlocks.includes(block)}
            disabled={readOnly}
            onChange={(visible) => toggleBlock(block, visible)}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Раздел «Названия ролей» (#432, В3/Р3): своё название роли в карточке и
 * окне создания задач типа («Постановщик» → «Заявитель»). Пусто —
 * стандартное (подсказка в поле). Сохраняется по уходу фокуса или Enter,
 * а не на каждую букву.
 */
export function TypeRoleLabelsSection({
  type,
  readOnly,
}: {
  type: ProcessType;
  readOnly: boolean;
}) {
  const update = useUpdateProcessTypeConfig(type.id);
  const { hiddenBlocks, roleLabels } = typeConfigOf(type).card;

  const setRoleLabel = (role: TaskRoleKey, value: string) => {
    const next = { ...roleLabels };
    if (value) next[role] = value;
    else delete next[role];
    update.mutate({ card: { hiddenBlocks, roleLabels: next } });
  };

  return (
    <>
      <p className="text-sm break-words text-muted-foreground">{t.rolesLead}</p>
      {taskRoleKeySchema.options.map((role) => (
        <PanelField key={role} label={t.roles[role]}>
          <CommitInput
            value={roleLabels[role] ?? ''}
            maxLength={40}
            readOnly={readOnly}
            placeholder={t.roles[role]}
            aria-label={t.roles[role]}
            onCommit={(value) => setRoleLabel(role, value)}
          />
        </PanelField>
      ))}
    </>
  );
}
