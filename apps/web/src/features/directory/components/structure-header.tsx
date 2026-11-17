import { IdCard, UserPlus } from 'lucide-react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { uiPx } from '../../../shared/ui/ui-scale.js';
import { StructureSearch } from './structure-search.js';

/** Порог узкой шапки: поиск уходит в иконку, «Пригласить» — тоже. */
const COMPACT_THRESHOLD = uiPx(640);
/** Резерв под постоянную правую панель (w-80, стоит вплотную к краю). */
const PANEL_RESERVE = uiPx(320);

/**
 * Шапка вкладки «Структура» (#768, вердикты владельца 12–13.11.2026):
 * заголовок со штатом, primary «Пригласить» слева (только администратор),
 * поиск по отделам и сотрудникам (по ширине — как в «Списке»), справа
 * «Список должностей» иконкой с подсказкой при наведении/фокусе (вердикт
 * 16.11.2026: текстовая кнопка перекашивала шапку против панели). Панель
 * постоянна, поэтому шапка всегда резервирует её ширину — инструменты не
 * двигаются и не прячутся.
 */
export function StructureHeader({
  staffCount,
  rowWidth,
  canManage,
  positionsOpen,
  roots,
  users,
  onInvite,
  onTogglePositions,
  onPickDepartment,
  onPickEmployee,
}: {
  staffCount: number;
  rowWidth: number;
  canManage: boolean;
  positionsOpen: boolean;
  roots: DepartmentNode[];
  users: readonly UserListItem[];
  onInvite: () => void;
  onTogglePositions: () => void;
  onPickDepartment: (id: string) => void;
  onPickEmployee: (user: UserListItem) => void;
}) {
  const compact = rowWidth > 0 && rowWidth - PANEL_RESERVE < COMPACT_THRESHOLD;
  // Совсем узкая шапка: «Пригласить» остаётся primary, но иконкой с
  // подписью для чтения с экрана — текстовая кнопка выталкивала поиск.
  const narrow = rowWidth > 0 && rowWidth < uiPx(340);

  return (
    <div
      style={{ paddingRight: PANEL_RESERVE }}
      className={cn('flex h-14 shrink-0 items-center pl-6', compact ? 'gap-2' : 'gap-3')}
    >
      <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
        {ui.employees.title}
        <span className="ml-2 align-middle font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
          {staffCount}
        </span>
      </h1>
      {canManage && (
        <Button
          className="shrink-0"
          size={narrow ? 'icon' : 'default'}
          aria-label={ui.employees.invite}
          title={ui.employees.invite}
          onClick={onInvite}
        >
          <UserPlus data-icon={narrow ? undefined : 'inline-start'} />
          {narrow ? null : ui.employees.invite}
        </Button>
      )}
      <StructureSearch
        compact={compact}
        roots={roots}
        users={users}
        onPickDepartment={onPickDepartment}
        onPickEmployee={onPickEmployee}
      />
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'shrink-0',
          positionsOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        // Нативная подсказка, как у «Найти меня» и масштаба (вердикт 17.11.2026):
        // Radix-тултип в шапке дублировал роль обычного title.
        title={ui.employees.positionsList}
        aria-label={ui.employees.positionsList}
        aria-pressed={positionsOpen}
        onClick={onTogglePositions}
      >
        {/* IdCard — карточка сотрудника (вердикт владельца 17.11.2026), не портфель.
            20px в дизайн-масштабе (≈25 экранных): 16px читались мельче соседних
            иконок шапки; штрих чуть тоньше — крупная иконка не «жирнеет». */}
        <IdCard className="size-5" strokeWidth={1.5} />
      </Button>
    </div>
  );
}
