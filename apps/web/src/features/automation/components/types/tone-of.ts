import type { ProcessType } from '@nodus/contracts';

import { typeToneOf } from '../../../../shared/workflow/type-tone.js';

/** Тон плитки-значка типа задачи (токены темы, I15). Канон — shared:
 *  тот же тон рисуют списки «Процессов» и настройки связи (#665). */
export function toneOf(color: ProcessType['color']): string {
  return typeToneOf(color);
}

export { typeToneOf };
