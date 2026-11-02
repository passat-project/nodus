import { structureKindHandlers } from './structure-kind-handlers.js';
import { structureNodeHandlers } from './structure-node-handlers.js';

/** Моки структуры проекта (#467, #556). Регистрация в projects-handlers ДО
 *  projectReadHandlers: буквальный /projects/node-kinds иначе уйдёт в
 *  параметрический /projects/:id (gotcha порядка MSW). Виды — первыми:
 *  буквальные пути раньше параметрических. */
export const structureHandlers = [...structureKindHandlers, ...structureNodeHandlers];
