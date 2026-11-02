import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Permission, ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import { ProjectSchemaCanvas } from '../components/project-schema-canvas.js';
import { ProjectTypeColumn } from '../components/project-type-column.js';
import {
  ProjectTypeSettingsPanel,
  type ProjectTypeSection,
} from '../components/project-type-settings.js';
import { NodeKindPanel } from '../node-kinds/components/node-kind-panel.js';
import type { RenderCreateField } from '../node-kinds/types.js';

/**
 * «Автоматизация → Схемы проектов» (#556 — каркас, #38 — схема/форма/доступ):
 * окно-сплит как «Процессы». Слева — типы проектов с плитками значков, справа
 * канвас выбранного типа (место будущей схемы проекта), правая панель —
 * «Настройки типа»: название, значок, цвет и страницы-разделы поверх панели
 * («Виды папок» — какие виды доступны папкам этого типа, «Шифр проекта»).
 * Портфели сюда не входят: они группируют список проектов и живут в модуле
 * «Проекты» (#559). Глубокие ссылки: `?tab=project-schemas&type=&kind=`.
 */
export function ProjectSchemasPage({
  renderCreateField,
}: {
  /** Слот «Создать атрибут…» панели вида — заполняет `AutomationRoute` (I6). */
  renderCreateField?: RenderCreateField;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { type?: string; kind?: string };
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canCreateField = useCanManageFields();
  const typesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const alive = useMemo(() => types.filter((type) => type.archivedAt === null), [types]);
  const selectedType = useMemo(
    () =>
      types.find((type) => type.id === search.type && type.archivedAt === null) ?? alive[0] ?? null,
    [types, alive, search.type],
  );

  // Одна правая панель за раз: страницы типа (root/kinds/code) и панель вида.
  // Панель принадлежит типу, для которого открыта: архив этого типа её
  // закрывает, чужой тип в неё не подставляется.
  const [typePanel, setTypePanel] = useState<ProjectTypeSection | null>(null);
  const [panelTypeId, setPanelTypeId] = useState<string | null>(null);
  const panelType = useMemo(
    () =>
      panelTypeId
        ? (types.find((type) => type.id === panelTypeId && type.archivedAt === null) ?? null)
        : null,
    [types, panelTypeId],
  );
  // Панель вида, открытая ИЗ настроек типа: «назад» возвращает в «Виды папок».
  const [kindBackToKinds, setKindBackToKinds] = useState(false);
  const kindId = search.kind ?? null;
  const selectedKind = useMemo(
    () => (kindId ? (kinds.find((kind) => kind.id === kindId) ?? null) : null),
    [kinds, kindId],
  );

  const go = (patch: { type?: string; kind?: string | undefined }) =>
    void navigate({
      to: '/automation',
      search: (prev) => ({ ...prev, tab: 'project-schemas', ...patch }),
    });

  const selectType = (id: string) => {
    setTypePanel(null);
    setPanelTypeId(null);
    setKindBackToKinds(false);
    go({ type: id, kind: undefined });
  };

  const openTypePanel = (id: string, section: ProjectTypeSection = 'root') => {
    setPanelTypeId(id);
    setTypePanel(section);
    setKindBackToKinds(false);
    if (kindId) go({ kind: undefined });
  };

  /** Открыть настройки строки типа: выбранный тип — сразу, иначе сначала
   *  выбираем его одной навигацией (две подряд перетёрли бы `type`). */
  const openSettingsOf = (id: string) => {
    if (id !== selectedType?.id) {
      selectType(id);
    } else if (kindId) {
      go({ kind: undefined });
    }
    setPanelTypeId(id);
    setTypePanel('root');
    setKindBackToKinds(false);
  };

  const openKind = (id: string) => {
    setTypePanel(null);
    setKindBackToKinds(true);
    go({ kind: id });
  };

  const closeKind = (backToKinds: boolean) => {
    setKindBackToKinds(false);
    if (kindId) go({ kind: undefined });
    if (backToKinds) setTypePanel('kinds');
  };

  return (
    <div className="@container flex h-full min-h-0">
      <ProjectTypeColumn
        types={types}
        kinds={kinds}
        isLoading={typesQuery.isLoading}
        selectedId={selectedType?.id ?? null}
        canSetup={canSetup}
        onSelect={selectType}
        onOpenSettings={openSettingsOf}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedType ? (
          <ProjectSchemaCanvas
            type={selectedType}
            canSetup={canSetup}
            onOpenSettings={() => openTypePanel(selectedType.id, 'root')}
          />
        ) : typesQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-9 w-full max-w-lg" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            {ui.projects.typesEmpty}
          </div>
        )}
      </main>

      <ProjectTypeSettingsPanel
        type={panelType}
        kinds={kinds}
        open={typePanel !== null && panelType !== null}
        section={typePanel ?? 'root'}
        canSetup={canSetup}
        onSection={setTypePanel}
        onClose={() => {
          setTypePanel(null);
          setPanelTypeId(null);
        }}
        onOpenKind={openKind}
      />

      <NodeKindPanel
        kind={selectedKind}
        canSetup={canSetup}
        canCreateField={canCreateField}
        onClose={() => closeKind(false)}
        onBackToType={kindBackToKinds ? () => closeKind(true) : undefined}
        renderCreateField={renderCreateField}
      />
    </div>
  );
}
