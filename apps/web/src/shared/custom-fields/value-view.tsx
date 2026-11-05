import { Copy, ExternalLink } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldRefKind,
  CustomFieldValue,
} from '@nodus/contracts';
import { linkKindOf, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { openCardViaBridge } from '../lib/card-bridge.js';
import { stageTone } from '../ui/board/stage-tone.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import {
  formatDuration,
  formatIsoDate,
  formatIsoDateTime,
  formatMoney,
  formatNumber,
} from './value-format.js';

/** Карта ссылок детали по id (Р6): имя, аватар, архив. */
export function refsById(refs: readonly CustomFieldRef[]): ReadonlyMap<string, CustomFieldRef> {
  return new Map(refs.map((ref) => [ref.id, ref]));
}

/** Ссылка открывает карточку записи (стек карточек, ADR-0009): задача,
 *  письмо, проект, контрагент. Папки карточки не имеют — имя без перехода. */
const OPENABLE_KINDS = new Set<CustomFieldRefKind>(['task', 'letter', 'project', 'counterparty']);

function RefName({
  refs,
  id,
  withAvatar,
  wrap = false,
  interactive = true,
}: {
  refs: ReadonlyMap<string, CustomFieldRef>;
  id: string;
  withAvatar: boolean;
  /** Имя переносится по словам (строка значения в узкой панели), а не
   *  обрезается многоточием. */
  wrap?: boolean;
  /** false — без перехода к записи (значение внутри триггера редактора:
   *  кнопка в кнопке запрещена, React DOM nesting). */
  interactive?: boolean;
}) {
  const ref = refs.get(id);
  if (!ref || ref.name === null) {
    return <span className="text-muted-foreground">{ui.customFields.block.unavailable}</span>;
  }
  const openable = interactive && !ref.archived && OPENABLE_KINDS.has(ref.kind);
  const name = (
    <span className={wrap ? 'min-w-0 break-words' : 'truncate'} title={ref.name}>
      {ref.name}
    </span>
  );
  if (openable) {
    return (
      <button
        type="button"
        onClick={() => openCardViaBridge({ kind: ref.kind, id: ref.id })}
        className={cn(
          'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded text-left underline-offset-2 hover:underline',
          ref.archived && 'opacity-60',
        )}
      >
        {name}
      </button>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5',
        ref.archived && 'opacity-60',
      )}
    >
      {withAvatar ? (
        <PersonAvatar name={ref.name} avatarUrl={ref.avatarUrl} className="size-5" />
      ) : null}
      {/* max-w-full у обёртки + title: длинное имя справочника («ОВ — Отопление,
          вентиляция и кондиционирование воздуха») не уезжает под край узкой
          панели: переносится по словам либо обрезается многоточием (#556). */}
      {name}
    </span>
  );
}

/** Чип варианта списка с цветом темы (Р6 #631): тон из `color` элемента
 *  справочника; без цвета — нейтральная строка как раньше. */
