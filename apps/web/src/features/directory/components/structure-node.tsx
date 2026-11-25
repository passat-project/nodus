import { Building2, Plus, UserRound, Users } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { plural, withoutPatronymic } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import type { DepartmentCardStats } from '../lib/department-card-stats.js';
import { StructureNodeFooter } from './structure-node-footer.js';
import { StructureNodeMenu } from './structure-node-menu.js';

/** Высота карточки структуры (H) и одновременно вертикальный зазор до ряда
 *  детей: шаг уровней = 2H, высота соединения узла с детьми = H
 *  (#768, пакет 16.11.2026). Одна константа на оба места — не разъедутся.
 *  10.25rem — H вердикта 16.11.2026: столбцы стоят вплотную к руководителю
 *  (mt-2.5 = 12.5 px при UI-масштабе 1.25), остаток воздуха уходит вниз, к
 *  футеру; контент гарантированно не заезжает на футер (проверка живьём). */
export const STRUCTURE_CARD_HEIGHT = '10.25rem';

/**
 * Карточка отдела на канвасе структуры (#768, пакет 16.11.2026):
 * шапка (название + бейдж главной) → руководитель (аватар, имя, должность под
 * именем) и чип команды → два столбца («Подчинённые» и «Заместители») →
 * футер с числом отделов и шевроном раскрытия.
 *
 * Слот узла — ТОЛЬКО карточка фиксированной высоты `STRUCTURE_CARD_HEIGHT`;
 * ряд детей — абсолютный слой под родителем: раскрытие не меняет x карточек
 * других уровней, дети могут заходить под соседей (модель Битрикса). Шеврон
 * сворачивает ветку целиком, у карточки без отделов его нет. Под ВЫБРАННОЙ
 * карточкой администратору — «плюс»: на линии при видимых детях, иначе
 * вплотную к низу. Выделение: предки — контур в тоне маршрута, выбранная —
 * толще плюс кольцо; габарит не меняется, соседи не двигаются. Бейдж
 * «Ваше подразделение» — на карточке моего отдела (вердикт 16.11.2026), «⋯» —
 * администратору в углу карточки (sibling кнопки-тела, чтобы клик не выбирал).
 */
