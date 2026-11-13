import type { StageColor, TaskStage, TaskSystemState } from '@nodus/contracts';
import { devUiStrings } from '@nodus/contracts';
import { Badge } from '@nodus/ui/components/badge';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { StageChip } from '../../../shared/ui/stage-chip.js';
import { TaskStatusBadge } from '../../../shared/ui/task-status-badge.js';

import { DevGroup, DevSection } from '../dev-section.js';

const STATUS_FIXTURES: readonly { name: string; systemState: TaskSystemState }[] = [
  { name: devUiStrings.stages.new, systemState: 'backlog' },
  { name: devUiStrings.stages.work, systemState: 'active' },
  { name: devUiStrings.stages.paused, systemState: 'paused' },
  { name: devUiStrings.stages.done, systemState: 'done' },
  { name: devUiStrings.stages.closed, systemState: 'closed' },
];

const STAGE_FIXTURES: readonly { name: string; color: StageColor }[] = [
  { name: devUiStrings.stages.design, color: 'info' },
  { name: devUiStrings.stages.work, color: 'teal' },
  { name: devUiStrings.stages.review, color: 'violet' },
  { name: devUiStrings.stages.approval, color: 'orange' },
  { name: devUiStrings.stages.done, color: 'success' },
  { name: devUiStrings.stages.paused, color: 'warning' },
  { name: devUiStrings.stages.cancelled, color: 'danger' },
  { name: devUiStrings.stages.archive, color: 'pink' },
  { name: devUiStrings.stages.closed, color: 'cyan' },
  { name: devUiStrings.stages.new, color: 'neutral' },
];

const PEOPLE = [
  devUiStrings.people.anna,
  devUiStrings.people.boris,
  devUiStrings.people.vera,
  devUiStrings.people.gleb,
  devUiStrings.people.dina,
  devUiStrings.people.mark,
];

/** Фикстура стадии: id — валидный UUID (контракт требует), данные — из i18n. */
function stageFixture(name: string, systemState: TaskSystemState, index: number): TaskStage {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name,
    order: index,
    systemState,
    color: systemState === 'active' ? 'info' : 'neutral',
  };
}

/**
 * Ф4: статусы и идентичность. Статус — всегда `NodeChip` по системному
 * состоянию (TaskStatusBadge) или тону стадии (StageChip); `Badge` — метка, не
 * статус. Аватары — графитовые (#726): тон от имени, одинаков в обеих темах.
 */
export function ChipsSection() {
  return (
    <DevSection id="dev-chips" label={devUiStrings.sections.chips} hint={devUiStrings.chips.hint}>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <DevGroup title={devUiStrings.chips.system} caption={devUiStrings.chips.captionSystem}>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FIXTURES.map((item, index) => (
              <TaskStatusBadge
                key={item.systemState}
                stage={stageFixture(item.name, item.systemState, index)}
              />
            ))}
          </div>
        </DevGroup>

        <DevGroup title={devUiStrings.chips.stages} caption={devUiStrings.chips.captionStages}>
          <div className="flex flex-wrap items-center gap-2">
            {STAGE_FIXTURES.map((item) => (
              <StageChip key={item.color} name={item.name} color={item.color} />
            ))}
          </div>
        </DevGroup>

        <DevGroup
          title={devUiStrings.chips.badges}
          hint={devUiStrings.chips.badgesHint}
          caption={devUiStrings.chips.captionBadges}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{devUiStrings.chips.badgeDefault}</Badge>
            <Badge variant="secondary">{devUiStrings.chips.badgeSecondary}</Badge>
            <Badge variant="destructive">{devUiStrings.chips.badgeDestructive}</Badge>
            <Badge variant="outline">{devUiStrings.chips.badgeOutline}</Badge>
            <Badge variant="ghost">{devUiStrings.chips.badgeGhost}</Badge>
          </div>
        </DevGroup>

        <DevGroup
          title={devUiStrings.chips.avatars}
          hint={devUiStrings.chips.avatarsHint}
          caption={devUiStrings.chips.captionAvatars}
        >
          <div className="flex flex-wrap items-center gap-3">
            {PEOPLE.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <PersonAvatar name={name} className="size-8" />
                <span className="text-label-sm text-muted-foreground">{name}</span>
              </div>
            ))}
            <PersonAvatar name={PEOPLE[0] ?? ''} className="size-6" />
          </div>
        </DevGroup>
      </div>
    </DevSection>
  );
}
