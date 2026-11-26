import { useNavigate } from '@tanstack/react-router';

import { FieldDialog } from '../features/automation/components/fields/field-dialog.js';
import { ProcessTypeCreateDialog } from '../features/automation/components/types/type-create-dialog.js';
import { AutomationPage } from '../features/automation/pages/automation-page.js';
import { NodeKindCreateDialog } from '../features/projects/node-kinds/components/node-kind-create-dialog.js';
import { NodeKindScreen } from '../features/projects/node-kinds/components/node-kind-screen.js';
import { ProjectTypeCreateDialog } from '../features/projects/components/project-type-create-dialog.js';
import { ProjectTypeWorkspace } from '../features/projects/components/project-type-workspace.js';
import { useArchiveNodeKind } from '../features/projects/node-kinds/api/node-kinds-api.js';
import { useSetProjectTypeArchived } from '../features/projects/api/project-catalog-mutations.js';
import { useCustomFieldDefinitions } from '../shared/custom-fields/queries.js';
import { useCanManageFields } from '../shared/custom-fields/use-can-manage-fields.js';

/**
 * Раздел «Автоматизация» — композиция фич на уровне app (cross-feature
 * импорт запрещён, I6): вкладка «Процессы» — единый вход (#857), её
 * проектные слоты (карточка типа проекта, карточка типа папки, окна
 * создания) заполняются компонентами фичи projects; окно атрибута — фичи
 * automation (прецедент renderCreateField, #556). Левая колонка видна
 * всегда: `?ptype=`, `?type=`, `?ftype=`, `?noproject=1` выбирают, что
 * показать справа, — как выбор беседы в чатах, без полноэкранных режимов.
 */
export function AutomationRoute() {
  const navigate = useNavigate();
  const definitions = useCustomFieldDefinitions();
  const canManage = useCanManageFields();
  const archiveProject = useSetProjectTypeArchived();
  const archiveKind = useArchiveNodeKind();

  const renderCreateField = (slot: { onClose: () => void; onCreated: (id: string) => void }) => (
    <FieldDialog
      mode={{ kind: 'create' }}
      definitions={definitions.data ?? []}
      canManage={canManage}
      onClose={slot.onClose}
      onSaved={slot.onCreated}
      onOpenDefinition={slot.onCreated}
    />
  );

  return (
    <AutomationPage
      renderProjectWorkspace={(slot) => (
        <ProjectTypeWorkspace
          typeId={slot.typeId}
          settingsRequest={slot.settingsRequest}
          onOpenType={slot.onOpenType}
          onOpenKind={slot.onOpenKind}
          renderCreateField={renderCreateField}
          renderProcessTypeCreate={(createSlot) => (
            <ProcessTypeCreateDialog
              defaultBaseTypeId={createSlot.baseId}
              onClose={createSlot.onClose}
              onCreated={createSlot.onCreated}
            />
          )}
        />
      )}
      renderFolderCard={(slot) => (
        <NodeKindScreen
          kindId={slot.kindId}
          backLabel={slot.backLabel}
          settingsRequest={slot.settingsRequest}
          onBack={slot.onBack}
          onOpenProjectType={slot.onOpenProjectType}
          onOpenType={(id) =>
            void navigate({
              to: '/automation',
              search: (prev) => ({ ...prev, type: id, ftype: undefined }),
            })
          }
          renderCreateField={renderCreateField}
          renderProcessTypeCreate={(createSlot) => (
            <ProcessTypeCreateDialog
              defaultBaseTypeId={createSlot.baseId}
              onClose={createSlot.onClose}
              onCreated={createSlot.onCreated}
            />
          )}
          renderProjectTypeCreate={(createSlot) => (
            <ProjectTypeCreateDialog
              defaultBaseTypeId={createSlot.baseId}
              onClose={createSlot.onClose}
              onCreated={createSlot.onCreated}
            />
          )}
        />
      )}
      renderProcessTypeCreate={(slot) => (
        <ProcessTypeCreateDialog
          defaultBaseTypeId={slot.baseId}
          onClose={slot.onClose}
          onCreated={slot.onCreated}
        />
      )}
      renderProjectTypeCreate={(slot) => (
        <ProjectTypeCreateDialog
          defaultBaseTypeId={slot.baseId}
          onClose={slot.onClose}
          onCreated={slot.onCreated}
        />
      )}
      renderKindCreate={(slot) => (
        <NodeKindCreateDialog
          defaultBaseKindId={slot.baseId}
          onClose={slot.onClose}
          onCreated={slot.onCreated}
        />
      )}
      onArchiveProject={(id, archived) => archiveProject.mutate({ id, archived })}
      onArchiveNodeKind={(id, archived) => archiveKind.mutate({ id, archived })}
    />
  );
}