function EnumChip({ ref: item, wrap }: { ref: CustomFieldRef; wrap: boolean }) {
  const tone = item.color ?? null;
  if (!tone) {
    return (
      <span
        className={cn('inline-flex min-w-0 max-w-full items-center', item.archived && 'opacity-60')}
      >
        <span className={wrap ? 'min-w-0 break-words' : 'truncate'} title={item.name ?? undefined}>
          {item.name}
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs',
        stageTone[tone].chip,
        item.archived && 'opacity-60',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', stageTone[tone].dot)} aria-hidden />
      <span className={wrap ? 'min-w-0 break-words' : 'truncate'} title={item.name ?? undefined}>
        {item.name}
      </span>
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  return (
    <button
      type="button"
      aria-label={ui.customFields.value.copyPath}
      title={ui.customFields.value.copyPath}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(
          () => toast.success(ui.customFields.value.pathCopied),
          () => toast.error(ui.common.copyError),
        );
      }}
      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover/field:opacity-100 focus-visible:opacity-100 hover:text-foreground"
    >
      <Copy className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/**
 * Значение кастомного поля в карточке, превью и (compact) строке списка.
 * Ссылки (сотрудник, подразделение, вариант, проект, контрагент) показываются
 * именем из `refs`; недоступная запись — «Запись недоступна» (Р6).
 * URL открывается текстом в новой вкладке (noopener), путь копируется (Р11).
 */
export function CustomFieldValueView({
  definition,
  value,
  refs,
  compact = false,
  interactive = true,
  wrap = false,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  refs: ReadonlyMap<string, CustomFieldRef>;
  compact?: boolean;
  /** false — без ссылки и кнопки копирования: значение внутри триггера
   *  редактора (кнопка в кнопке запрещена, React DOM nesting). */
  interactive?: boolean;
  /** Имена ссылок переносятся по словам (не обрезаются) — строка значения в
   *  узкой правой панели. */
  wrap?: boolean;
}) {
  const empty = value === undefined || value === null;
  if (empty) return <span className="text-muted-foreground">{ui.customFields.value.empty}</span>;

  const line = cn('min-w-0', compact && 'truncate');

  switch (definition.type) {
    case 'text':
    case 'long_text':
      return (
        <span className={cn(line, definition.type === 'long_text' && 'whitespace-pre-line')}>
          {String(value)}
        </span>
      );
    case 'number':
      return (
        <span className={cn(line, 'font-mono text-[13px] tabular-nums')}>
          {formatNumber(Number(value), definition.settings.precision ?? 0)}
        </span>
      );
    case 'money': {
      const money = value as { amount: number; currencyId: string };
      const currency = refs.get(money.currencyId);
      return (
        <span className={cn(line, 'font-mono text-[13px] tabular-nums')}>
          {formatMoney(money, currency?.name ?? null)}
        </span>
      );
    }
    case 'date':
      return (
        <span className={cn(line, 'font-mono text-[13px] tabular-nums')}>
          {formatIsoDate(String(value))}
        </span>
      );
    case 'datetime':
      return (
        <span className={cn(line, 'font-mono text-[13px] tabular-nums')}>
          {formatIsoDateTime(String(value))}
        </span>
      );
    case 'duration':
      return (
        <span className={cn(line, 'font-mono text-[13px] tabular-nums')}>
          {formatDuration(Number(value))}
        </span>
      );
    case 'bool':
      return <span className={line}>{ui.customFields.value.yes}</span>;
    case 'enum': {
      const item = refs.get(String(value));
      return (
        <span className={cn(line, 'inline-flex max-w-full')}>
          {item?.name ? (
            <EnumChip ref={item} wrap={wrap} />
          ) : (
            <span className="text-muted-foreground">{ui.customFields.block.unavailable}</span>
          )}
        </span>
      );
    }
    case 'user':
    case 'department':
    case 'project':
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return (
        <span className={cn(line, 'inline-flex max-w-full')}>
          <RefName
            refs={refs}
            id={String(value)}
            withAvatar={definition.type === 'user'}
            wrap={wrap}
            interactive={interactive}
          />
        </span>
      );
    case 'multienum':
    case 'users': {
      const ids = Array.isArray(value) ? value : [];
      return (
        <span className={cn(line, 'inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1')}>
          {ids.map((id) =>
            definition.type === 'multienum' && refs.get(id)?.name ? (
              <EnumChip key={id} ref={refs.get(id)!} wrap={wrap} />
            ) : (
              <RefName
                key={id}
                refs={refs}
                id={id}
                withAvatar={definition.type === 'users'}
                wrap={wrap}
                interactive={interactive}
              />
            ),
          )}
        </span>
      );
    }
    case 'link': {
      const text = String(value);
      const kind = linkKindOf(text);
      if (kind === 'url' && interactive) {
        return (
          <a
            href={text}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-info underline-offset-2 hover:underline"
            title={ui.customFields.value.openLink}
          >
            <span className="truncate">{text}</span>
            <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
          </a>
        );
      }
      return (
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-[13px]">{text}</span>
          {interactive && kind === 'path' ? <CopyPathButton path={text} /> : null}
        </span>
      );
    }
  }
}
