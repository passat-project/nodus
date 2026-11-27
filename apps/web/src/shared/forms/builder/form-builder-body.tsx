import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { BuilderCanvas } from './builder-canvas.js';
import type { FormBuilderHost } from './builder-host.js';
import type { BuilderValue } from './builder-model.js';
import { BuilderAlsoLocks, BuilderTray } from './builder-side.js';

const b = ui.forms.builder;

/**
 * Тело редактора окна ввода (#496, В8): лист в натуральную величину с ручками
 * и «+» между строками, лоток полей «Добавить в окно» и «Закрепить также» —
 * без оболочки. Оболочка решает, куда идут правки: окно (редактор окна
 * перехода) держит черновик до «Готово», вкладка «Форма создания» сущности
 * (#857, единая модель «Процессов») пишет сразу. Без права — только просмотр.
 */
export function FormBuilderBody<X>({
  host,
  value,
  onChange,
  readOnly,
  focusKey,
}: {
  host: FormBuilderHost<X>;
  value: BuilderValue<X>;
  onChange: (next: BuilderValue<X>) => void;
  readOnly: boolean;
  /** Ключ поля, чьи настройки открыть сразу (пришли из проблемы). */
  focusKey?: string | null;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {/* Лист — поверхность НАСТОЯЩЕГО окна (`bg-popover` с кольцом), каким его
          увидит сотрудник. Не `bg-background`: в тёмной теме лист оказывался
          на две ступени темнее окна («супер чёрный», вердикт владельца).
          Отступы симметричные (30px): лист читается окном, а не подложкой
          вкладки; ручка перетаскивания (`-left-6` у строки) живёт в левом
          жёлобе, не сдвигая поля. Ширина ограничена `max-w-2xl` — самое
          широкое настоящее окно (`max-w-2xl` в `task-create-window`): на
          широкой раме лист не раздувается шире окна, которое показывает
          сотруднику. */}
      <div className="flex w-full max-w-2xl min-w-0 flex-col gap-3 rounded-xl bg-popover p-6 ring-1 ring-foreground/10">
        {host.fixedTop}
        <BuilderCanvas
          value={value}
          host={host}
          readOnly={readOnly}
          focusKey={focusKey}
          onChange={onChange}
        />
        {host.footer}
      </div>
      {readOnly ? null : <BuilderTray value={value} host={host} onChange={onChange} />}
      {host.lockMode ? (
        <BuilderAlsoLocks value={value} host={host} readOnly={readOnly} onChange={onChange} />
      ) : null}
    </div>
  );
}

/** Строка-подводка редактора: название окна и одна строка состояния под ним. */
export function BuilderLead({ title, note }: { title: string; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-base font-semibold">{title}</span>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** Подводка редактора по его состоянию: просмотр, несохранённое, обычная. */
export function builderLeadNote({ readOnly, unsaved }: { readOnly: boolean; unsaved?: boolean }) {
  return readOnly ? b.readOnly : unsaved ? b.unsaved : b.lead;
}

/** Лист, пока грузятся определения атрибутов: без него поля на миг читались
 *  бы как «Атрибут удалён» (хост не знает их названий). */
export function FormBuilderSkeleton() {
  return (
    <div aria-busy className="w-full min-w-0">
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/**
 * Вкладка «Форма создания» в раме сущности: содержимое одной колонкой
 * `max-w-3xl` от левого края с отступом рамы, компоновка вертикальная — как в
 * окне. Сверху — строка-подводка и, если нужно, тихая заметка.
 */
export function FormTabLayout({
  lead,
  notice,
  children,
}: {
  lead: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">
      <div className="flex w-full min-w-0 max-w-2xl flex-col gap-4">
        {lead}
        {notice}
        {children}
      </div>
    </div>
  );
}
