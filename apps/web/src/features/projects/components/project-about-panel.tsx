import type { CustomFieldValue, ProjectDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { CustomFieldsBlock } from '../../../shared/custom-fields/custom-fields-block.js';
import { CardDataColumn } from '../../../shared/ui/entity-card/card-data-column.js';
import { EntityFields } from '../../../shared/ui/entity-fields.js';
import { useUpdateProjectCustomField } from '../api/project-member-mutations.js';
import { projectPassportDefs } from '../lib/project-passport.js';

/**
 * ЛЕВАЯ панель карточки проекта — «О проекте» (вердикты владельца 07.11.2026:
 * главная панель без вкладки, рабочая зона — справа). Витрины-шапки НЕТ:
 * название живёт в хроме карточки и правится кликом (`ProjectTitle`), вся
 * остальная информация — полями-реестром паспорта (статус, видимость, шифр,
 * тип, портфель, руководство, заказчик, крайний срок, состав, создатель,
 * активность) и блоком «Атрибуты» области `project`. Действия проекта —
 * в нижнем баре панели (`ProjectActionBar`), как в задачах и письмах.
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
        scope="project"
        values={project.customFields}
        refs={project.customFieldRefs}
        canEdit={project.access.canManage}
        onChange={(fieldId, value: CustomFieldValue | null) =>
          updateField.mutate({ fieldId, value })
        }
      />
    </CardDataColumn>
  );
}
