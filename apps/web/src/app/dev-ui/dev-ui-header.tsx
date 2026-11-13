import { useEffect, useState } from 'react';
import { devUiStrings } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { SegmentedControl } from '../../shared/ui/segmented-control.js';
import { useShellStore, type ThemeId } from '../shell/shell-store.js';

const NAV: readonly { id: string; label: string }[] = [
  { id: 'dev-tokens', label: devUiStrings.sections.tokens },
  { id: 'dev-typography', label: devUiStrings.sections.typography },
  { id: 'dev-controls', label: devUiStrings.sections.controls },
  { id: 'dev-chips', label: devUiStrings.sections.chips },
  { id: 'dev-overlays', label: devUiStrings.sections.overlays },
  { id: 'dev-states', label: devUiStrings.sections.states },
];

const THEME_OPTIONS: readonly { value: ThemeId; label: string }[] = [
  { value: 'light', label: devUiStrings.themeLight },
  { value: 'dark', label: devUiStrings.themeDark },
];

/** Дискретные шаги масштаба (#60): непрерывные дают артефакты округления. */
const SCALE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '0.9', label: devUiStrings.scale09 },
  { value: '1', label: devUiStrings.scale10 },
  { value: '1.125', label: devUiStrings.scale1125 },
  { value: '1.25', label: devUiStrings.scale125 },
];

const DEFAULT_SCALE = '1.25';

/** Текущий масштаб читаем из CSS — источник истины значения в globals.css. */
function readScale(): string {
  if (typeof document === 'undefined') return DEFAULT_SCALE;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim();
  return value || DEFAULT_SCALE;
}

/**
 * Ниже 1,125 масштаб сужает шелл: рейка 216–240px, длинные пункты меню
 * обрезаются (поведение `--ui-scale` #60, воспроизводится на любой странице —
 * замер: /home и /dev/ui совпадают). Галерея об этом предупреждает, чтобы
 * сужение рейки не читали регрессией её вёрстки.
 */
function shrinksShell(scale: string): boolean {
  return Number(scale) < 1.125;
}

/**
 * Шапка dev-галереи: заголовок, переходы по секциям, тумблер темы и масштаба.
 *
 * Тема — тот же механизм, что у тумблера топбара: zustand `useShellStore` +
 * `data-theme` на `<html>` (ставит AppShell), поэтому галерея проверяет ровно
 * ту тему, которую видит продукт. Масштаб — inline `--ui-scale` на `<html>`
 * (переменная из globals.css); при уходе со страницы снимается — глобальная
 * настройка не «протекает» в остальные экраны.
 *
 * РАСКЛАДКА (замечание владельца: «Светл…», «1,1…»): ни один сегмент и ни
 * одна подпись не обрезаются. Управляющие группы — `shrink-0` (не сжимаются
 * и не отдают ширину соседям), сегменты — `layout="grid"` примитива: колонки
 * равны ширине САМОЙ ДЛИННОЙ подписи, поэтому «1,125» не режется; всё
 * остальное, чему не хватило места, переносится строкой (`flex-wrap` шапки),
 * а не уходит в многоточие.
 */
export function DevUiHeader() {
  const theme = useShellStore((s) => s.theme);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const [scale, setScale] = useState(readScale);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', scale);
    return () => {
      root.style.removeProperty('--ui-scale');
    };
  }, [scale]);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-2">
      <div className="flex min-w-0 shrink-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="shrink-0 text-lg font-semibold whitespace-nowrap text-foreground">
            {devUiStrings.title}
          </h1>
          <NodeChip tone="info" className="shrink-0 whitespace-nowrap">
            {devUiStrings.devOnly}
          </NodeChip>
        </div>
        <p className="max-w-[26rem] text-label-xs text-muted-foreground">{devUiStrings.subtitle}</p>
      </div>

      <nav
        aria-label={devUiStrings.navLabel}
        className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1 lg:basis-auto"
      >
        {NAV.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-md px-2 py-1 text-label-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex w-full flex-wrap items-center justify-end gap-x-5 gap-y-2 lg:ml-auto lg:w-auto">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-label-sm whitespace-nowrap text-muted-foreground">
            {devUiStrings.theme}
          </span>
          <SegmentedControl
            className="shrink-0"
            layout="grid"
            size="sm"
            value={theme}
            options={THEME_OPTIONS}
            ariaLabel={devUiStrings.theme}
            onChange={(value: ThemeId) => {
              if (value !== theme) toggleTheme();
            }}
          />
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-sm whitespace-nowrap text-muted-foreground">
              {devUiStrings.scale}
            </span>
            <SegmentedControl
              className="shrink-0"
              layout="grid"
              size="sm"
              value={scale}
              options={SCALE_OPTIONS}
              ariaLabel={devUiStrings.scaleControlLabel}
              onChange={setScale}
            />
            <span className="font-mono text-label-xs whitespace-nowrap text-muted-foreground tabular-nums">
              --ui-scale {scale}
            </span>
          </div>
          {/* Пояснение — под контролом (не в aria-label: имя группы должно
              называть её, а не объяснять механизм). */}
          <span className="max-w-[30rem] text-label-xs text-muted-foreground">
            {devUiStrings.scaleHint}
          </span>
          {shrinksShell(scale) ? (
            <span className="text-label-xs text-warning">{devUiStrings.scaleShellHint}</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
