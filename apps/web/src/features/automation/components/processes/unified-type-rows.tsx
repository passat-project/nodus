import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { NodeKindTile } from '../../../../shared/ui/node-kind-icon.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../../shared/workflow/type-tone.js';
import { creationMeta, nodeKindMeta, projectTypeMeta } from './unified-meta.js';
import { KindRowMenu, ProcessRowMenu, ProjectRowMenu } from './unified-type-menus.js';
import { UnifiedTypeRow, UnifiedTypeTile } from './unified-type-row.js';

/**
 * Строки единой колонки по категориям (#857) — презентационные компоненты,
 * собираемые контейнером `unified-type-list.tsx`. Мета строк — из
 * `unified-meta.ts` (кросс-фичевых импортов нет, I6).
 */

/** Строка задачи/письма: мета «Разрешён: …», меню настроек/копия/архив. */
export function ProcessTypeRow({
  type,
  selected,
  dirty,
  canManage,
  metaProjects,
  onSelect,
  onOpenSettings,
  onCopy,
  onArchive,
  onRestore,
}: {
  type: ProcessType;
  selected: boolean;
  dirty: boolean;
  canManage: boolean;
  metaProjects: readonly ProjectType[];
  onSelect: () => void;
  onOpenSettings: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <UnifiedTypeRow
      tile={
        <UnifiedTypeTile tileClass={typeToneOf(type.color)}>
          <ProcessTypeGlyph icon={type.icon} className="size-4" />
        </UnifiedTypeTile>
      }
      name={type.name}
      meta={creationMeta(type, metaProjects) ?? undefined}
      selected={selected}
      archived={type.archivedAt !== null}
      badges={
        <>
          {dirty ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-warning"
              title={ui.automation.chipDraft}
            />
          ) : null}
          {type.isSystem ? (
            <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground">
              {ui.automation.badgeSystem}
            </span>
          ) : null}
          {!type.creatable && !type.archivedAt ? (
            <span className="shrink-0 text-[10px] leading-4 text-muted-foreground">
              {ui.automation.badgeHidden}
            </span>
          ) : null}
        </>
      }
      menu={
        canManage ? (
          <ProcessRowMenu
            isTask={type.category === 'task'}
            isSystem={type.isSystem}
            archived={type.archivedAt !== null}
            onOpenSettings={onOpenSettings}
            onCopy={onCopy}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        ) : undefined
      }
      onClick={onSelect}
    />
  );
}

/** Строка типа проекта: мета «7 типов», меню настроек/копия/архив. */
export function ProjectTypeRow({
  type,
  selected,
  canSetup,
  kinds,
  onSelect,
  onOpenSettings,
  onCopy,
  onArchive,
  onRestore,
}: {
  type: ProjectType;
  selected: boolean;
  canSetup: boolean;
  kinds: readonly NodeKind[];
  onSelect: () => void;
  onOpenSettings: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <UnifiedTypeRow
      tile={
        <UnifiedTypeTile tileClass={identityTone[type.color].tile}>
          <ProcessTypeGlyph icon={type.icon} className="size-4" />
        </UnifiedTypeTile>
      }
      name={type.name}
      meta={projectTypeMeta(type, kinds)}
      selected={selected}
      archived={type.archivedAt !== null}
      menu={
        canSetup ? (
          <ProjectRowMenu
            archived={type.archivedAt !== null}
            onOpenSettings={onOpenSettings}
            onCopy={onCopy}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        ) : undefined
      }
      onClick={onSelect}
    />
  );
}

/** Строка типа папки: клик открывает экран типа, меню — копия/архив. */
export function KindRow({
  kind,
  selected,
  canSetup,
  onSelect,
  onCopy,
  onArchive,
  onRestore,
}: {
  kind: NodeKind;
  selected: boolean;
  canSetup: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <UnifiedTypeRow
      tile={<NodeKindTile icon={kind.icon} color={kind.color} className="size-9 rounded-lg" />}
      name={kind.name}
      meta={nodeKindMeta(kind)}
      selected={selected}
      archived={kind.archivedAt !== null}
      menu={
        canSetup ? (
          <KindRowMenu
            archived={kind.archivedAt !== null}
            onCopy={onCopy}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        ) : undefined
      }
      onClick={onSelect}
    />
  );
}

/** Строка «Без проекта» — последняя в группе «Проекты» (#857, §4). */
export function NoProjectRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <UnifiedTypeRow
      tile={
        <UnifiedTypeTile tileClass="border-dashed text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-current" />
        </UnifiedTypeTile>
      }
      name={ui.automation.entry.noProjectRow}
      meta={ui.automation.entry.noProjectRowHint}
      selected={selected}
      archived={false}
      onClick={onSelect}
    />
  );
}
