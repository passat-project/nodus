import { ui } from '@nodus/contracts';

import type { AttachedRefDraft } from '../../lib/registration-draft.js';
import { AttachedRefsList } from '../attached-refs-list.js';

/**
 * Секция «Приложенные письма» окна регистрации (#461, Р3): строки
 * «№ + организация + дата» конверта-матрёшки; добавление и правка — тем же
 * реестром и окном строки, что в карточке. Пустой набор — строка-
 * приглашение; организация обязательна, дубли ловит сервер (422 `duplicate`).
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
  return (
    <div data-reg-field="attachedRefs" className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{ui.letters.attached.title}</span>
      <AttachedRefsList
        rows={value.map((ref, index) => ({
          key: `${index}-${ref.number}`,
          number: ref.number,
          org: ref.counterparty?.name ?? '',
          date: ref.date,
          draft: { ...ref },
        }))}
        editable
        empty={ui.letters.attached.lead}
        onCommit={(index, draft) => {
          const row: AttachedRefDraft = {
            number: draft.number.trim(),
            counterparty: draft.counterparty,
            date: draft.date,
          };
          if (!row.number || !row.counterparty) return;
          onChange(
            index !== null ? value.map((ref, at) => (at === index ? row : ref)) : [...value, row],
          );
        }}
        onRemove={(index) => onChange(value.filter((_, at) => at !== index))}
      />
      {invalid ? (
        <p id={errorId} className="text-xs text-danger">
          {invalid}
        </p>
      ) : null}
    </div>
  );
}