export function StructureNode({
  node,
  depth,
  mainId,
  myDepartmentId,
  selectedId,
  routeIds,
  expandedIds,
  canManage,
  childrenOf,
  statsById,
  nodeRefs,
  onSelect,
  onToggle,
  onCreateChild,
  onInvite,
  onEdit,
  onTransfer,
  onDelete,
}: {
  node: DepartmentNode;
  /** Глубина в дереве — для порядка наложения рядов детей. */
  depth: number;
  mainId: string | null;
  /** Мой активный отдел — для бейджа «Ваше подразделение» (нет — бейджа нет). */
  myDepartmentId: string | null;
  selectedId: string | null;
  /** Отделы маршрута «главная → выбранное» — контуры предков. */
  routeIds: ReadonlySet<string>;
  /** Узлы, чьи дети сейчас видны (аккордеон; свёрнутые шевроном исключены). */
  expandedIds: ReadonlySet<string>;
  canManage: boolean;
  /** Видимые дети узла по цепочке раскрытий (пусто — ветка свёрнута). */
  childrenOf: (node: DepartmentNode) => DepartmentNode[];
  statsById: ReadonlyMap<string, DepartmentCardStats>;
  nodeRefs: React.RefObject<Map<string, HTMLDivElement>>;
  onSelect: (id: string) => void;
  /** Шеврон футера: свернуть ветку / раскрыть узел. */
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  /** «⋯» карточки: приглашение с предвыбранным подразделением (#101). */
  onInvite: (node: DepartmentNode) => void;
  /** «⋯» карточки: правка подразделения. */
  onEdit: (node: DepartmentNode) => void;
  /** «⋯» карточки: перевод сотрудника в это подразделение (#881). */
  onTransfer: (node: DepartmentNode) => void;
  /** «⋯» карточки: удаление с переносом (#881); у главной карточки скрыто. */
  onDelete: (node: DepartmentNode) => void;
}) {
  const isMain = node.id === mainId;
  const isMine = myDepartmentId !== null && node.id === myDepartmentId;
  const selected = selectedId === node.id;
  const onRoute = !selected && routeIds.has(node.id);
  const expanded = expandedIds.has(node.id);
  const visibleChildren = childrenOf(node);
  const stats = statsById.get(node.id);
  const head = stats?.head ?? null;
  const deputies = stats?.deputies ?? [];
  const subordinatesCount = stats?.subordinates.length ?? 0;
  const teamCount = stats?.teamCount ?? 0;
  // Футер/шеврон активны на маршруте к выбранному; у выбранной — если раскрыта.
  const footerActive = (selected || onRoute) && expanded;
  const deputy = deputies[0] ?? null;
  return (
    <div data-structure-slot={node.id} className="relative flex w-60 flex-col items-center">
      <div
        ref={(element) => {
          if (!element) return;
          nodeRefs.current.set(node.id, element);
          return () => {
            nodeRefs.current.delete(node.id);
          };
        }}
        data-tree-node={node.id}
        style={{ height: STRUCTURE_CARD_HEIGHT }}
        className={cn(
          'node-panel relative flex w-60 flex-col transition-colors',
          !selected && !onRoute && 'hover:border-input',
          // Предок маршрута — линия следа: тон линии + мягкое свечение
          // (вердикт 16.11.2026: пунктирная «/45» читалась бледнее ребра).
          onRoute && 'border-foreground shadow-[0_0_6px_var(--glow)]',
          selected &&
            'border-foreground shadow-[0_0_0_2px_var(--foreground),0_0_14px_-2px_var(--glow)]',
        )}
      >
        {/* Тонировка главной/выбранной — ОТДЕЛЬНЫЙ слой поверх непрозрачного
            фона node-panel: bg-accent/20|40 на самой карточке делал её
            полупрозрачной (сквозь карточку просвечивали линии и свечение, #768). */}
        {isMain || selected ? (
          <span
            aria-hidden
            data-card-tint
            className={cn(
              'pointer-events-none absolute inset-0 rounded-[inherit]',
              selected ? 'bg-accent/40' : 'bg-accent/20',
            )}
          />
        ) : null}
        {/* «Ваше подразделение» — на верхнем правом краю МОЕЙ карточки, вне потока
            шапки: иначе бейдж съедал место названия (240px). Кольцо цвета
            карточки отделяет пилюлю от контура. Тон нейтральный (вердикт
            17.11.2026): метка не претендует на акцент модуля — он у «Пригласить». */}
        {isMine ? (
          <span
            data-my-department
            className="pointer-events-none absolute -top-2 right-2 z-20 rounded-full bg-foreground px-1.5 py-0.5 text-label-xs font-medium text-background ring-2 ring-card"
          >
            {ui.employees.myDepartment}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="relative flex min-h-0 flex-1 flex-col px-3 pt-2.5 pb-2 text-left"
        >
          {/* Место справа — под «⋯» (брат кнопки-тела): имя обрезается до неё. */}
          <span className={cn('flex items-center gap-1.5', canManage && 'pr-7')}>
            {isMain ? (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-base font-semibold" title={node.name}>
              {node.name}
            </span>
            {isMain ? (
              <span className="shrink-0 rounded border border-border/70 px-1 py-px text-label-xs tracking-wide text-muted-foreground uppercase">
                {ui.employees.mainCompanyShort}
              </span>
            ) : null}
          </span>

          <span className="mt-2.5 flex items-center gap-2">
            {head ? (
              <PersonAvatar
                name={head.name}
                avatarUrl={head.avatarUrl}
                className="size-10 shrink-0"
              />
            ) : (
              <span
                title={ui.employees.noHead}
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border"
              >
                <UserRound className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-sm',
                  head ? 'text-foreground' : 'text-muted-foreground',
                )}
                title={head?.name ?? ui.employees.noHead}
              >
                {head?.name ?? ui.employees.noHead}
              </span>
              {head?.positionName ? (
                <span
                  className="block truncate text-label-sm text-muted-foreground"
                  title={head.positionName}
                >
                  {head.positionName}
                </span>
              ) : null}
            </span>
            <span
              title={ui.employees.teamCount}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-label-sm text-muted-foreground tabular-nums"
            >
              <Users className="size-3" strokeWidth={1.75} aria-hidden />
              {teamCount}
            </span>
          </span>

          <span className="mt-2.5 grid grid-cols-2 gap-x-2">
            <span className="min-w-0">
              <span className="block truncate text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {ui.employees.subordinates}
              </span>
              <span className="mt-0.5 block truncate text-label-sm text-foreground tabular-nums">
                {subordinatesCount} {plural(subordinatesCount, ui.employees.employeeForms)}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {ui.employees.deputies}
              </span>
              {deputies.length === 0 ? null : deputies.length === 1 && deputy ? (
                <span className="mt-0.5 flex items-center gap-1 text-label-sm text-foreground">
                  <PersonAvatar
                    name={deputy.displayName}
                    avatarUrl={deputy.avatarUrl}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate" title={deputy.displayName}>
                    {withoutPatronymic(deputy.displayName)}
                  </span>
                </span>
              ) : (
                <span className="mt-0.5 block truncate text-label-sm text-foreground tabular-nums">
                  {deputies.length} {plural(deputies.length, ui.employees.employeeForms)}
                </span>
              )}
            </span>
          </span>
        </button>

        {canManage && (
          <StructureNodeMenu
            node={node}
            mainCard={isMain}
            onInvite={onInvite}
            onEdit={onEdit}
            onTransfer={onTransfer}
            onDelete={onDelete}
          />
        )}

        <StructureNodeFooter
          node={node}
          expanded={expanded}
          active={footerActive}
          onToggle={onToggle}
        />

        {canManage && selected && (
          <button
            type="button"
            aria-label={ui.employees.addSubdepartment}
            title={ui.employees.addSubdepartment}
            data-plus={visibleChildren.length > 0 ? 'line' : 'flush'}
            onClick={(event) => {
              event.stopPropagation();
              onCreateChild(node.id);
            }}
            className={cn(
              'absolute left-1/2 z-10 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-input hover:text-foreground',
              visibleChildren.length > 0 ? 'top-full mt-3' : 'top-full',
            )}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {visibleChildren.length > 0 && (
        <div
          data-structure-children={node.id}
          style={{
            top: `calc(100% + ${STRUCTURE_CARD_HEIGHT})`,
            zIndex: depth + 2,
          }}
          className="absolute left-1/2 flex -translate-x-1/2 items-start gap-4"
        >
          {visibleChildren.map((child) => (
            <StructureNode
              key={child.id}
              node={child}
              depth={depth + 1}
              mainId={mainId}
              myDepartmentId={myDepartmentId}
              selectedId={selectedId}
              routeIds={routeIds}
              expandedIds={expandedIds}
              canManage={canManage}
              childrenOf={childrenOf}
              statsById={statsById}
              nodeRefs={nodeRefs}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
              onInvite={onInvite}
              onEdit={onEdit}
              onTransfer={onTransfer}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
