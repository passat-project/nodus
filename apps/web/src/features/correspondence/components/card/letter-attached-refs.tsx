import type { LetterAttachedRef, LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useUpdateLetter } from '../../api/letters-mutations.js';
import { draftOf, type RefDraft } from '../attached-ref-dialog.js';
import { AttachedRefsList } from '../attached-refs-list.js';

/**
 * Блок «Приложенные письма» (#461, Р3): строки «№ + организация + дата» —
 * конверт-матрёшка, в котором заказчик присылает пачку писем. Ввод при
 * регистрации и правка канцелярией в карточке; каждая правка — PATCH всего
 * набора (сервер пишет историю счётчиком), оптимистично с откатом. Точный
 * дубль строки и пустая организация — 422 (`duplicate`/`required`).
 * Вложения-файлы сюда не входят: это реестр вложенных ДОКУМЕНТОВ. Пустой
 * блок у того, кто не правит, не показывается (мёртвых плашек нет).
 */
export function LetterAttachedRefsBlock({ letter }: { letter: LetterDetail }) {
  const update = useUpdateLetter(letter.id);
  const editable = letter.access.canEdit;
  const refs = letter.attachedRefs;
  if (!editable && refs.length === 0) return null;

  const save = (next: LetterAttachedRef[]) =>
    update.mutate({
      body: {
        attachedRefs: next.map((ref) => ({
          number: ref.number,
          counterpartyId: ref.counterparty?.id ?? null,
          orgText: ref.orgText,
          date: ref.date,
        })),
      },
      patch: { attachedRefs: next },
    });

  const commit = (index: number | null, draft: RefDraft) => {
    const number = draft.number.trim();
    const orgText = draft.orgText.trim();
    if (!number || (!draft.counterparty && !orgText)) return;
    const row: LetterAttachedRef = {
      id: (index !== null ? refs[index]?.id : undefined) ?? crypto.randomUUID(),
      number,
      counterparty: draft.counterparty,
      orgText: draft.counterparty ? null : orgText,
      date: draft.date,
    };
    save(index !== null ? refs.map((ref, at) => (at === index ? row : ref)) : [...refs, row]);
  };

  return (
    <section className="mt-6">
      <NodeLabel label={ui.letters.attached.title} count={refs.length} />
      <div className="mt-1.5">
        <AttachedRefsList
          rows={refs.map((ref) => ({
            key: ref.id,
            number: ref.number,
            org: ref.counterparty?.name ?? ref.orgText ?? '',
            date: ref.date,
            draft: draftOf(ref),
          }))}
          editable={editable}
          empty={ui.letters.attached.empty}
          onCommit={commit}
          onRemove={(index) => save(refs.filter((_, at) => at !== index))}
        />
      </div>
    </section>
  );
}
