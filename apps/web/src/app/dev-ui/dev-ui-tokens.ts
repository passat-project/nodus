/**
 * Каталог dev-галереи `/dev/ui` (#257): ИМЕНА токенов и ступеней, без значений.
 * Значение всегда рендерится через `var(--…)` (см. dev-swatch.tsx) — хардкод
 * hex в галерее запрещён, иначе страница перестаёт быть проверкой темы.
 *
 * Источник истины значений — `packages/ui/src/styles/globals.css` (`:root` —
 * светлая тема, `[data-theme='dark']` — тёмная, `@theme` — лестницы); при
 * добавлении токена список пополняется здесь (пиксели кеглей — из @theme).
 * Соответствие каталога источнику проверяет `dev-ui-tokens.test.ts` — читает
 * globals.css и требует, чтобы каждый токен был объявлен в ОБЕИХ темах, а
 * кегли/радиусы — в `@theme`. Переименование токена без правки каталога
 * роняет тест, а не оставляет страницу «зелёной, но врущей».
 *
 * ПРАВИЛО ПОДПИСЕЙ (I15): i18n — для ТЕКСТА интерфейса (заголовки, пояснения,
 * названия состояний, подсказки). Идентификаторы кода — имена CSS-переменных
 * (`--primary`), классов (`text-label-sm`, `rounded-md`), примитивов (`Button`,
 * `Input`), значений (`1,125`, `placeholder`) — i18n НЕ подлежат и живут
 * литералами рядом с кодом: это не строки для пользователя, а ссылки на
 * источник истины, они не переводятся и не должны дублироваться в словаре
 * (иначе при переименовании класса словарь начнёт врать). Всё, где есть
 * русское слово, обязано быть в `devUiStrings` — это же ловит линтер I15
 * (кириллица в JSX литералом).
 */

export type TokenGroupId =
  | 'surfaces'
  | 'semantic'
  | 'action'
  | 'contour'
  | 'tones'
  | 'bubbles'
  | 'files'
  | 'names'
  | 'charts';

export interface TokenGroup {
  id: TokenGroupId;
  /** fill — плашка заливки; text — образец текста в тоне (палитра имён). */
  mode: 'fill' | 'text';
  tokens: readonly string[];
}

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    id: 'surfaces',
    mode: 'fill',
    tokens: [
      '--background',
      '--card',
      '--muted',
      '--accent',
      '--secondary',
      '--chat-zone',
      '--popover',
      '--sidebar',
      '--sidebar-accent',
    ],
  },
  {
    id: 'semantic',
    mode: 'fill',
    tokens: [
      '--success',
      '--success-soft',
      '--warning',
      '--warning-soft',
      '--danger',
      '--danger-soft',
      '--info',
      '--info-soft',
      '--destructive',
    ],
  },
  {
    id: 'action',
    mode: 'fill',
    tokens: [
      '--primary',
      '--primary-hover',
      '--primary-foreground',
      '--ring',
      '--segmented-active',
      '--selection-ring',
    ],
  },
  {
    id: 'contour',
    mode: 'fill',
    tokens: ['--edge', '--edge-solid', '--port', '--glow'],
  },
  {
    id: 'tones',
    mode: 'fill',
    tokens: [
      '--tone-violet',
      '--tone-violet-soft',
      '--tone-teal',
      '--tone-teal-soft',
      '--tone-orange',
      '--tone-orange-soft',
      '--tone-pink',
      '--tone-pink-soft',
      '--tone-cyan',
      '--tone-cyan-soft',
    ],
  },
  {
    id: 'bubbles',
    mode: 'fill',
    tokens: [
      '--bubble-in',
      '--bubble-in-foreground',
      '--bubble-out',
      '--bubble-out-foreground',
      '--bubble-out-accent',
    ],
  },
  {
    id: 'files',
    mode: 'fill',
    tokens: ['--file-pdf', '--file-doc', '--file-sheet', '--file-archive', '--file-media'],
  },
  {
    id: 'names',
    mode: 'text',
    tokens: ['--name-1', '--name-2', '--name-3', '--name-4', '--name-5', '--name-6', '--name-7'],
  },
  {
    id: 'charts',
    mode: 'fill',
    tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'],
  },
];

/** Лестница кеглей `@theme` (globals.css): класс утилиты и px «кегль/интерлиньяж». */
export const TYPE_SCALE: readonly { className: string; size: string }[] = [
  { className: 'text-label-xs', size: '11 / 16' },
  { className: 'text-label-sm', size: '12 / 16' },
  { className: 'text-label', size: '13 / 18' },
  { className: 'text-label-lg', size: '14 / 20' },
  { className: 'text-badge', size: '10 / 12' },
  { className: 'text-body-xs', size: '14 / 20' },
  { className: 'text-body-lg', size: '16 / 24' },
  { className: 'text-stat', size: '28 / 32' },
  { className: 'text-xs', size: '13 / 18' },
  { className: 'text-sm', size: '15 / 22' },
  { className: 'text-base', size: '16 / 24' },
  { className: 'text-lg', size: '18 / 26' },
  { className: 'text-xl', size: '20 / 28' },
  { className: 'text-2xl', size: '24 / 32' },
];

