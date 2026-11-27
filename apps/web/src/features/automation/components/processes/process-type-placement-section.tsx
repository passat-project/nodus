import { useMemo } from 'react';
import type { CreationScope, ProcessType } from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';

import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { OptionPickPopover } from '../../../../shared/ui/option-pick-popover.js';
import { PanelField, SwitchRow } from '../../../../shared/ui/panel/panel-kit.js';

/** Значение триггера «Ограничение по папке» для «не ограничивать» (`folderKindId: null`). */
const ANY_FOLDER = '__any__';

/**
 * Раздел «Место создания» окна настроек типа задачи (ревизия UI v3, #857):
 * тумблер «Можно создавать без проекта» и «Ограничение по папке» — кнопка-
 * триггер с поповером вместо сетки кнопок с рамками. Обе настройки — «где
 * создаётся», вторая сторона живёт во вкладке «Где создаётся» и в списках
 * типов проектов. Сохраняется сразу.
 */
export function ProcessTypePlacementSection({ type }: { type: ProcessType }) {
  const updateScope = useUpdateTypeCreation();
  const { data: kinds } = useNodeKinds();
  const scope = typeConfigOf(type).creation;
  const setScope = (creation: CreationScope) => updateScope.mutate({ typeId: type.id, creation });
  const options = useMemo(() => {
    // Текущий тип папки мог уйти в архив — остаётся в списке, пока его не сменят.
    const current = kinds?.find((kind) => kind.id === scope.folderKindId);
    const alive = (kinds ?? []).filter((kind) => kind.archivedAt === null || kind === current);
    return [
      { value: ANY_FOLDER, label: ui.automation.creationScope.folderKindAny },
      ...alive.map((kind) => ({ value: kind.id, label: kind.name })),
    ];
  }, [kinds, scope.folderKindId]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Одна вертикаль формы: ряд тумблера и триггер «Ограничение по папке» — на всю
          ширину раздела, как поля остальных разделов окна (было 560 и 480
          при разной ширине формы). */}
      <SwitchRow
        title={ui.automation.creationScope.withoutProject}
        checked={scope.withoutProject}
        disabled={updateScope.isPending}
        onChange={(withoutProject) => setScope({ ...scope, withoutProject })}
      />
      <PanelField label={ui.automation.creationScope.folderKind}>
        <OptionPickPopover
          value={scope.folderKindId ?? ANY_FOLDER}
          ariaLabel={ui.automation.creationScope.folderKind}
          options={options}
          disabled={updateScope.isPending}
          onSelect={(value) =>
            setScope({ ...scope, folderKindId: value === ANY_FOLDER ? null : value })
          }
        />
      </PanelField>
    </div>
  );
}
