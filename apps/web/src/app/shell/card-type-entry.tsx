import { Suspense, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { pageLoader } from '../page-loader.js';
import type { TypeCardKind, TypeCardPanel } from './card-type-entries.js';
import type { SourceRect, SliderPanelHandle } from './slider-panel.js';
import { SliderPanel } from './slider-panel.js';

/**
 * Запись карточки типа «Процессов» в стеке (ревизия UI v3, #857) — КАРКАС в
 * стартовом пакете: панель, скелет заголовка и скелет тела. Тяжёлое — редактор
 * маршрута с `@xyflow/react`, панелями и стором — ЛЕНИВЫМ куском
 * (`card-type-entries.tsx`) через канонический `pageLoader` (не `React.lazy`:
 * прогретый код рендерится сразу — почему, написано у загрузчика): хост стека
 * грузится на каждой странице портала, а редактор нужен только разделу
 * «Автоматизация». Кусок предзагружает при входе в раздел `AutomationRoute` —
 * клик по строке списка карточку не ждёт; до загрузки кода (прямая ссылка, F5)
 * запись стоит в том же виде, что и при загрузке данных.
 */

const Title = pageLoader(() =>
  import('./card-type-entries.js').then((m) => ({ default: m.TypeCardTitle })),
);
const Body = pageLoader(() =>
  import('./card-type-entries.js').then((m) => ({ default: m.TypeCardBody })),
);

/** Предзагрузка куска тел карточек типов — зовёт раздел «Автоматизация». */
export function preloadTypeCardEntries(): Promise<void> {
  return Promise.all([Title.preload(), Body.preload()]).then(() => undefined);
}

/** Доступное имя скелета заголовка — родовое имя сущности этого вида. */
const TITLE_FALLBACK: Record<TypeCardKind, string> = {
  'process-type': ui.automation.typeSettings.title,
  'project-type': ui.projects.schemasTabsAria,
};

/** Скелет тела — как у рабочей области типа проекта, пока грузится её список;
 *  типу задачи до готовности маршрута тело пусто. */
function BodySkeleton({ kind }: { kind: TypeCardKind }) {
  if (kind === 'process-type') return null;
  return (
    <div aria-hidden className="flex flex-col gap-2 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-9 w-full max-w-lg" />
    </div>
  );
}

export interface TypeCardEntryProps {
  kind: TypeCardKind;
  id: string;
  source: SourceRect | undefined;
  onClose: () => void;
  /** Карточка спит под верхними (content-visibility, issue #63). */
  dormant: boolean;
  /** Карточка верхняя в стеке. */
  top: boolean;
}

export function TypeCardEntry({ kind, id, source, onClose, dormant, top }: TypeCardEntryProps) {
  // Страж закрытия принадлежит телу (черновик маршрута знает только оно), а
  // панель — каркасу: тело отдаёт стража через стабильную ручку.
  const guardRef = useRef<(() => boolean) | null>(null);
  const panelRef = useRef<SliderPanelHandle>(null);
  const [panel] = useState<TypeCardPanel>(() => ({
    setCloseGuard: (guard) => {
      guardRef.current = guard;
    },
    close: () => panelRef.current?.close(),
  }));
  return (
    <SliderPanel
      ref={panelRef}
      closeGuard={() => guardRef.current?.() ?? true}
      title={
        <Suspense fallback={<Skeleton className="h-4 w-40" aria-label={TITLE_FALLBACK[kind]} />}>
          <Title kind={kind} id={id} top={top} panel={panel} onMissing={onClose} />
        </Suspense>
      }
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <Suspense fallback={<BodySkeleton kind={kind} />}>
        <Body kind={kind} id={id} top={top} panel={panel} onMissing={onClose} />
      </Suspense>
    </SliderPanel>
  );
}
