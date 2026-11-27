import { useEffect, useRef, useState } from 'react';
import type { ProcessType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { ProcessTypeCard } from '../../features/automation/components/processes/process-type-card.js';
import { UnsavedDialog } from '../../features/automation/components/editor/editor-parts.js';
import { useProcessTypes } from '../../features/automation/api/automation-api.js';
import { useRouteDocStore } from '../../features/automation/model/route-doc-store.js';
import { useProjectTypes } from '../../shared/api/projects-list.js';
import { ProjectIdentityIcon } from '../../shared/ui/project-identity-icon.js';
import { useWorkflowDetail } from '../../shared/workflow/workflow-api.js';
import { ProcessTypeGlyph } from '../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../shared/workflow/type-tone.js';
import { ProjectTypeWorkspaceHost, renderProjectTypeCreate } from '../automation-hosts.js';

/**
 * Карточки типов «Процессов» в общем стеке (ревизия UI v3, #857): строка
 * списка вкладки открывает карточку типа ПОВЕРХ рамы — как задача из журнала.
 * Тела — те же хосты `automation-hosts`, что и рама рабочей области, поэтому
 * окна создания и окно атрибута работают и здесь.
 *
 * Файл — ЛЕНИВЫЙ кусок: вместе с телом карточки сюда входит редактор маршрута
 * (`@xyflow/react`, панели, стор), а он нужен только разделу
 * «Автоматизация» — грузить его всем на старте портала нельзя. Каркас записи
 * (панель и скелеты) живёт в стартовом пакете — `card-type-entry.tsx`; он же
 * предзагружает этот кусок при входе в раздел.
 */

/** Вид карточки типа в стеке. */
export type TypeCardKind = 'process-type' | 'project-type';

/** Ручка панели-хозяина (`SliderPanel` каркаса): тело регистрирует стража
 *  закрытия и закрывает панель её хореографией. */
export interface TypeCardPanel {
  /** Страж закрытия (`false` — спросить до схлопывания); `null` — снять. */
  setCloseGuard: (guard: (() => boolean) | null) => void;
  close: () => void;
}

/** Пропсы ленивых частей записи: каркас передаёт их загруженному коду. */
export interface TypeCardPartProps {
  kind: TypeCardKind;
  id: string;
  /** Карточка верхняя в стеке. */
  top: boolean;
  panel: TypeCardPanel;
  /** Сущность пропала (архив) — карточку закрываем. */
  onMissing: () => void;
}

function TypeTitle({
  icon,
  name,
  fallback,
}: {
  icon: React.ReactNode;
  name: string | undefined;
  fallback: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      {name ? (
        <span className="truncate">{name}</span>
      ) : (
        <Skeleton className="h-4 w-40" aria-label={fallback} />
      )}
    </span>
  );
}

/** Заголовок записи — значок и имя типа; пока список грузится — скелет. */
export function TypeCardTitle({ kind, id, onMissing }: TypeCardPartProps) {
  switch (kind) {
    case 'process-type':
      return <ProcessTypeTitle id={id} />;
    case 'project-type':
      return <ProjectTypeTitle id={id} onMissing={onMissing} />;
  }
}

function ProcessTypeTitle({ id }: { id: string }) {
  const { data: types } = useProcessTypes('include');
  const type: ProcessType | undefined = types?.find((entry) => entry.id === id);
  return (
    <TypeTitle
      fallback={ui.automation.typeSettings.title}
      name={type?.name}
      icon={
        type ? (
          <span
            aria-hidden
            className={cn(
              // Шапка карточки — плитка `size-6` с глифом 14px (калибр
              // `ProjectIdentityIcon` «size-6 в шапках»): size-5 с глифом 12px
              // терялась рядом с титулом 18px.
              'flex size-6 shrink-0 items-center justify-center rounded-md border',
              typeToneOf(type.color),
            )}
          >
            <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
          </span>
        ) : null
      }
    />
  );
}

function ProjectTypeTitle({ id, onMissing }: { id: string; onMissing: () => void }) {
  const { data: types, isLoading } = useProjectTypes(true);
  const type = types?.find((entry) => entry.id === id);
  // Типа больше нет (архив из колонки) — карточку закрываем.
  const missing = !type && !isLoading;
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);
  return (
    <TypeTitle
      fallback={ui.projects.schemasTabsAria}
      name={type?.name}
      icon={type ? <ProjectIdentityIcon color={type.color} className="size-6" /> : null}
    />
  );
}

/** Тело записи — то, что стоит в карточке под заголовком. */
export function TypeCardBody(props: TypeCardPartProps) {
  switch (props.kind) {
    case 'process-type':
      return <ProcessTypeBody {...props} />;
    case 'project-type':
      return <ProjectTypeBody id={props.id} />;
  }
}

/**
 * Тип задачи/письма. Правило ОДНОГО редактора маршрута: стор `useRouteDocStore`
 * глобальный, второй смонтированный редактор затирал бы первый — поэтому
 * под верхней карточкой (не верхняя в стеке) панель «Маршрут» держится пустой,
 * как состояние загрузки; черновик при возврате читает `loadedState` из
 * localStorage. Закрытие верхней карточки С ЧЕРНОВИКОМ (X, Esc, клик мимо)
 * спрашивает «Уйти без публикации?» ДО схлопывания — стражем закрытия панели:
 * блокер роутера сюда не годится (панель закрывается раньше навигации и после
 * «Отмена» зависала бы закрытой, но в стеке).
 */
function ProcessTypeBody({ id, top, panel }: TypeCardPartProps) {
  const { data: types } = useProcessTypes('include');
  const type: ProcessType | undefined = types?.find((entry) => entry.id === id);
  const workflow = useWorkflowDetail(type?.workflowId ?? null);
  const dirty = useRouteDocStore((s) => s.dirty);
  const [askLeave, setAskLeave] = useState(false);
  // Согласие на уход: панель закрывается своей хореографией, страж пропускает.
  const leavingRef = useRef(false);
  const closeGuard = (): boolean => {
    if (leavingRef.current || !top || !dirty) return true;
    setAskLeave(true);
    return false;
  };
  // Страж отдаётся каркасу на каждый рендер (зависит от черновика и позиции в
  // стеке), с размонтированием тела — снимается.
  useEffect(() => {
    panel.setCloseGuard(closeGuard);
    return () => panel.setCloseGuard(null);
  });
  return (
    <>
      {type && workflow.data ? (
        <ProcessTypeCard
          type={type}
          workflow={workflow.data}
          suspended={!top}
          // Свой префикс id вкладок: карточка может лежать поверх рамы ТОГО ЖЕ
          // типа — иначе вкладки и панели дублировали бы id.
          idPrefix={`process-type-card-${id}`}
          renderProjectTypeCreate={renderProjectTypeCreate}
        />
      ) : null}
      <UnsavedDialog
        open={askLeave}
        // Черновик остаётся на месте — карточку просто закрывают.
        confirmLabel={ui.common.close}
        onCancel={() => setAskLeave(false)}
        onDiscard={() => {
          leavingRef.current = true;
          setAskLeave(false);
          panel.close();
        }}
      />
    </>
  );
}

function ProjectTypeBody({ id }: { id: string }) {
  return <ProjectTypeWorkspaceHost id={id} />;
}
