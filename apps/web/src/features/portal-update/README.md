# Фича portal-update — web (#1038)

Детект обновления портала в открытой вкладке: сборка знает свою версию
(define `__PORTAL_VERSION__`, плагин `apps/web/vite-portal-version.ts`),
раздача публикует `version.json` в корне (dist-asset / dev-middleware /
nginx `location = /version.json`, no-cache). Хук в каркасе сверяет их и
поднимает флаг в сторе. Веб-индикация — плашка «Портал обновился» в
топбаре (#1038 фаза F, `app/shell/portal-update-plate.tsx`): только браузер
(в оболочке обновление применяет панель окна), зелёная точка + кнопка
«Обновить» → перезагрузка страницы; TEMP overlay-вариант для выбора
владельца — по URL `?updatePlate=overlay`. Системные браузерные пуша
(Notification API) не используются (решение владельца).

## Состав

- `model/portal-version.ts` — `PORTAL_VERSION`: версия ЭТОЙ сборки
  (env `VITE_PORTAL_VERSION` > максимум из whats-new/releases > '0.0.0').
- `model/compare-versions.ts` — semver-сравнение «major.minor.patch» без
  зависимостей (`-1/0/1`); нечисловые/отсутствующие части = 0, хвост и
  препинки игнорируются (выпуски строго X.Y.Z).
- `model/portal-update-store.ts` — zustand: `updateAvailable`,
  `latestVersion`, `check()` — `fetch('/version.json', no-store)`; ошибки
  молчат (dev без файла и сетевые сбои — норма, проверка повторится
  триггером), уже найденное обновление не переспрашивается.
- `model/use-portal-update.ts` — хук каркаса: триггеры сверки — фокус
  окна / вкладка стала видимой, интервал 45 мин, реконнект WS; в тестах
  (`MODE === 'test'`) хук инертен.

## Интеграционные точки (вне фичи)

`app/shell/app-shell.tsx` (монтаж хука), `app/shell/top-bar.tsx` +
`app/shell/portal-update-plate.tsx` (плашка в браузере), `app/shell/
reload-portal.ts` (точка перезагрузки для тестов), `shared/socket/
socket-reconnect.ts` (реестр реконнектов, вызывается из connect-хендлера
socket-client), `apps/web/vite-portal-version.ts` (источник версии +
генерация version.json), `infra/nginx/web.conf` (раздача `version.json`).

## Ограничения

- Препинки/билд-метки semver не сравниваются: выпуски портала строго X.Y.Z.
