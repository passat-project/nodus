import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { LETTER_LIMITS, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { PanelAction } from '../../../shared/ui/panel/panel-kit.js';
import { formatIsoDate } from '../lib/letter-format.js';
import { AttachedRefDialog, draftOf, type RefDraft } from './attached-ref-dialog.js';

/** Строка реестра приложенных в отображении: организация — имя контрагента
 *  или текст с листа. */
export interface AttachedRefView {
  key: string;
  number: string;
  org: string;
  date: string | null;
  draft: RefDraft;
}

/**
 * Реестр «Приложенные письма» (#461, Р3) — одна грамматика в окне
 * регистрации и в карточке: таблица-лесенка «№ · организация · дата»
 * (номер — данные, mono; дата — справа колонкой), правка/удаление — тихие
 * иконки строки на ховере, добавление — `PanelAction` под строками (действие
 * внутри раздела, не outline-кнопка). Одно окно строки на добавление и
 * правку; `onCommit(index | null, draft)` — вызывающий сохраняет набор.
 */
export function AttachedRefsList({
  rows,
  editable,
  empty,
  onCommit,
  onRemove,
}: {
  rows: readonly AttachedRefView[];
  editable: boolean;
  /** Подпись пустого реестра (в окне регистрации — приглашение). */
  empty: string;
  onCommit: (index: number | null, draft: RefDraft) => void;
  onRemove: (index: number) => void;
}) {
  const [editing, setEditing] = useState<{ index: number | null; draft: RefDraft } | null>(null);
  return (
    <div className="flex min-w-0 flex-col">
      {rows.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className={cn(
                'group/ref relative grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
                editable && 'hover:bg-accent',
              )}
            >
              <span className="truncate font-mono text-label tabular-nums">№ {row.number}</span>
              <span className="min-w-0 truncate text-secondary-foreground" title={row.org}>
                {row.org}
              </span>
              <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
                {row.date ? formatIsoDate(row.date) : ''}
              </span>
              {editable ? (
                // Действия строки — поверх даты (на ховере), колонку не
                // занимают: в узкой колонке данных организация не сжимается.
                <span className="absolute inset-y-0 right-1 flex items-center rounded-md bg-accent opacity-0 transition-opacity group-hover/ref:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label={`${ui.letters.attached.editTitle}: ${row.number}`}
                    title={ui.letters.attached.editTitle}
                    onClick={() => setEditing({ index, draft: row.draft })}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${ui.letters.attached.remove}: ${row.number}`}
                    title={ui.letters.attached.remove}
                    onClick={() => onRemove(index)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable && rows.length < LETTER_LIMITS.attachedRefs ? (
        <PanelAction
          icon={Plus}
          className="mt-1 text-muted-foreground"
          onClick={() => setEditing({ index: null, draft: draftOf() })}
        >
          {ui.letters.attached.add}
        </PanelAction>
      ) : null}
      {editing ? (
        <AttachedRefDialog
          draft={editing.draft}
          editing={editing.index !== null}
          onCancel={() => setEditing(null)}
          onCommit={(draft) => {
            setEditing(null);
            onCommit(editing.index, draft);
          }}
        />
      ) : null}
    </div>
  );
}
