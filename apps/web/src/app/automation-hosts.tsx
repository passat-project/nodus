import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Permission } from '@nodus/contracts';

import { useProcessTypes } from '../features/automation/api/automation-api.js';
import { FieldDialog } from '../features/automation/components/fields/field-dialog.js';
import { ProcessTypeSettingsDialog } from '../features/automation/components/processes/process-type-settings-dialog.js';
import { ProcessTypeCreateDialog } from '../features/automation/components/types/type-create-dialog.js';
import { ProjectTypeCreateDialog } from '../features/projects/components/project-type-create-dialog.js';
import { ProjectTypeSettingsDialog } from '../features/projects/components/project-type-settings-dialog.js';
import { ProjectTypeWorkspace } from '../features/projects/components/project-type-workspace.js';
import { NodeKindCreateDialog } from '../features/projects/node-kinds/components/node-kind-create-dialog.js';
import { NodeKindScreen } from '../features/projects/node-kinds/components/node-kind-screen.js';
import { NodeKindSettingsDialog } from '../features/projects/node-kinds/components/node-kind-settings-dialog.js';
import { useNodeKinds } from '../shared/api/node-kinds.js';
import { useProjectTypes } from '../shared/api/projects-list.js';
import { useAuthStore } from '../shared/auth-store.js';
import { useCanManageFields } from '../shared/custom-fields/use-can-manage-fields.js';
import { useCustomFieldDefinitions } from '../shared/custom-fields/queries.js';
import { useTypeSettingsStore, type TypeSettingsTarget } from '../shared/ui/type-settings-store.js';
import { parseCardStack, serializeCardStack } from './shell/card-stack.js';

/** Слот окна создания типа (фича-потребитель не импортирует владельца окна, I6). */
export interface TypeCreateSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}

/** Окна создания типов — код фич-владельцев; слоты заполняются здесь. */
export const renderProcessTypeCreate = (slot: TypeCreateSlot): ReactNode => (
  <ProcessTypeCreateDialog
    defaultBaseTypeId={slot.baseId}
    onClose={slot.onClose}
    onCreated={slot.onCreated}
  />
);
export const renderProjectTypeCreate = (slot: TypeCreateSlot): ReactNode => (
  <ProjectTypeCreateDialog
    defaultBaseTypeId={slot.baseId}
    onClose={slot.onClose}
    onCreated={slot.onCreated}
  />
);
export const renderKindCreate = (slot: TypeCreateSlot): ReactNode => (
  <NodeKindCreateDialog
    defaultBaseKindId={slot.baseId}
    onClose={slot.onClose}
    onCreated={slot.onCreated}
  />
);

/**
 * Слоты окна атрибута (прецедент renderCreateField, #556): окно — код фичи
 * automation, вызывающие — фича projects (I6). «Создать атрибут…» — из
 * редактора окна (вкладка «Форма создания»).
 */
export function useFieldDialogSlots() {
  const definitions = useCustomFieldDefinitions();
  const canManage = useCanManageFields();
  const list = useMemo(() => definitions.data ?? [], [definitions.data]);
  const renderCreateField = useCallback(
    (slot: { onClose: () => void; onCreated: (id: string) => void }) => (
      <FieldDialog
        mode={{ kind: 'create' }}
        definitions={list}
        canManage={canManage}
        onClose={slot.onClose}
        onSaved={slot.onCreated}
        onOpenDefinition={slot.onCreated}
      />
    ),
    [list, canManage],
  );
  return { renderCreateField, canManage };
}

/**
 * Хосты тел карточек типов «Процессов» (ревизия UI v3, #857): ОДНИ слоты для
 * рамы рабочей области (`AutomationRoute`) и для карточек стека
 * (`card-type-entries`, ленивый кусок каркаса `card-type-entry`) — окна создания и окно атрибута открываются и из
 * карточек тоже. Композиция фич — только на уровне app (I6).
 */
