import { inferIntent, inferSubject, sameFamily } from './retrieval-infer.js';
import { INTENT_TERMS } from './retrieval-lexicon.js';
import { ROUTER_SIM_MIN_SCORE, rankTools, structurallyWrong } from './retrieval-rank.js';
import type { AssistantToolDefinition, ToolIntent } from './tool-definition.js';
import {
  isWriteIntent,
  keyRu,
  matchesIntentPrefix,
  normalizeQuery,
  understandQuery,
  words,
  type QueryUnderstanding,
} from './retrieval-lang.js';

/**
 * Симулятор диспетчера и проверка возможности операции (#926): приоритет
 * объекта запроса, «есть ли в каталоге операция под просьбу» и детерминированный
 * top-7 выше порога. Оценка инструментов — в `retrieval-rank.ts`.
 */

/**
 * Есть ли в каталоге операция под запрошенное действие (#926, «право не
 * знать»). Если сотрудник просит создать проект, а `projects.create` ещё нет,
 * диспетчер не должен «натягивать» `projects.add_node`: это другая операция.
 * Проверка выводится из каталога, а не из списка дыр: появился инструмент —
 * отказ исчез сам.
 */
export function hasCapability(
  catalog: readonly AssistantToolDefinition[],
  query: QueryUnderstanding,
): boolean {
  const writeIntents = [...query.intents].filter(isWriteIntent);
  if (writeIntents.length === 0) return true;
  const actions = actionTokensOf(query);
  // «Создай проект» требует объект «проект», иначе create-папка «натянется» на
  // создание проекта. Для глаголов без названного объекта («добавь Петрова в
  // беседу») объект задаёт сам инструмент — проверяем действие и модуль.
  const created = query.createdObject;
  // «Сделай письмо в Стройпроект» — просьба СОЗДАТЬ письмо; наличие правки
  // реквизитов не делает операцию доступной. Если объект создания назван,
  // проверяем именно create, а не любой записанный глагол.
  const intentsToCheck =
    created && writeIntents.includes('create') ? ['create' as ToolIntent] : writeIntents;
  return intentsToCheck.some((intent) => {
    if (intent === 'send') {
      // Почта портала не отправляется ассистентом; чат — отправляется.
      if (query.modules.has('letters')) return false;
      return catalog.some(
        (tool) => (tool.intent ?? inferIntent(tool)) === 'send' && actionSupported(tool, actions),
      );
    }
    return catalog.some((tool) => {
      if ((tool.intent ?? inferIntent(tool)) !== intent) return false;
      if (!actionSupported(tool, actions)) return false;
      if (created) {
        // Для «создай письмо» годится только инструмент, чей ГЛАВНЫЙ объект —
        // письмо: смежные объекты («участник письма») создают не письмо.
        const primary = tool.subject ?? inferSubject(tool);
        if (!sameFamily(created, primary)) return false;
      }
      if (
        query.modules.size > 0 &&
        tool.module !== 'system' &&
        !query.modules.has(tool.module) &&
        // «Вложения письма» живут в files, «чат задачи» — в chat: модуль
        // инструмента может быть смежным, отказ по нему не делаем.
        !(query.modules.has('files') && tool.module === 'letters') &&
        !(query.modules.has('tasks') && tool.module === 'chat')
      ) {
        return false;
      }
      return true;
    });
  });
}

/** Слова запроса, которые являются глаголом запрошенного действия. */
function actionTokensOf(query: QueryUnderstanding): string[] {
  const prefixes = INTENT_TERMS.filter(
    (group) => isWriteIntent(group.intent) && query.intents.has(group.intent),
  ).flatMap((group) => group.prefixes);
  return query.tokens.filter((token) =>
    prefixes.some((prefix) => matchesIntentPrefix(token, prefix)),
  );
}

/**
 * Глагол действия должен быть в описании инструмента: «архивируй» не
 * поддержано, даже если «изменить проект» есть. Иначе каталог обещает то,
 * чего операция не умеет.
 */
function actionSupported(tool: AssistantToolDefinition, actions: readonly string[]): boolean {
  if (actions.length === 0) return true;
  const fields = new Set(
    [tool.title, tool.why ?? '', tool.whenToUse ?? '', tool.description, ...(tool.keywords ?? [])]
      .flatMap((text) => words(normalizeQuery(text)))
      .map(keyRu),
  );
  return actions.some((token) => fields.has(keyRu(token)));
}

/** Детерминированный симулятор диспетчера: top-7 выше порога. */
export function simulateRouter(
  catalog: readonly AssistantToolDefinition[],
  query: string,
  limit = 7,
): AssistantToolDefinition[] {
  const understanding = understandQuery(query);
  if (!hasCapability(catalog, understanding)) return [];
  return rankTools(catalog, understanding)
    .filter((entry) => !structurallyWrong(entry.tool, understanding))
    .filter((entry) => entry.score >= ROUTER_SIM_MIN_SCORE)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.tool);
}
