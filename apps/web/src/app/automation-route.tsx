import { useCallback, useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';

import { FieldDialog } from '../features/automation/components/fields/field-dialog.js';
import { AutomationPage } from '../features/automation/pages/automation-page.js';
import { NodeKindScreen } from '../features/projects/node-kinds/components/node-kind-screen.js';
import { ProjectTypeCreateDialog } from '../features/projects/components/project-type-create-dialog.js';
import { NodeKindCreateDialog } from '../features/projects/node-kinds/components/node-kind-create-dialog.js';
import { ProjectTypeWorkspace } from '../features/projects/components/project-type-workspace.js';
import { useNodeKinds } from '../shared/api/node-kinds.js';
import { useProjectTypes } from '../shared/api/projects-list.js';
import { useAuthStore } from '../shared/auth-store.js';
import { useCustomFieldDefinitions } from '../shared/custom-fields/queries.js';
import { useCanManageFields } from '../shared/custom-fields/use-can-manage-fields.js';
import { useArchiveNodeKind } from '../features/projects/node-kinds/api/node-kinds-api.js';
import { useSetProjectTypeArchived } from '../features/projects/api/project-catalog-mutations.js';

/**
 * Раздел «Автоматизация» — композиция фич на уровне app (cross-feature
 * импорт запрещён, I6): вкладка «Процессы» — единый вход (#857), её
 * проектные слоты (рабочая область типа проекта, окна создания типа
 * проекта и типа папки) заполняются компонентами фичи projects; окно
 * атрибута — фичи automation (прецедент renderCreateField, #556).
 * `?ftype=` открывает экран типа папки на всю рабочую область: колонка
 * скрыта, шапка экрана ведёт «‹» к типу проекта (дорожка) или назад.
 */
export function AutomationRoute() {
  const search = useSearch({ strict: false }) as {
    tab?: string;
    type?: string;
    ptype?: string;
    ftype?: string;
  };
  const navigate = useNavigate();
  const definitions = useCustomFieldDefinitions();
  const canManage = useCanManageFields();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const kindsQuery = useNodeKinds();
  const projectTypesQuery = useProjectTypes(true);
  const kinds = kindsQuery.data ?? [];
  const projectTypes = projectTypesQuery.data ?? [];
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

  // Экран типа папки — только на вкладке «Процессы» и только с правом
  // настройки проектов (иначе глубокая ссылка игнорируется — умолчание).
  const isProcesses =
    search.tab !== 'access' && search.tab !== 'registries' && search.tab !== 'fields';
  const ftypeActive = isProcesses && canSetup && !!search.ftype;
  const kind = ftypeActive ? (kinds.find((entry) => entry.id === search.ftype) ?? null) : null;

  const clearFtype = useCallback(
    () => void navigate({ to: '/automation', search: (prev) => ({ ...prev, ftype: undefined }) }),
    [navigate],
  );
  // Стабильные колбэки: экран типа папки держит эффект отката по их адресу.
  const openProjectType = useCallback(
    (id: string) =>
      void navigate({
        to: '/automation',
        search: (prev) => ({ ...prev, ftype: undefined, ptype: id }),
      }),
    [navigate],
  );

  if (ftypeActive) {
    if (kind) {
      const trailType = search.ptype
        ? (projectTypes.find((type) => type.id === search.ptype && type.archivedAt === null) ??
          null)
        : null;
      return (
        <NodeKindScreen
          kindId={kind.id}
          backLabel={trailType?.name ?? ui.common.back}
          onBack={clearFtype}
          renderCreateField={renderCreateField}
          onOpenProjectType={openProjectType}
        />
      );
    }
    return <KindBackGate loading={kindsQuery.isLoading} onClean={clearFtype} />;
  }

  return (
    <AutomationPage
      renderProjectWorkspace={(slot) => (
        <ProjectTypeWorkspace
          typeId={slot.typeId}
          settingsRequest={slot.settingsRequest}
          onOpenType={slot.onOpenType}
          onOpenKind={slot.onOpenKind}
          renderCreateField={renderCreateField}
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

/** Выбранный тип папки пропал (архив/чужой id) — откат к умолчанию:
 * снимаем `ftype`, пока показываем тихую заглушку загрузки. */
function KindBackGate({ loading, onClean }: { loading: boolean; onClean: () => void }) {
  useEffect(() => {
    if (!loading) onClean();
  }, [loading, onClean]);
  return <div className="p-6 text-sm text-muted-foreground">{ui.common.loading}</div>;
}