export function ProjectTypeWorkspaceHost({ id }: { id: string }) {
  const fields = useFieldDialogSlots();
  return (
    <ProjectTypeWorkspace
      typeId={id}
      renderProcessTypeCreate={renderProjectTypeCreate}
      renderCreateField={fields.renderCreateField}
    />
  );
}

export function NodeKindScreenHost({
  id,
  onMissing,
}: {
  id: string;
  /** Тип папки пропал (архив): рама уходит на поверхность по умолчанию. */
  onMissing: () => void;
}) {
  const fields = useFieldDialogSlots();
  return (
    <NodeKindScreen
      kindId={id}
      onMissing={onMissing}
      renderCreateField={fields.renderCreateField}
      renderProcessTypeCreate={renderProcessTypeCreate}
      renderProjectTypeCreate={renderProjectTypeCreate}
    />
  );
}

/** Убрать карточку сущности из стека (`?cards=`), на каком бы уровне она ни
 *  стояла: после архива типа окно настроек закрывается — карточка тоже. */
function useDropCard(): (target: TypeSettingsTarget) => void {
  const navigate = useNavigate();
  return useCallback(
    (target) => {
      void navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          cards: serializeCardStack(
            parseCardStack(prev.cards).filter(
              (ref) => !(ref.kind === target.kind && ref.id === target.id),
            ),
          ),
        }),
      });
    },
    [navigate],
  );
}

/**
 * Окно настроек типа — резидентный хост ШЕЛЛА (ревизия UI v3): по
 * `{ kind, id }` из `useTypeSettingsStore` рендерит одно из трёх окон (код —
 * фичи automation и projects, I6), беря сущность из тех же списков, что и
 * колонка. Живёт в `app-shell.tsx`, не в маршруте раздела: карточки типов
 * переживают смену раздела (ADR-0009), и настройки обязаны открываться из
 * карточки в любом разделе. Форма создания настраивается вкладкой рамы, окно
 * настроек — только «мелочь» сущности.
 */
export function TypeSettingsHost() {
  const target = useTypeSettingsStore((s) => s.target);
  const dropCard = useDropCard();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);

  const process = useProcessTypes('include');
  const projects = useProjectTypes(true);
  const kinds = useNodeKinds();
  const processType =
    target?.kind === 'process-type'
      ? process.data?.find((entry) => entry.id === target.id)
      : undefined;
  const projectType =
    target?.kind === 'project-type'
      ? projects.data?.find((entry) => entry.id === target.id)
      : undefined;
  const kind =
    target?.kind === 'node-kind' ? kinds.data?.find((entry) => entry.id === target.id) : undefined;
  // Сущность окна пропала, пока оно было открыто (архив из другого окна
  // браузера) — пустого окна не держим.
  const missing =
    target !== null &&
    !processType &&
    !projectType &&
    !kind &&
    !process.isLoading &&
    !projects.isLoading &&
    !kinds.isLoading;
  useEffect(() => {
    if (missing) useTypeSettingsStore.getState().closeSettings();
  }, [missing]);

  const archived = (id: string) => {
    if (!target) return;
    useTypeSettingsStore.getState().closeSettings();
    dropCard({ kind: target.kind, id });
  };
  const close = () => useTypeSettingsStore.getState().closeSettings();

  return (
    <>
      {processType ? (
        <ProcessTypeSettingsDialog
          type={processType}
          onClose={close}
          onArchived={() => archived(processType.id)}
        />
      ) : null}
      {projectType ? (
        <ProjectTypeSettingsDialog
          type={projectType}
          canSetup={canSetup}
          onClose={close}
          onArchived={() => archived(projectType.id)}
        />
      ) : null}
      {kind ? (
        <NodeKindSettingsDialog
          kind={kind}
          canSetup={canSetup}
          onClose={close}
          onArchived={() => archived(kind.id)}
        />
      ) : null}
    </>
  );
}
