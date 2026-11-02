import { useSearch } from '@tanstack/react-router';

import { FieldDialog } from '../features/automation/components/fields/field-dialog.js';
import { AutomationPage } from '../features/automation/pages/automation-page.js';
import { ProjectSchemasPage } from '../features/projects/pages/project-schemas-page.js';
import { useCustomFieldDefinitions } from '../shared/custom-fields/queries.js';
import { useCanManageFields } from '../shared/custom-fields/use-can-manage-fields.js';

/**
 * Раздел «Автоматизация» — композиция фич на уровне app (cross-feature
 * импорт запрещён, I6): вкладка «Типы проектов» (#52) живёт в фиче
 * projects, остальные вкладки — в automation. Роутер отдаёт один раздел.
 * Слот «Создать атрибут…» панели вида папки (#556) заполняется здесь:
 * окно атрибута области «Папка» — код фичи automation, вызывающий — projects.
 */
export function AutomationRoute() {
  const search = useSearch({ strict: false }) as { tab?: string };
  return search.tab === 'project-schemas' ? <ProjectSchemasRoute /> : <AutomationPage />;
}

function ProjectSchemasRoute() {
  const definitions = useCustomFieldDefinitions();
  const canManage = useCanManageFields();
  return (
    <ProjectSchemasPage
      renderCreateField={(slot) => (
        <FieldDialog
          mode={{ kind: 'create', scope: 'node' }}
          definitions={definitions.data ?? []}
          canManage={canManage}
          onClose={slot.onClose}
          onSaved={slot.onCreated}
        />
      )}
    />
  );
}
