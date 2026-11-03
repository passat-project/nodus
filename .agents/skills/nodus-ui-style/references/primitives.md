# Примитивы «Инструмента»

Живут в `packages/ui/src/components/node-*.tsx` (движок) и `apps/web/src/shared/ui/` (составные). Сигнатуры — из реального кода; при смене сигнатуры — править этот файл в том же коммите (правило зеркала).

## Движок (`@nodus/ui/components/*`)

### NodeEdge — ортогональное ребро

```tsx
import { NodeEdge, orthPath, pathLength } from '@nodus/ui/components/node-edge';

<NodeEdge
  points={[{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }]}
  pulse="once"        // false | true | 'once'
  active              // foreground + drop-shadow(var(--glow))
  drawOn              // отрисовка от начала к концу при монтировании
  ports="end"         // 'both' | 'end' | 'none' — точки-порты на концах
  elbow={8}           // радиус локтей
  drawCapS={0.35}     // cap длительности рисовки (с) — сверхдлинные маршруты
  pulseCapS={0.9}     // cap длительности пробега пульса (с)
/>
```

- SVG `absolute inset-0` в позиционируемом контейнере, координаты — px контейнера, `overflow-visible`.
- `snapPx(v)` — привязка координаты прямой линии к полупикселю устройства (равномерная яркость hairline на любом зуме/DPR); применять к координатам прямых сегментов своих SVG-рёбер (контур, док-ребро).
- Скорости: пульс 400 px/s, рисовка 1200 px/s (длительность = длина/скорость — темп един на любых маршрутах); caps `drawCapS`/`pulseCapS` — верхняя граница длительностей на сверхдлинных маршрутах (вспышка треда на широкоформатном мониторе, circuit.md). `edgeDurations(len, caps)` — единственный источник формул длительностей: обёртки затухания считают из неё, скорости в вызывающем коде не дублируются.
- SMIL-пульс: `fill="freeze"` + opacity-гейт (иначе «светящийся пиксель» в (0,0) — см. circuit.md).
- `prefers-reduced-motion` — анимации выключены.
- Перемонтирование через `key` перезапускает одноразовые анимации.

### NodeLabel — моно-метка раздела

```tsx
<NodeLabel label="Стадия" count={4} chevron="down" className="truncate" />
```

UPPERCASE 11px, tracking 0.16em, muted; счётчик — `text-foreground tabular-nums`.

### NodeChip — моно-чип (ключ, статус, счётчик)

```tsx
<NodeChip tone="info">В работе</NodeChip>
// tones: muted | active | success | warning | danger | info
```

`active` — со свечением. Иконка внутри — `size-3`.

### NodeCard — панель с моно-шапкой

```tsx
<NodeCard label="Новости" count={3} actions={<Button />}>…</NodeCard>
```

### `node-panel` (CSS-утилита)

Плоская панель: `bg-card`, `border: 1px var(--border)`, **`radius-xl` 14px** (лестница мягкости — токены). Класс — `className="node-panel"`.

### Анимационные утилиты (globals.css)

- `node-edge-draw` — рисовка пути (нужен `pathLength={1}` на path).
- `dock-edge-fade` — растворение вспышек контура за 1 с (circuit-frame); док-ребро слайдера больше не использует.
- `slider-expand` / `slider-pop` / `content-fade` / `slider-shadow` — хореография слайдера (FLIP-переменные, scale-fade, налив контента, тень вместо затемняющего задника); см. circuit.md.

## Паттерны экранов (features/*)

### Чип стадии и шапка колонки канбана (`shared/ui/board/stage-tone.ts`)

