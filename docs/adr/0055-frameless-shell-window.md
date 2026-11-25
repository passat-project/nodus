# ADR-0055. Безрамочное окно оболочки: кнопки окна через мост, snap-плагин и clipboard write-only

- **Статус:** Принят
- **Дата:** 2026-11-25
- **Контекст:** эпик #1038 «Браузерный верх оболочки» (фаза B1): системный заголовок окна не вмещает панель оболочки Nodus (навигация/«Приложение»/«Загрузки»/кнопки окна) и визуально чужероден порталу; нужен clipboard для «Скопировать путь» (#558) без ненадёжного `navigator.clipboard`.

## Контекст

Оболочка (ADR-0019) показывала окно с системными декорациями Windows: заголовок
с именем процесса и системные кнопки. Эпик #1038 вводит «браузерный верх» —
единую строку панели, которую рисует сама страница (мини-UI экрана подключения
сейчас, шапка портала — следующая фаза): слева кластер навигации, справа
«Приложение», «Загрузки» и кнопки окна. Для этого окно должно стать безрамочным,
но при этом нельзя потерять: Aero Snap и Win11 Snap Layouts (flyout при наведении
на «развернуть»), перетаскивание за заголовок, разворот двойным кликом,
изменение размера рамкой, поведение «закрытие = скрыть в трей».

