import { useState } from 'react';
import { Paperclip, Pencil, Plus, X } from 'lucide-react';
import { LETTER_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import type { AttachedRefDraft } from '../../lib/registration-draft.js';
import { AttachedRefDialog, draftOf, type RefDraft } from '../attached-ref-dialog.js';

/**
 * Секция «Приложенные письма» окна регистрации (#461, Р3): строки
 * «№ + организация + дата» конверта-матрёшки; добавление и правка — тем же
 * окном строки, что в карточке. Пустой набор — строка-приглашение;
 * организация обязательна, дубли ловит сервер (422 `duplicate`).
 */
export function AttachedRefsSection({
  value,
  onChange,
  invalid,
  errorId,
}: {
  value: readonly AttachedRefDraft[];
  onChange: (next: AttachedRefDraft[]) => void;
  invalid?: string;
  errorId?: string;
}) {
  const [editing, setEditing] = useState<{ index: number | null; draft: RefDraft } | null>(null);

  const commit = (draft: RefDraft) => {
    const row: AttachedRefDraft = {
      number: draft.number.trim(),
      counterparty: draft.counterparty,
      orgText: draft.counterparty ? '' : draft.orgText.trim(),
      date: draft.date,
    };
    if (!row.number || (!row.counterparty && !row.orgText)) return;
    const next =
      editing?.index !== null && editing?.index !== undefined
        ? value.map((ref, index) => (index === editing.index ? row : ref))
        : [...value, row];
    onChange(next);
    setEditing(null);
  };

  return (
    <div data-reg-field="attachedRefs" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {ui.letters.attached.title}
        </span>
        {value.length < LETTER_LIMITS.attachedRefs ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-1.5 text-muted-foreground"
            onClick={() => setEditing({ index: null, draft: draftOf() })}
          >
            <Plus data-icon="inline-start" />
            {ui.letters.attached.add}
          </Button>
        ) : null}
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{ui.letters.attached.lead}</p>
      ) : (
        <ul className="flex flex-col">
          {value.map((ref, index) => (
            <li
              key={`${ref.number}-${index}`}
              className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent/40"
            >
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono text-label-sm tabular-nums">{ref.number}</span>
              <span className="min-w-0 flex-1 truncate text-secondary-foreground">
                {ref.counterparty?.name ?? ref.orgText}
              </span>
              <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={`${ui.letters.card.editHint}: ${ref.number}`}
                  onClick={() =>
                    setEditing({
                      index,
                      draft: {
                        number: ref.number,
                        counterparty: ref.counterparty,
                        orgText: ref.orgText,
                        date: ref.date,
                      },
                    })
                  }
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  aria-label={`${ui.letters.attached.remove}: ${ref.number}`}
                  onClick={() => onChange(value.filter((_, position) => position !== index))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {invalid ? (
        <p id={errorId} className="text-xs text-danger">
          {invalid}
        </p>
      ) : null}
      {editing ? (
        <AttachedRefDialog
          draft={editing.draft}
          onCancel={() => setEditing(null)}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}
