# Субагенты планирования по рантаймам: дешёвая модель, свежий контекст

Проблема: встроенный general-субагент почти везде наследует модель родителя. На дорогой
модели планировщика два критика Ф5 стоят как две полные сессии топовой модели — инцидент
02.11.2026: навык вызвал `general`, лимиты сожжены. Запрет точечный — на `general`, не на
встроенных агентов вообще: `general`/`general-purpose` нельзя ни критикам, ни разведке.
Разведка (Ф1) — выделенный поисковый агент рантайма (`Explore`/`subagent_explore`): он
read-only и ходит на своей модели, назначенной настройками харнесса; цену не проверять,
роли для поиска не заводить. Критики (Ф5) — только проектные роли `plan-critic-*` с
собственной `model:` в шапке.

## Таблица

| Рантайм | Где роль | Как позвать | Модель | Ловушка |
|---|---|---|---|---|
| Devin | `.agents/agents/<role>.md`; глобально `%APPDATA%\devin\agents\` | `run_subagent` с `profile: <role>` | `model:` в шапке | `subagent_general` = модель родителя; `subagent_explore` = default subagent model; `agent.subagent_model` в config задаёт default для explore и custom без `model:`, но не для general |
| ZCode | `.zcode/agents/<role>.md` | `Agent` (алиас `Task`) с `subagent_type: <role>` | `model:` в шапке | роль без `model:` наследует модель primary; встроенный `general-purpose` — не для этого навыка; встроенный `Explore` — разведка Ф1, использовать как есть |
| Claude Code | `.claude/agents/<role>.md` | Agent с `subagent_type: <role>` | `model: haiku`/`sonnet`/`opus`/full id/`inherit` | встроенный `general-purpose` наследует модель сессии — не использовать; встроенный `Explore` — разведка Ф1 (модель сессии допустима: цена не критерий); свой `Explore` с `model: haiku` перекрывает встроенный, если хочется дешевле |
| opencode | `.opencode/agents/<role>.md` (`mode: subagent`) | Task/`@<role>` | `model: provider/model` | встроенный `general` и custom без `model:` наследуют модель родителя; `agent.general.model` в `opencode.json` настраивает built-in general |
| Codex | `.codex/agents/<role>.toml` | spawn по имени | `model = "..."` | custom без `model` наследует модель родителя; `[agents] default_subagent_model` задаёт default |

## Правила для навыка

1. В Devin/ZCode роли `plan-critic-across`, `plan-critic-along` лежат парой зеркал; тело
   синхронно, шапки разные. Модель меняет только владелец.
2. Задача — минимум (файл плана, issue, пакет). Промпт роли не пересказывать: это дорого
   и размывает независимость критика.
3. Роль критика (`plan-critic-*`) отсутствует в рантайме — не подменять `general`: STOP
   и сказать владельцу; по явному разрешению — завести роль по рецепту или выставить
   дешёвую модель в настройках рантайма (`agent.subagent_model` в Devin,
   `CLAUDE_CODE_SUBAGENT_MODEL` в Claude Code, `agents.default_subagent_model` в Codex,
   `agent.general.model` в opencode, Settings → Subagents в ZCode). Аналог для разведки
   Ф1: в рантайме нет поискового агента (`Explore`/`subagent_explore`) — спроси владельца,
   молча вести разведку самому на модели планировщика нельзя.
4. В Devin панель субагентов не показывает модель; ошибка выбора профиля видна по счёту
   и лимиту. Сомневаешься — спроси владельца до запуска.

## Источники

- Devin CLI: `subagents.mdx` в локальной документации навыка `devin-cli` (профили, `model:`, `subagent_general` = модель родителя).
- Claude Code: https://code.claude.com/docs/en/sub-agents (поле `model`, встроенные `general-purpose`/`Explore`).
- opencode: https://opencode.ai/docs/agents/ (поле `model`, built-in `general`).
- Codex: https://learn.chatgpt.com/docs/agent-configuration/subagents (TOML-агенты, `model`, `[agents]`).
- ZCode: локальный канон `.zcode/agents/*.md` (шапка `model:`, `thoughtLevel`, `tools`).
