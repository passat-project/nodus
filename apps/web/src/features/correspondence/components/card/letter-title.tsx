import { useState } from 'react';
import { Lock } from 'lucide-react';
import { LETTER_LIMITS, ui } from '@nodus/contracts';

import { useUpdateLetter } from '../../api/letters-mutations.js';
import { useLetterDetail } from '../../api/letters-queries.js';

/** Тема письма в хроме слайдера (как название задачи: главный заголовок —
 *  рядом с X, в теле не дублируется). Канцелярия правит её на месте
 *  (Enter/уход — сохранить, Esc — отмена; пустую тему сервер не примет —
 *  отмена), остальным — текст; без темы — «Письмо без темы». У
 *  незарегистрированного без темы placeholder — предупреждающим тоном:
 *  тема обязательна для регистрации без окна (редизайн #56). */
export function LetterTitle({ letterId }: { letterId: string }) {
  const { data: letter } = useLetterDetail(letterId);
  const update = useUpdateLetter(letterId);
  const [draft, setDraft] = useState<string | null>(null);

  if (!letter) return <>{ui.letters.letter}</>;
  const shown = letter.subject ?? ui.letters.noSubject;
  // Замок конфиденциального (#461, Р4): бейдж только видящим письмо —
  // остальным строки и карточки нет вовсе (не оракул).
  const lock = letter.confidential ? (
    <Lock
      aria-label={ui.letters.confidential.badge}
      className="mr-1.5 inline size-3.5 shrink-0 align-middle text-muted-foreground"
      strokeWidth={1.75}
    />
  ) : null;
  const subjectMissing =
    letter.subject === null && letter.registeredAt === null && letter.access.canEdit;
  if (!letter.access.canEdit) {
    return (
      <span className={letter.subject ? undefined : 'text-muted-foreground'}>
        {lock}
        {shown}
      </span>
    );
  }

  function commit() {
    const subject = draft?.replace(/\s+/g, ' ').trim();
    setDraft(null);
    if (subject && letter && subject !== letter.subject) {
      update.mutate({ body: { subject }, patch: { subject } });
    }
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={LETTER_LIMITS.subject}
        aria-label={`${ui.letters.card.editHint}: ${ui.letters.fields.subject}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            // Esc гасит правку, а не закрывает карточку (SliderPanel слушает Esc).
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-[min(60vw,48rem)] max-w-full min-w-0 rounded-md bg-accent/50 px-1.5 text-lg font-semibold text-foreground outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      title={`${ui.letters.card.editHint}: ${ui.letters.fields.subject}`}
      onClick={() => setDraft(letter.subject ?? '')}
      className={`block max-w-full cursor-text truncate text-left decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:underline ${
        subjectMissing ? 'text-warning' : letter.subject ? '' : 'text-muted-foreground'
      }`}
    >
      {lock}
      {shown}
    </button>
  );
}
