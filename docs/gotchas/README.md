# Ловушки (Gotchas) — каталог по областям

Каждая ловушка — одной строкой в файл своей области **в том же коммите, что и фикс**. Пишем механизм (почему ломается и как обойти), не симптом; подтверждение внешним источником (Exa / Context7 / официальные доки / воспроизведение) — в самой строке. Универсальные ловушки хоста, способные сломать любую задачу, дублируются в AGENTS.md — остальное живёт только здесь.

Читать: перед работой в соответствующей области — только её файл; при непонятной ошибке — свериться сначала здесь. Поиск по всему каталогу: `grep -r "<тема>" docs/gotchas/`.

| Файл | Область |
| --- | --- |
| [docker-infra.md](docker-infra.md) | Docker, compose, nginx, туннель, SILO/MinIO, ONLYOFFICE DS |
| [toolchain.md](toolchain.md) | Монорепо: pnpm, turbo, TypeScript, ESLint, CI-механика |
| [backend.md](backend.md) | NestJS, Fastify, Prisma, безопасность запросов |
| [realtime.md](realtime.md) | WS-gateway, Socket.IO, Redis Streams |
| [desktop.md](desktop.md) | Tauri-оболочка, WebView2, установщики |
| [frontend.md](frontend.md) | React 19, Radix, Tailwind 4, анимации, dnd, холсты, пиксельные каноны |
| [windows-host.md](windows-host.md) | Хост разработки Windows, Git Bash |
| [agent-tools.md](agent-tools.md) | Инструменты агента (Devin, OpenCode, ZCode) |
| [process-docs.md](process-docs.md) | Процесс, документация, GitHub |
| [msw-query.md](msw-query.md) | Моки MSW, TanStack Query, zustand |
| [sandbox.md](sandbox.md) | Изоляция песочницы, live-stack, пробы, e2e-креды |

**Правило роста:** файл области обязан читаться одним Read целиком; когда файл подходит к пределу — режь по подтеме на два файла и обнови эту таблицу. Файл-однострочка не создаётся: новая область появляется, когда набирается 3+ ловушек.
