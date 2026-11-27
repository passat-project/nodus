import { useMemo, useState, type ReactNode } from 'react';
import type { ProcessType, WorkflowDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { FilePenLine, MapPin, Workflow } from 'lucide-react';

import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import type { CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import {
  FrameSettingsButton,
  TypeCardFrame,
  TypeCardPanel,
} from '../../../../shared/ui/type-card-frame.js';
import { CreationFormTab } from '../editor/creation-form-tab.js';
import { RouteEditor } from '../editor/route-editor.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { creationUsageText } from './unified-meta.js';
import { ProcessTypeCreationTab } from './process-type-creation-tab.js';

type ProcessTab = 'route' | 'form' | 'creation';

/** Окно создания типа проекта (слот уровня app, I6). */
export interface ProcessTypeCreateSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}

/**
 * Карточка типа процесса (задачи или письма; #857, ревизия UI v3): ОДНА
 * рама для всех сущностей — и в рабочей области, и в карточке стека. Вкладки
 * — только большие поверхности: «Маршрут» (редактор схемы), «Форма
 * создания» (редактор окна целиком) и «Где создаётся». Бар — грамматика
 * «слова добавлять, справа завершать»: инструменты редактора («Добавить
 * статус», «Добавить переход») — сразу за вкладками и только на «Маршруте»,
 * справа — чип проблем, шестерёнка настроек и «Опубликовать» крайней
 * кнопкой; второй хост-див на каждое место бара. «Мелочь» типа — имя, значок,
 * цвет, доступ, блоки, роли, нумерация, архив — в окне настроек общего стора
 * (открывают шестерёнка и «⋯ → Настройки типа…»).
 *
 * «Маршрут» и «Форма создания» — один редактор с одним черновиком (стор
 * глобальный): узел «Создание» на холсте и проблема формы в чипе ведут на
 * вкладку формы. `suspended` — правило одного редактора: под верхней карточкой
 * стека обе панели держатся пустыми, как состояние загрузки; черновик не
 * теряется — при возврате `loadedState` читает его из localStorage.
 */
export function ProcessTypeCard({
  type,
  workflow,
  suspended = false,
  idPrefix,
  renderProjectTypeCreate,
}: {
  type: ProcessType;
  /** Нет — маршрут ещё грузится: панели пустые, как при `suspended`. Такую
   *  раму показывает только карточка стека; в рабочей области рама ждёт
   *  маршрута (`ProcessesScreen`). */
  workflow?: WorkflowDetail;
  /** Редактор не монтируется: в раме — когда в стеке есть карточка типа
   *  процесса, в карточке — пока она не верхняя. */
  suspended?: boolean;
  /** Префикс id вкладок; у карточки стека свой, чтобы не дублировать раму. */
  idPrefix?: string;
  renderProjectTypeCreate?: (slot: ProcessTypeCreateSlot) => ReactNode;
}) {
  const { data: projectTypes } = useProjectTypes();
  const aliveProjects = useMemo(
    () => (projectTypes ?? []).filter((project) => project.archivedAt === null),
    [projectTypes],
  );
  const usage = creationUsageText(type, aliveProjects);
  const locked = type.category !== 'task';
  const canManage = useCanManageWorkflows();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  // Два места единого бара: состояние, главная кнопка; инструменты — только
  // на «Маршруте».
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  const [primaryHost, setPrimaryHost] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState<ProcessTab>('route');
  /** Поле формы, чьи настройки открыть на вкладке (пришли из проблемы публикации). */
  const [focusField, setFocusField] = useState<string | null>(null);
  const [shownId, setShownId] = useState(type.id);
  if (type.id !== shownId) {
    setShownId(type.id);
    setTab('route');
    setFocusField(null);
  }

  /** Вкладка формы пишет в тот же стор, что и холст. Уходя с холста и стоя на
   *  форме, снимаем выделение узла — иначе правая панель открылась бы сама при
   *  возврате на «Маршрут». */
  const activate = (id: string) => {
    if (id === 'form' || tab === 'form') useRouteDocStore.getState().select(null);
    setFocusField(null);
    setTab(id as ProcessTab);
  };
  /** Узел «Создание» и проблемы формы ведут на вкладку «Форма создания». */
  const openForm = (field?: string) => {
    useRouteDocStore.getState().select(null);
    setFocusField(field ?? null);
    setTab('form');
  };

  const prefix = idPrefix ?? `process-type-${type.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'route',
      label: ui.automation.typeSettings.tabRoute,
      icon: <Workflow className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'form',
      label: ui.automation.entry.formTab,
      icon: <FilePenLine className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'creation',
      label: ui.automation.typeSettings.sections.creation,
      icon: <MapPin className="size-3.5" strokeWidth={1.75} />,
    },
  ];
  // На «Маршруте» и на «Форме создания» работает один и тот же редактор.
  const editorShown = (tab === 'route' || tab === 'form') && !suspended;
  // Места бара — только при смонтированном редакторе: пока маршрут грузится,
  // бар без пустых промежутков, кнопки появляются вместе с графом.
  const editorMounted = editorShown && workflow !== undefined;

  return (
    <TypeCardFrame
      meta={
        locked ? (
          <span className="flex min-w-0 items-center gap-2">
            {usage ? <span className="truncate">{usage}</span> : null}
            <NodeChip tone="muted" className="shrink-0">
              {ui.automation.readOnly}
            </NodeChip>
          </span>
        ) : (
          (usage ?? undefined)
        )
      }
      tools={
        editorMounted && tab === 'route' ? (
          <div ref={setToolsHost} className="flex items-center gap-0.5" />
        ) : undefined
      }
      status={editorMounted ? <div ref={setStatusHost} className="flex items-center" /> : undefined}
      primaryAction={
        editorMounted ? <div ref={setPrimaryHost} className="flex items-center" /> : undefined
      }
      settingsAction={
        <FrameSettingsButton
          label={ui.automation.menuSettingsType}
          onClick={() => openSettings({ kind: 'process-type', id: type.id })}
        />
      }
      tabs={tabs}
      activeTab={tab}
      onActivateTab={activate}
      idPrefix={prefix}
      tabsLabel={ui.automation.entry.typeTabsAria}
    >
      {tab === 'route' || tab === 'form' ? (
        <TypeCardPanel idPrefix={prefix} tab={tab}>
          {editorShown && workflow ? (
            <RouteEditor
              type={type}
              workflow={workflow}
              // Чип проблем и «Опубликовать» общие у обеих вкладок.
              barHosts={{
                tools: tab === 'route' ? toolsHost : null,
                status: statusHost,
                primary: primaryHost,
              }}
              onOpenForm={openForm}
              form={
                tab === 'form' ? (
                  <CreationFormTab
                    type={type}
                    readOnly={!canManage || locked}
                    focusKey={focusField}
                  />
                ) : undefined
              }
            />
          ) : null}
        </TypeCardPanel>
      ) : null}

      {tab === 'creation' ? (
        <TypeCardPanel idPrefix={prefix} tab="creation">
          <ProcessTypeCreationTab
            type={type}
            canSave={canManage && !locked}
            renderProjectTypeCreate={renderProjectTypeCreate}
          />
        </TypeCardPanel>
      ) : null}
    </TypeCardFrame>
  );
}
