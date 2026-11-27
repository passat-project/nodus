import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { BuilderCanvas } from './builder-canvas.js';
import type { FormBuilderHost } from './builder-host.js';
import type { BuilderValue } from './builder-model.js';
import { BuilderAlsoLocks } from './builder-locks.js';
import { BuilderTray } from './builder-side.js';

const b = ui.forms.builder;

/**
 * Лист окна в натуральную величину — поверхность НАСТОЯЩЕГО окна
 * (`bg-popover` с кольцом), каким его увидит сотрудник. Не `bg-background`:
 * в тёмной теме лист оказывался на две ступени темнее окна («супер чёрный»,
 * вердикт владельца). Ширина ограничена `max-w-2xl` — самое широкое
 * настоящее окно: на широкой раме лист не раздувается шире окна, которое
 * показывает сотруднику.
 *
 * `fill` — вкладка «Форма создания» (ревизия 27.11): лист занимает остаток
 * высоты вкладки и сам не прокручивается — прокручивается только его
 * содержимое под неподвижным верхом («Название», «Тип»). Без `fill` — лист
 * по содержимому, как в окне перехода.
 */
export function BuilderSheet<X>({
  host,
  value,
  onChange,
  readOnly,
  focusKey,
  fill = false,
}: {
  host: FormBuilderHost<X>;
  value: BuilderValue<X>;
  onChange: (next: BuilderValue<X>) => void;
  readOnly: boolean;
  focusKey?: string | null;
  fill?: boolean;
}) {
  const canvas = (
    <BuilderCanvas
      value={value}
      host={host}
      readOnly={readOnly}
      focusKey={focusKey}
      onChange={onChange}
    />
  );
  if (fill) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10">
        <div className="shrink-0 px-6 pt-6">{host.fixedTop}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6">
          {canvas}
          {host.footer}
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-2xl min-w-0 flex-col gap-3 rounded-xl bg-popover p-6 ring-1 ring-foreground/10">
      {host.fixedTop}
      {canvas}
      {host.footer}
    </div>
  );
}

/**
 * Тело редактора окна ввода в окне перехода (#496, В8): лист, лоток полей
 * «Добавить в окно» и «Закрепить также» — без оболочки. Окно перехода
 * держит черновик до «Готово»; вкладка «Форма создания» рисует тот же лист
 * через `BuilderSheet` и `BuilderRail`, без черновика (правки — сразу в
 * документ).
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
      <BuilderSheet
        host={host}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        focusKey={focusKey}
      />
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
    <div aria-busy className="mx-auto w-full min-w-0 max-w-2xl">
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/**
 * Каркас вкладки «Форма создания» (ревизия 27.11, замечание владельца):
 * ДВЕ панели на всю высоту вкладки, сама вкладка не прокручивается. Слева
 * (`rail`) — палитра полей и «Закрепить также» со своей прокруткой; за
 * кнопками не нужно никуда лезть. По центру — подводка и лист окна: лист
 * заполняет остаток высоты и центрирован по ширине, прокручивается только
 * его содержимое. Узкая рама (меньше 40rem содержимого — колонка списка и
 * карточка стека на 1280) переходит в две ступени: палитра сверху со своей
 * прокруткой, лист под ней — форма не сжимается в полоску.
 */
export function FormTabLayout({
  lead,
  notice,
  rail,
  children,
}: {
  lead: ReactNode;
  notice?: ReactNode;
  /** Левая колонка; `null` — панели нет (просмотр без палитры). */
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    // @container — на внешней обёртке, адаптив — на ВНУТРЕННЕЙ: правила
    // контейнерного запроса действуют только на потомков, на самом элементе
    // с `@container` они мертвы (gotcha #497).
    <div className="@container/form flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @min-[40rem]/form:flex-row">
        {rail ? (
          <aside className="flex max-h-[38%] w-full shrink-0 flex-col overflow-y-auto border-b border-border/60 px-6 py-3 @min-[40rem]/form:max-h-none @min-[40rem]/form:w-64 @min-[40rem]/form:border-r @min-[40rem]/form:border-b-0 @min-[40rem]/form:py-4 @min-[40rem]/form:pr-4 @min-[40rem]/form:pl-6 @min-[80rem]/form:w-72">
            {rail}
          </aside>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-4 pb-6">
          <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-2">
            {lead}
            {notice}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