Стадия имеет цвет (`StageColor`: neutral/info/success/warning/danger/violet/teal/orange/pink/cyan — ключи, не hex; I15). Тон → классы чипа/точки/тинта/свотча на токенах темы (`text-info`, `bg-info-soft/60`, `border-info/40`; новые тона — `tone-violet/teal/orange/pink/cyan` и их `-soft`). Шапка колонки — чип (точка-порт + моно-имя) + счётчик + меню «⋯» (появляется по ховеру); линии-подчёркивания у шапки колонки НЕТ. Тинт колонки — читаемая пастель тона стадии за карточками (`bg-*-soft/40`; neutral — `bg-foreground/[0.04]`, ступень поверхности вместо `bg-muted/40`: в тёмной теме `--muted` почти равен карточке; вердикт владельца 11.09.2026: цвет колонки должен быть понятен).

### Инспектор полей сущности (`shared/ui/entity-fields.tsx`, доменные defs — в фичах)

Общий каркас `EntityFields` (потребители: карточка задачи `features/tasks/components/task-fields.tsx`, письмо, паспорт проекта, карточка сотрудника — в фиче остаются только доменные `EntityFieldDef[]` + `storageKey`): чистые строки «иконка (lucide 3.5, muted) + моно-метка w-44 / значение» без табличных рамок, ховер-заливка строки; видимость — кнопка «+ Поле» с чекбоксами (persist localStorage). Сетка на **container queries** левой зоны карточки (`@container` на зоне): узко — 1 колонка, `@min-[880px]` — 2; зазор фикс (`gap-x-12`), блок `max-w-4xl mx-auto` — поля тянутся до предела, дальше растут боковые отступы и блок центрируется (модель ClickUp). Ресайзимые зоны перестраиваются только container queries, НЕ media вьюпорта.

### Панель-навигатор ветки (`features/tasks/components/task-branch-drawer.tsx`)

