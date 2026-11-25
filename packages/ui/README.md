# @nodus/ui — дизайн-система Nodus

Единственный источник UI-примитивов и тем для `apps/web` (I6: общее — только
`@nodus/contracts` и `@nodus/ui`).

## Состав

- `src/components/` — компоненты shadcn/ui (base: radix, style: nova), добавляются
  CLI: `pnpm dlx shadcn@latest add <name> --cwd packages/ui`.
- `src/lib/utils.ts` — `cn()`.
- `src/styles/globals.css` — Tailwind 4 + дизайн-токены (тема как данные, §10.3
  ux-principles). Импортируется приложением: `@nodus/ui/globals.css`.

## Темы

Всё визуальное — только семантическими токенами (`bg-primary`, `text-muted-foreground`,
`bg-success-soft`...); зашивать значения в компоненты запрещено (контролируется ревью
и линт-правилами shadcn-навыка). Вариант оформления = набор CSS-переменных:

- `:root` — «Тушь» (базовая: грифельный тёмно-зелёный фон, карточки из состаренной
  бумаги, акценты rust/ochre/tealink);
- `[data-theme='paper']` — «Бумага» (светлая: состаренная бумага фоном).

Фирменные утилиты: `paper-card` (бумажная карточка с карандашным бордюром),
`paper-surface` (бумажная панель с переопределением вложенных токенов текста/линий),
`texture-paper` (зерно бумаги); брендовые цвета `rust`, `ochre`, `tealink`, `sage`,
`steel`, `cream`, `paper`, `pencil`.

Переключение — атрибутом `data-theme` на `<html>` (хук `useTheme` появится с
персонализацией; для проверки концепта — переключатель в топбаре).

## Правила

- Новые примитивы — только через shadcn CLI (не рукописные копии).
- Компоненты фич живут в `apps/web/src/features/*/components`, здесь — только
  общие примитивы без доменной логики.
- Иконки — lucide-react; шрифт — Onest (self-hosted, `@fontsource-variable/onest`, I11).
- Tailwind — не ниже 4.3.4: в 4.3.4 исправлена генерация `group-*`/`peer-*`
  (`:is(:where(.group):has(A) &)` вместо `… *)`). На 4.3.3 `group-has-*` с
  субъектом `*` заставляет Chromium пересчитывать поддеревья групп на каждой
  вставке узла (gotcha `frontend.md`, «`:has()` на корне (и `group-has-*`)»).
  Версия общая для `apps/web`, `apps/desktop` и этого пакета — обновлять вместе.
