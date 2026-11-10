import type { ProjectDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { CustomFieldsBlock } from '../../../shared/custom-fields/custom-fields-block.js';
import { CardDataColumn } from '../../../shared/ui/entity-card/card-data-column.js';
import { EntityFields } from '../../../shared/ui/entity-fields.js';
import { useUpdateProjectCustomField } from '../api/project-member-mutations.js';
import { projectPassportDefs } from '../lib/project-passport.js';

/**
 * Вкладка «О проекте» карточки проекта (вердикт владельца 10.11.2026, #735):
 * обычная вкладка после «Задач», а не статичная левая панель. Витрины-шапки
 * НЕТ: название живёт в хроме карточки и правится кликом (`ProjectTitle`),
 * вся остальная информация — полями-реестром паспорта (статус, видимость,
 * тип, портфель, руководство, крайний срок, состав, создатель, активность) и
 * блоком «Атрибуты» типа проекта (шифр и заказчик — среди них, #631).
 * Действия проекта — в шапке карточки (`ProjectHeaderActions`), не в нижнем
 * баре.
 */
export function ProjectAboutPanel({ project }: { project: ProjectDetail }) {
  const openCard = useOpenCard();
  const updateField = useUpdateProjectCustomField(project.id);

  return (
    <CardDataColumn>
      <NodeLabel label={ui.projects.fieldDescription} />
      <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
        {project.description || <span className="text-muted-foreground">{ui.common.notSet}</span>}
      </p>

      <EntityFields
        defs={projectPassportDefs(project, openCard)}
        storageKey="nodus-project-fields-v2"
      />

      <CustomFieldsBlock
        module="project"
        targetId={project.type?.id ?? undefined}
        values={project.customFields}
        refs={project.customFieldRefs}
        canEdit={project.access.canManage}
        onChange={(fieldId, value, refs) => updateField.mutate({ fieldId, value, refs })}
        host={{ kind: 'project', id: project.id }}
        formulas={project.customFieldFormulas}
      />
    </CardDataColumn>
  );
}
