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
 * обычная вкладка после «Задач», не статичная левая панель. Контент — на
 * общей колонке данных карточек (`CardDataColumn`): равные отступы от краёв,
 * центрирование и аккуратное расширение при растягивании области, как в
 * карточке задачи; на широкой области паспорт и «Атрибуты» раскрываются в
 * две колонки по @container. Действия проекта — в шапке карточки.
 */
export function ProjectAboutPanel({ project }: { project: ProjectDetail }) {
  const openCard = useOpenCard();
  const updateField = useUpdateProjectCustomField(project.id);

  return (
    <CardDataColumn className="@container">
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