Вторая потребность — буфер обмена: веб-фолбэк «Скопировать путь» (#558) в
WebView2 через `navigator.clipboard` ненадёжен (требует фокуса/жеста,
молча отказывает в фоновом окне; tauri#12007) — копирование должно стать
командой моста на Rust-стороне.

## Решение

### 1. Безрамочное окно + панель страницы

`main` создаётся с `.decorations(false)` и `.min_inner_size(640, 520)` — минимум
влезает в четверть зоны снапа на 1920-экранах. Строку панели рисует страница:
высота — контракт `SHELL_PANEL_HEIGHT = 40` px (packages/contracts,
`desktop-bridge.schema.ts`); px, не rem — строка панели не масштабируется
`--ui-scale` (урок ADR-0011). Пустое место строки: pointerdown левой →
`window_start_dragging`, двойной клик → `window_toggle_maximize`. Геометрию
между запусками по-прежнему ведёт `tauri-plugin-window-state` (ADR-0039):
DECORATIONS в состоянии нет, безрамочность безусловна.

### 2. Кнопки окна — команды моста

`bridge.rs`: `window_minimize` / `window_toggle_maximize` / `window_close` /
`window_start_dragging` / `window_is_maximized` (все — только окно `main`) и
`copy_text` (запись в буфер, ≤ 4096 СИМВОЛОВ — кириллица и эмодзи не режутся по
UTF-8-границе; чтения буфера в мосте нет). Закрытие идёт штатным
`CloseRequested` → обработчик скрывает окно в трей (поведение #254 не меняется).
Права: `allow-window-controls` и `allow-copy-text` (permissions/shell-bridge.toml)
выдаются runtime-capability портала и локальному shell-ui (панель мини-UI);
JS-методы `window.nodusDesktop.*` добавлены в init-script зеркально.

Clipboard — официальный `tauri-plugin-clipboard-manager` 2.5.0, вызов только
rust-side `write_text` из команды; JS-guest-bindings плагина не разрешены
никакой capability — веб-контент буфером управляет только через мост.
Поднимает эффективный MSRV оболочки до 1.95 (toolchain локальный и CI — stable).

### 3. Win11 Snap Layouts — `tauri-plugin-snap-layout` (Hyph-M) 1.0.9

Плагин создаёт невидимый Win32-child-HWND над DOM-элементом с фиксированным id
`portal-window-maximize` (кнопка максимизации панели; одно имя для мини-UI и
будущей панели портала), оверлей возвращает `HTMAXBUTTON` из `WM_NCHITTEST` —
нативный путь Windows 11 для flyout Snap Layouts; клик по оверлею сам делает
maximize/restore, hover прокидывается событиями `tauri-snap://snap/mouseenter` /
`mouseleave`. Скрипт инъекции плагина самонастраивается (JS-пакет не нужен);
права `snap-layout:default` — в shell-ui (локальные страницы). На Win10 плагин —
безопасный no-op: клик по кнопке обрабатывает собственный обработчик страницы
через `window_toggle_maximize` (двойной путь обязателен, OS-матрица 10/11).

Особенность жизненного цикла: при навигации «мини-UI → портал» нативный оверлей
не умирает сам (pagehide не коллапсирует HWND) — скрипт плагина на новой странице
гасит его `detach_snap_bounds` по первому DOM-изменению, поэтому runtime-capability
портала содержит ровно `snap-layout:allow-detach-snap-bounds` (без update —
позиционирование порталу даст фаза панели портала; без права над шапкой портала
осталась бы невидимая HTMAXBUTTON-зона от экрана подключения).

Hover кнопки максимизации: автоматика зеркалирования `:hover` плагина ловит
только правила вида `#id:hover` — Tailwind-классовое `hover:` не переносится,
поэтому панель подписывается на события hover плагина явно.

### 4. Панель на экране подключения + меню «Приложение»

`apps/desktop/src/shell/shell-panel.tsx`: строка 40 px — кластер серых
неактивных заглушек навигации (◀ ▶ ⟳ 🔗), справа «Приложение» (мини-окно:
версия `get_shell_info`, состояние обновления `get_update_state`; available →
«Скачать и установить» через `run_updater`), «Загрузки» (заглушка), кнопки окна.
Строки — i18n `ui.desktop` (I15), глиф максимизации отражает состояние
(`window_is_maximized` + resize-Listener — состояние меняется и нативно).

## Альтернативы

| Альтернатива | Почему отклонена | Когда пересмотреть |
|---|---|---|
| `tauri-plugin-decorum` v1.1.x (`create_overlay_titlebar`) | Плагин сам инжектит СВОИ кнопки (decorum-tb-*) в контейнер — страница не рисует строку панели целиком; требует `withGlobalTauri: true`; snap — таймер 620 мс + команда, не нативный HTMAXBUTTON | Если snap-layout перестанет сопровождаться и decorum даст режим «только оверлей без своих кнопок» |
| Свои ~380 строк Win32 (HTMAXBUTTON-оверлей вручную) | Полное дублирование того, что плагин уже делает: subclass-процедура, DPI-масштабирование координат, TrackMouseEvent, SC_MAXIMIZE/SC_RESTORE, Win10-детект; своя Win32-лопата = свой багаж сопровождения | Если потребуется поведение, недостижимое API плагина |
| Нативный заголовок (как было) | Не вмещает панель оболочки — суть эпика #1038 | — |
| `data-tauri-drag-region` + core window permissions вместо своих команд | Открывает веб-контенту прямые core:window права в обход моста (нарушает модель ADR-0019 «мост = единственная дверь»); drag-region не даёт двойной клик/maximize-состояние | — |
| `navigator.clipboard` в WebView2 | Ненадёжен: требует жеста/фокуса, в фоне молча отказывает (tauri#12007); чтение и вовсе лишнее | — |
| Открыть плагину clipboard JS-API (guest bindings) | Мост уже валидирует длину и пишет стабильные коды ошибок; прямые binding'ы обошли бы границу контракта | — |

## Последствия

- Новые зависимости оболочки: `tauri-plugin-snap-layout` 1 (v1.0.9, MIT),
  `tauri-plugin-clipboard-manager` 2 (v2.5.0) — строки в `tech-stack.md` добавляет
  интегратор эпика (фаза B1 работает в apps/desktop и docs/adr).
- Плагин молодой (v1.0.9, 2026-06): риск остановки сопровождения. Фолбэк уже
  встроен — все действия окна работают командами моста без плагина; потеря
  ограничится flyout Snap Layouts (Aero Snap, Win+стрелки и перетаскивание
  работают у безрамочного tao-окна нативно). Замена — decorum или свой оверлей
  по ADR-таблице выше.
- DOM-id `portal-window-maximize` и `SHELL_PANEL_HEIGHT` — контракт между
  страницей и оболочкой: следующая фаза (панель портала в apps/web) обязана
  использовать те же значения; панель мини-UI исчезает после навигации на портал,
  панель портала принимает эстафету (оверлей перецепляется по тому же id).
- На Win11 клик по кнопке максимизации обрабатывает нативный оверлей (наш
  onClick не срабатывает — это норма); на Win10 — обработчик страницы.
- `copy_text` пишет в буфер ≤ 4096 символов; отказ — стабильные коды
  (`text_too_long`, `clipboard_unavailable`) в формате ошибок моста.
- Панель мини-UI нейтральна и не претендует на финальный визуал портала —
  приёмка вида у владельца живым взглядом (канон валидации UI).

## Обоснование (research)

- `tauri-plugin-snap-layout`: crates.io (v1.0.9, MSRV 1.70, MIT), GitHub
  Hyph-M/tauri-plugin-snap-layout — README (button_id/permissions/жизненный цикл,
  Win10 no-op), исходники `src/lib_win_impl.rs`, `src/snap.rs` (HTMAXBUTTON,
  SC_MAXIMIZE/SC_RESTORE, child-HWND через SetProp — механика «оверлей живёт
  после pagehide»), `dist-js/inline-injection.js` (MutationObserver →
  unbindTarget(true) → detach_snap_bounds; automateHoverCSS зеркалит только
  `#id:hover`), `permissions/default.toml` (allow-update/detach-snap-bounds).
- `tauri-plugin-decorum`: GitHub clearlysid/tauri-plugin-decorum, docs.rs v1.1.1 —
  create_overlay_titlebar инжектит собственные кнопки, README требует
  `withGlobalTauri: true` и core:window права.
- `tauri-plugin-clipboard-manager`: docs.rs 2.5.0 (`ClipboardExt::write_text`,
  rust-side), README (MSRV ≥ 1.90, v2-ветка), crates.io (MSRV 1.95, stable 2.5.0).
- `navigator.clipboard` в WebView2: tauri issue #12007 (Clipboard API ненадёжен
  в Tauri/WebView2 — рекомендация плагина).