Левая ВТАЛКИВАЮЩАЯ колонка слайдера (не оверлей — контент и разделитель чата сдвигаются плавно: `transition-[width,min-width]` 0↔ширина на самой колонке flex-ряда карточки, во время drag перегородок transition снят — фризы, gotchas; панель монтируется раз и остаётся). Ширина ТЯНЕТСЯ перегородкой с памятью (#365, `features/tasks/lib/use-branch-width.ts`, `nodus-task-branch-w-v1`, общая на все карточки задач): минимум = дефолт 300, предел — половина ряда и минимум центра `MIN_TASK_MAIN_W` (бар действий, `lib/task-card-layout.ts`) при чате на полу; ширину отдаёт чат (канон буфера сужений), двойной клик — дефолт. Нехватка места (узкое окно) — порядок уступок весами flex-shrink `SHRINK_ORDER`: навигатор до минимума → чат до пола → навигатор ниже минимума; центр уже `MIN_TASK_MAIN_W` — только если не помещается и без навигатора (`rowMinWidths`): дерево от корневого предка любой вложенности (эндпоинт `/tasks/:id/branch`), строка = chevron + точка стадии в тоне + название + номер, текущая подсвечена; клик — ЗАМЕНА содержимого карточки (`useReplaceTopCard`, ADR-0009 доп.: стек не растёт, панель остаётся, «←» — шаг назад); «+» на строке — инлайн-создание дочерней; внизу — быстрое создание к текущей. Тоггл — иконка `Waypoints` (дуга-граф) в полосе цепочки слева.

## Составные (`apps/web/src/shared/ui/*`)

### PersonAvatar — графитовый аватар

```tsx
<PersonAvatar name={user.displayName} avatarUrl={user.avatarUrl} className="size-6" />
```

Детерминированный тон из графитовой палитры по имени (одинаковый в обеих темах); инициалы — 2 первые буквы слов.

### ProjectIdentityIcon — цветной маркер-идентичность проекта

```tsx
import { ProjectIdentityIcon } from '../ui/project-identity-icon.js';
import { identityTone, chartRowTone } from '../ui/identity-tone.js';

<ProjectIdentityIcon color={project.color} />            // плитка size-5 (size-6 в шапках)
<span className={identityTone[color].dot} />             // точка-маркер в ссылках/канбане
<div className={chartRowTone(rowIndex)} />               // тон ряда категориального графика
```

Цвет проекта — ключ `ProjectColor` (blue/green/amber/pink/sky/terra) из контрактов, тон — categorical-токены `--chart-*` своей темы: пастельная плитка с цветным глифом и hairline-бордюром того же тона. Цвет = идентификатор и данные, НЕ декор: в хром (кнопки, меню, контур) categorical-палитра не протекает.

### DeadlineChip — чип срока

```tsx
<DeadlineChip deadline={task.deadline} />
```

Просрочен → `bg-danger-soft text-danger` (+ `· Просрочена`); сегодня → warning; далее — нейтральный; `null` → «Без срока».

### SendHexIcon — фирменный глиф отправки (гексагон)

```tsx
<SendHexIcon className="size-4" />
```

Чистый ШЕСТИУГОЛЬНИК (pointy-top, без спиц и узлов — вердикт 24.09 раунд 5:
прежний знак со спицами читался «мини-графом»; «просто шестиугольник
покрупнее, красивый как отдельная кнопка»). Кнопку собирает композер
(`chat-composer.tsx`): ghost-кнопка БЕЗ заливки в семье смайл/мик, глиф size-5
цветом `text-info` — ЕДИНЫЙ токен акцента чат-действий (закреп, цитаты, бар
пересылки; вердикт 24.09: «нравится цвет цитат и закрепов»; смена оттенка =
одна строка темы), ВНУТРИ строки ввода островка, видна только при тексте/
вложениях/баре пересылки (пусто — микрофон-заглушка, модель Telegram), в
правке — галка size-5; габарит кнопки один с миком (size-8). Отдельной кнопки
отправки вне композера НЕТ.

### DomainChain — доменная цепочка сущности

```tsx
import { DomainChain, type ChainNode } from '../../../shared/ui/domain-chain.js';

const nodes: ChainNode[] = task.chain.map((node, i) => ({
  caption: 'Письмо',          // моно-метка типа (i18n)
  ref: 'Вх-2026/118',         // ключ узла
  label: 'Замечания по КЖ',   // содержание (truncate max-w-56); ОПЦИОНАЛЬНО:
                              // у само-узла (последнего) опускается — название
                              // сущности уже дано заголовком карточки (вердикт
                              // владельца: дубли названия запрещены)
  state: 'Согласовано',       // опц., text-success
  active: i === task.chain.length - 1,  // текущая сущность — светится
  onClick: node.entityId ? () => navigate(...) : undefined,  // кликабельные узлы
}));
<DomainChain nodes={nodes} />
```

Шапка карточки сущности: Письмо → Резолюция → Поручение → Задача (реф `03-domain-chain.png`); узлы-плашки, рёбра с портами по концам (CSS, центровка трансформами). Хлебных крошек в хроме слайдера НЕТ (убраны по вердикту владельца — только X закрытия).

### PersonCell — ячейка «человек» таблиц/реестров

```tsx
import { PersonCell, monoCell } from '../../../shared/ui/person-cell.js';
render: (task) => <PersonCell user={task.assignee} />,   // UserRef | string | null
```

Аватар + имя либо «Не задано» (i18n); `monoCell` — единый моно-стиль текстовых ячеек (даты, номера). Локальные копии запрещены (аудит #45 — было 5).

### DateTimePicker — датапикер срока (`shared/ui/date-time-picker.tsx`)

Компактный дедлайн-пикер (месяц-грид `date-time-grid.ts` — чистая логика с тестом, быстрые варианты «Сегодня/Завтра/Конец недели…», время HH:mm). Потребитель — экспресс-форма задачи; сброс состояния при открытии — рендер-тайм (канон, patterns.md).

### ProjectPicker — комбобокс проекта (`shared/ui/project-picker.tsx`)

Поиск по названию/коду с `ProjectIdentityIcon`, значение — projectId; потребитель — экспресс-форма задачи и фильтры. Сброс запроса при закрытии — рендер-тайм.

### AccessMatrix / ModuleAccessMatrix — матрица «право × роль» (`shared/access`)

```tsx
import { AccessMatrix, AccessMatrixSkeleton } from '../../../shared/access/access-matrix.js';
import { ModuleAccessMatrix } from '../../../shared/access/module-access-matrix.js';

<AccessMatrix
  label="Права ролей"                     // имя таблицы для скринридеров
  rowHeader="Право"                       // заголовок закреплённой колонки
  rows={[{ id: 'workflow.manage', label: 'Настраивать процессы и маршруты', description: '…' }]}
  columns={[{ id: role.id, name: role.name, title: role.description ?? undefined,
              lockedHint: 'Администратор всегда имеет все права' }]}   // lockedHint → замок
  cell={(rowId, columnId) => ({ granted, disabled, hint?, pending? })}
  onToggle={(rowId, columnId, next) => …}
  cellLabel={(row, column) => `${row.label} — ${column.name}`}
  describedBy="hint-id"                   // видимая подсказка «только просмотр»
/>

<AccessMatrixSkeleton rowHeader="Право" rows={rows} columns={4} />
<ModuleAccessMatrix module="automation" />   // тело вкладки раздела; у раздела без прав → null
```

Сетка в грамматике таблиц: фиксированные px-треки (`uiPx(360)` под право,
`uiPx(152)` на роль), `w-max min-w-full`, шапка `sticky top-0`, колонка прав
`sticky left-0` на `bg-card` (ховер строки тонирует её слоем-оверлеем),
прокрутка подводом к краю (`useBoardEdgeScroll` + `EdgeHints`, только по
ховеру). Ячейка — `Switch` по центру, `aria-label` «{право} — {роль}»,
недоступность — Tooltip на обёртке-span; для клавиатуры — видимые подсказки
шапки. Компонент общий: о ролях и правах не знает (#432 переиспользует).

### Панель редактора — `features/automation/components/editor/panel/panel-kit.tsx`

Одна грамматика правых панелей (статус, кнопка, окно создания, настройки
типа — #378 ред. 2, #432):

```tsx
<PanelField label="Название" hint="…">{control}</PanelField>      // подпись над контролом
<PanelNote title="Стандартная форма">…</PanelNote>                 // пояснение ступенью тона
<SwitchRow title="Обязательно при создании" hint="…" checked onChange />
<SectionLink title="Доступ" summary="Видят все · создают все" onClick={open} />  // «Название ›»
<ModeChoices value options={[{ value, label, hint }]} ariaLabel onChange />    // выбор строками
<PanelAction icon={Plus} onClick>Поле</PanelAction>                 // тихое действие (ghost)
<PanelDanger onClick>Убрать из формы</PanelDanger>                  // опасное — внизу
```

- Настройки не растут вниз «колбасой»: корень = поля элемента + строки
  `SectionLink` со сводкой; раздел открывается внутрь, шапка `SidePanel`
  получает стрелку «назад» (`onBack`, первый Esc — назад). Списки элементов
  (поля окна создания, кнопки статуса) — строки той же анатомии: подпись +
  сводка + шеврон; сводка есть всегда — высота строки не прыгает от режима.
- `ModeChoices` — два-три режима с длинными подписями (сегменты их обрезали,
  #380, #432); `Segmented` — только короткие подписи.
- `PanelAction` — ghost `size="sm"`, `-ml-2 self-start`, иконка 3.5: «+ Поле»,
  «Посмотреть окно», «+ Добавить переход». Outline-кнопок в панелях нет.
- `commit-field.tsx` — `CommitInput`/`CommitTextarea`: текст, который
  сохраняется сразу на сервер (настройки типа) или в историю документа
  (название поля формы), правится локально и уходит одним значением по
  blur/Enter; новое значение извне пересинхронизирует черновик в рендере.

## Switch — один размер (вердикт владельца 26.10.2026, #432)

`@nodus/ui/components/switch` — компактный трек 28×16, кружок 12, ход 12
(геометрия матрицы прав #379), размерного пропа НЕТ. В строке «подпись —
тумблер» трек центрируется по ПЕРВОЙ строке подписи обёрткой высотой в
line-height текста (`SwitchRow`, `SettingRow`: `h-[22px]`/`min-h-[22px]` для
text-sm), а не `items-start` по верхнему краю.

### NotesGlyph — маркер «Заметок» (`shared/ui/notes-glyph.tsx`)

Глиф сид-диалога с собой в списках бесед/полосе (модель Битрикс24: «Заметки» не дублируют профиль в списке, мок `cid(11)`).

## shadcn-компоненты в новом UI

`Sheet` — правая выдвижная панель поверх раздела (эталон — панель «Что нового», `features/whats-new/components/whats-new-panel.tsx`): геометрия парящего листа слайдеров через data-side-оверрайды (`inset-y-2 right-2 h-auto`, `rounded-2xl`, `shadow-(--slider-shadow)`) и `overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"` — затемняющего задника в каноне нет, оверлей остаётся прозрачным click-catcher'ом. Button (ghost для иконок хрома), Input, Textarea, Checkbox, DropdownMenu (+CheckboxItem для шестерёнки), Separator, Skeleton, Tooltip, Message/Bubble/Attachment (обсуждения), sonner. Все — на токенах темы; кастомные цвета не переопределять (навык `shadcn`). `Attachment` — две поверхности (`surface`): `raised` — карточка ступенью тона ВНЕ сообщения (карточка письма), `flat` — БЕЗ собственной заливки и паддингов НА поверхности сообщения (пузырь/пост, #144): иконка типа `FileTypeIcon` стоит прямо на тоне поверхности, ховер — ТОЛЬКО у кнопки скачивания (`hover:bg-current/10`), сам чип без ховера.

## Каноны компонентов из приёмок

- **OG-карточки (превью ссылок):** показываются только по факту готовности с контентом (ready + title/description/image) — никаких pending-скелетонов («нарисовалось и исчезло» запрещено); мета времени — строкой ПОД карточкой во всех хостах (вердикт пачки PR #251).
- **Попап реакций:** открывается наведением (hover-intent ~180 мс), клик — для клавиатуры; ховер по чипу реакции — тултип «кто поставил»; сетка раскрывается `grid-rows-[0fr]→[1fr]` без прыжка. Анимированные эмодзи — Noto Animated Emoji (CC BY 4.0), WebP из Lottie с равномерным ресемплингом fps; фича уровня пузыря проверяется в обоих хостах (пузырь + карточка поста канала).
- **Карточка уведомления:** узкая колонна фикс-ширины 360 дизайн-px по центру, высота по контенту до потолка 78vh (вердикт #100).
- **Поповер по наведению (hover-open):** обёртка `display:contents` над триггером + задержка намеренности ~250 мс (без неё вспыхивает на проводе мыши к соседним кнопкам); hover-режим гаснет по уходу курсора и с кнопки, и с панели (таймер ~150 мс на щель); клик пинит по-старому.
- **Подсказка эмодзи→стикер (Telegram-канон):** триггер — ровно один эмодзи целиком в конце текста; панель во всю ширину островка, выезд вверх, перекрывает ленту; высота 1→2 ряда + скролл; Enter = отправка сообщения (обход tdesktop#5927), Esc = dismiss до смены эмодзи; детект без зависимостей — Intl.Segmenter + Extended_Pictographic, нормализация VS16/скин-тонов.

## Антипримеры (запрещено)

- `<Badge variant="secondary" className="bg-info-soft text-info">` для статусов — вместо этого `NodeChip tone="info"`.
- Иконка-«самолётик» отправки — вместо этого глиф `SendHexIcon`; внешняя
  кнопка отправки рядом с полем — отправка живёт ВНУТРИ островка композера.
- Точки-порты «на глаз» абсолютными координатами — только из геометрии/трансформов.
- Свечение на неактивных элементах; пульсы по таймеру (только события фокуса/открытия).
