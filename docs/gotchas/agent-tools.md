# Инструменты агента (OpenCode)

- **OpenCode V2 не подхватывает кастомные tools V1 из `~/.config/opencode/tools/`**: discovery плагинов — только `plugins/` (глобально `~/.config/opencode/plugins/`) или поле `plugins` в конфиге; лоадер ждёт default-экспорт объекта `{ id, setup }`, а `@opencode-ai/plugin@1.x` не экспортирует `Plugin` рантаймом (`Export named 'Plugin' not found`) — плагин пишется как чистый объект `{ id, async setup(ctx) { await ctx.tool.transform(e => e.add({...})) } }` без импорта SDK; input — plain JSON Schema, execute возвращает `{ content: string }` (воспроизведено по логам сервера beta-19296: «Plugin must export a default definition with an id and an effect or setup function»; рабочий пример — `~/.config/opencode/plugins/image.ts`).

## Инструменты агента (ZCode)

- **`grep` в Git Bash ZCode — шим на ugrep 7.8.4, у которого `-q -v` отклоняется от POSIX**: exit-код определяется наличием совпадений с паттерном, а не наличием выбранных (инвертированных) строк — на смешанном вводе «исключения + код» связка `grep -qv` даёт ложный результат (локально `code=false`, на CI-раннере с GNU grep — `code=true`). Любая локальная проверка CI-фильтров/скриптов с `grep -v` — только с явным путём к GNU grep (`/c/Program Files/Git/usr/bin/grep.exe` в Windows-окружении) или прямым прогоном с выводом (без `-q`), не через составные `$()`-обёртки. Подтверждено воспроизведением 02.10.2026 (#198): таблица истинности ugrep vs GNU grep 3.0 снята на 13 сценариях.

## Субагенты и модель

- **Встроенный general-субагент наследует модель родителя — на топовой модели два критика плана стоят как две полные сессии** (Devin: `subagent_general` = модель родителя, `subagents.mdx`; Claude Code: `general-purpose` = модель сессии, docs «Create custom subagents»; opencode: `general` = модель родителя, docs «Agents»; Codex: custom-агент без `model` = модель родителя, docs «Subagents»; ZCode: роль без `model:` не фиксирует модель). Лечение: именованные роли с собственной дешёвой `model:` (`plan-critic-across`/`plan-critic-along`), задача — минимум; `general` не звать. Инцидент 02.11.2026: `feature-architect` Ф5 на дорогой модели вызвал general-субагентов и сжёг лимиты.

