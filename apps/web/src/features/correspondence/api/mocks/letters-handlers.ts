import { lettersMutationHandlers } from './letters-mutation-handlers.js';
import { lettersQueryHandlers } from './letters-query-handlers.js';
import { lettersRelationHandlers } from './letters-relation-handlers.js';
import { lettersTransitionHandlers } from './letters-transition-handlers.js';

/** Моки домена `letters` (#55, §6.2/§7.6): мок-сервер корреспонденции v3 —
 *  письма на движке «Процессы», вкладки, регистрация с нумерацией,
 *  ручное создание, спам, правка, присоединение, журнал; связи «ответ на» /
 *  «вложено в» и дерево «ёлочки» (#461). Порядок важен (gotcha msw-query):
 *  чтение с буквальными путями (`/letters/resolvers`) идёт раньше
 *  параметрических `/letters/:id`. */
export const lettersHandlers = [
  ...lettersQueryHandlers,
  ...lettersMutationHandlers,
  ...lettersRelationHandlers,
  ...lettersTransitionHandlers,
];
