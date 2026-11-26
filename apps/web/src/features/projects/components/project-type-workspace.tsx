import { useEffect, useMemo, useState } from 'react';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectSchemaCanvas } from './project-schema-canvas.js';
import { ProjectTypeCreationPage } from './project-type-creation.js';
import { ProjectTypeKindsPage } from './project-type-kinds.js';
import { ProjectTypeSettingsPanel } from './project-type-settings.js';
import { ProjectWindowPanel } from './project-window-panel.js';

type WorkspacePage = 'canvas' | 'creation' | 'kinds';

/**
 * Рабочая область типа проекта (#857, единая модель §5) — правая область
 * вкладки «Процессы»: канвас схемы со стартовым узлом «Создание проекта»,
 * панель «Настройки типа» (корень: название/значок/цвет + строки-ссылки)
 * и ОТДЕЛЬНЫЕ страницы на всю область — «Что здесь можно создавать» (#665)
 * и «Какие папки здесь бывают» (#556): не больше одного уровня
 * вложенности, заголовок страницы возвращает «‹» к холсту. Компонент
 * фичи projects; слоты (окно атрибута) — от `AutomationRoute` (I6).
 */
export function ProjectTypeWorkspace({
  typeId,
  settingsRequest,
  onOpenType,
  onOpenKind,
  renderCreateField,
}: {
  typeId: string;
  /** Счётчик команд «⋯ → Настройки типа» строки проекта в колонке. */
  settingsRequest: number;
  onOpenType: (id: string) => void;
  onOpenKind: (id: string) => void;
  renderCreateField?: RenderCreateField;
}) {
  const typesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canCreateField = useCanManageFields();

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const type = useMemo(
    () => types.find((entry) => entry.id === typeId && entry.archivedAt === null) ?? null,
    [types, typeId],
  );

  const [page, setPage] = useState<WorkspacePage>('canvas');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);
  // Смена типа (выбор другой строки колонки) сбрасывает страницы и панели —
  // derive-render, как смена вида в панели (канон #556).
  const [shownId, setShownId] = useState(typeId);
  if (typeId !== shownId) {
    setShownId(typeId);
    setPage('canvas');
    setSettingsOpen(false);
    setWindowOpen(false);
  }

  // «⋯ → Настройки типа» строки проекта: открыть панель у выбранного типа.
  useEffect(() => {
    if (settingsRequest > 0) setSettingsOpen(true);
  }, [settingsRequest]);

  if (!type) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {typesQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-9 w-full max-w-lg" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyTitle>{ui.projects.typesEmpty}</EmptyTitle>
            </Empty>
          </div>
        )}
      </div>
    );
  }

  if (page === 'creation') {
    return (
      <ProjectTypeCreationPage
        type={type}
        canSetup={canSetup}
        onBack={() => setPage('canvas')}
        onOpenType={onOpenType}
      />
    );
  }

  if (page === 'kinds') {
    return (
      <ProjectTypeKindsPage
        type={type}
        kinds={kinds}
        canSetup={canSetup}
        onBack={() => setPage('canvas')}
        onOpenKind={onOpenKind}
      />
    );
  }

  return (
    <div className="@container flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col">
        <ProjectSchemaCanvas
          type={type}
          canSetup={canSetup}
          selected={windowOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenWindow={() => setWindowOpen(true)}
        />
      </main>

      <ProjectTypeSettingsPanel
        type={type}
        kinds={kinds}
        open={settingsOpen}
        canSetup={canSetup}
        onClose={() => setSettingsOpen(false)}
        onOpenCreation={() => {
          setSettingsOpen(false);
          setPage('creation');
        }}
        onOpenKinds={() => {
          setSettingsOpen(false);
          setPage('kinds');
        }}
      />

      <ProjectWindowPanel
        type={type}
        open={windowOpen}
        canSetup={canSetup}
        canCreateField={canCreateField}
        renderCreateField={renderCreateField}
        onClose={() => setWindowOpen(false)}
      />
    </div>
  );
}