/** Лестница радиусов «мягкости»: контролы 8–10, поверхности 14, рамы 18.
 *  `px` — значения при `--ui-scale: 1`; на дефолтном 1,25 реальные радиусы
 *  крупнее ровно в 1,25 раза (rem-утилиты, hint на странице это поясняет). */
export const RADII: readonly {
  className: string;
  px: string;
  kind: 'control' | 'surface' | 'frame';
}[] = [
  { className: 'rounded-md', px: '8', kind: 'control' },
  { className: 'rounded-lg', px: '10', kind: 'control' },
  { className: 'rounded-xl', px: '14', kind: 'surface' },
  { className: 'rounded-2xl', px: '18', kind: 'frame' },
];

export type ButtonVariantId =
  'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';

export type ButtonStateId = 'default' | 'hover' | 'active' | 'focus' | 'disabled';

export const BUTTON_VARIANTS: readonly ButtonVariantId[] = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
];

export const BUTTON_STATES: readonly ButtonStateId[] = [
  'default',
  'hover',
  'active',
  'focus',
  'disabled',
];

/**
 * Зеркало cva `Button` (packages/ui/src/components/button.tsx:20-33): классы
 * принудительных состояний для СТАТИЧНОЙ галереи. При смене варианта в
 * примитиве — править здесь же (сами состояния живого примитива не
 * дублируются: в матрице соседствуют реальные кнопки, фокус/ховер работают).
 *
 * Важность — синтаксис Tailwind v4: `bg-…!` (в конце). Он же понимается
 * tailwind-merge: `cn()` выкидывает конфликтующий класс примитива, и нам не
 * приходится бороться с порядком утилит в CSS. Без этого «ховер» совпадал с
 * «обычным» (примитив несёт свой `bg-*` того же свойства).
 *
 * Тёмные ветки повторяют `dark:` примитива (`outline`: input/30 → input/50,
 * `ghost`: muted/50, `destructive`: /20 → /30, focus-ring /40) — иначе в
 * тёмной теме ховер/нажатие не отличить от базы (замечание ревью).
 *
 * ВАЖНО (находка, не этой задачи): в приложении `dark:`-утилиты СЕЙЧАС не
 * применяются — вариант объявлен как `@custom-variant dark (&:is(.dark *))`
 * (globals.css:11), а тема ставится атрибутом `data-theme='dark'` без класса
 * `.dark`; проверено в браузере: `dark:bg-destructive/20` на демо-элементе в
 * тёмной теме даёт тот же цвет, что без него. Поэтому в тёмной теме живые
 * кнопки рисуются светлыми правилами cva, и эти `dark:`-ветки — точное
 * зеркало исходника, которое «оживёт», когда вариант `dark` починят.
 */
export const BUTTON_STATE_CLASS: Record<
  ButtonVariantId,
  Partial<Record<Exclude<ButtonStateId, 'default' | 'disabled'>, string>>
> = {
  default: {
    hover: 'bg-primary-hover!',
    active: 'bg-primary-hover! translate-y-px',
    focus: 'border-ring! ring-1 ring-ring/30',
  },
  outline: {
    hover: 'bg-muted! text-foreground! dark:bg-input/50!',
    active: 'bg-muted! text-foreground! dark:bg-input/50! translate-y-px',
    focus: 'border-ring! ring-1 ring-ring/30',
  },
  secondary: {
    hover: 'bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]!',
    active: 'bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]! translate-y-px',
    focus: 'border-ring! ring-1 ring-ring/30',
  },
  ghost: {
    hover: 'bg-muted! text-foreground! dark:bg-muted/50!',
    active: 'bg-muted! text-foreground! dark:bg-muted/50! translate-y-px',
    focus: 'border-ring! ring-1 ring-ring/30',
  },
  destructive: {
    hover: 'bg-destructive/20! dark:bg-destructive/30!',
    active: 'bg-destructive/20! dark:bg-destructive/30! translate-y-px',
    focus: 'border-destructive/40! ring-destructive/20 dark:ring-destructive/40',
  },
  link: {
    hover: 'underline',
    active: 'underline',
    focus: 'border-ring! ring-1 ring-ring/30',
  },
};

/** Размеры кнопки — все ступени примитива (size в cva). */
export const BUTTON_SIZES: readonly { size: 'xs' | 'sm' | 'default' | 'lg' }[] = [
  { size: 'xs' },
  { size: 'sm' },
  { size: 'default' },
  { size: 'lg' },
];
