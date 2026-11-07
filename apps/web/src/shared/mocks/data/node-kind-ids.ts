import { KOMPLEKT_KIND_ID } from './set-marks.js';

/** Стабильные id видов папок, нужные ДАННЫМ вне стора узлов (#632):
 *  формулы маршрутов адресуют ближайшую папку по `kindId`, а `workflows.ts`
 *  не может импортировать `project-nodes.ts` — тот тянет задачи и замыкает
 *  цикл (gotcha «циклы мок-данных»). Лист-модуль без зависимостей, кроме
 *  `set-marks` (тоже лист): `project-nodes` строит `nodeKindIds` из тех же
 *  значений — один источник истины. */
const kindId = (n: number): string => `44000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const nodeKindSeedIds = {
  /** «Здание по генплану» — вид папки-здания (4-й в справочнике). */
  building: kindId(4),
  /** «Комплект» — посев миграции Б (#556). */
  komplekt: KOMPLEKT_KIND_ID,
} as const;
