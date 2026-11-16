import type { EffectiveSection } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { TimeEntryFields, type TimeEntryDraft } from '../../../tasks/time-entry-fields.js';
import type { WindowDraft } from '../use-window-draft.js';
import { timeSectionIssue } from '../window-conditions.js';

/** «Трудозатраты»: та же форма ручной записи, что в учёте времени. */
export function TimeSection({
  section,
  draft,
  setTime,
  disabled,
  spentMinutes,
}: {
  section: Extract<EffectiveSection, { kind: 'time' }>;
  draft: WindowDraft;
  setTime: (time: TimeEntryDraft) => void;
  disabled: boolean;
  spentMinutes: number;
}) {
  const issue = timeSectionIssue(section, draft, spentMinutes);
  const error =
    issue === 'limit'
      ? ui.tasks.minutesOverLimit
      : issue === 'format'
        ? ui.tasks.minutesInvalid
        : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {section.mode === 'if_empty'
          ? ui.tasks.window.timeModeIfEmpty
          : ui.tasks.window.timeModeAlways}
        {spentMinutes > 0 ? ` · ${ui.tasks.spent}: ${spentMinutes} ${ui.tasks.minutesShort}` : ''}
      </p>
      <TimeEntryFields value={draft.time} onChange={setTime} disabled={disabled} error={error} />
    </div>
  );
}
