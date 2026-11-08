import { z } from 'zod';

/**
 * «Вести счёт отдельно для» счётчика (#630, модель v3 — вердикты владельца
 * 08.11): список УСЛОВИЙ (0–3), каждое — РЕАЛЬНАЯ запись, внутри которой
 * лежит нумеруемая (папка вида, проект, портфель, родительская задача,
 * значение поля, свой тип записи), а не абстрактный «разрез» или формула.
 * Пустой список — сквозная нумерация. Несколько условий сразу — как
 * разрезы 1С/Directum («внутри здания по марке»). Система находит значения
 * условий по месту записи в дереве — тем же путём, что формулы «ближайшая
 * папка вида…». Одна грамматика для сервера, веба и моков.
 */

/** Типы атрибутов, значение которых может быть условием счёта: одиночная
 *  ссылка на запись или вариант списка (id стабилен при переименовании). */
export const NUMBER_CONTAINER_FIELD_TYPES = [
  'enum',
  'user',
  'department',
  'project',
  'counterparty',
  'task',
  'letter',
  'node',
] as const;

/** Сколько условий «отдельно для» сразу: больше трёх аналоги не дают, а
 *  администратор уже не видит, где какой счёт. */
export const NUMBER_CONTAINERS_MAX = 3;

export const numberContainerSchema = z.discriminatedUnion('kind', [
  /** Каждая папка выбранного вида (Комплект, Здание…) — ближайшая СНАРУЖИ
   *  записи: у задачи — её папка или ближайшая выше; у папки — предки. */
  z.object({ kind: z.literal('folder'), nodeKindId: z.uuid() }).strict(),
  /** Каждая папка, в которой лежит запись (любого вида): у задачи — её
   *  папка, у папки — родительская; в корне проекта — сам проект. */
  z.object({ kind: z.literal('parent_folder') }).strict(),
  /** Каждый проект записи. */
  z.object({ kind: z.literal('project') }).strict(),
  /** Каждый тип проекта записи: все проекты одного типа — один счёт. */
  z.object({ kind: z.literal('project_type') }).strict(),
  /** Каждый портфель проекта записи. */
  z.object({ kind: z.literal('portfolio') }).strict(),
  /** Каждая родительская задача (подзадачи нумеруются внутри работы; у
   *  строки реестра #636 — задача, где строка создана). */
  z.object({ kind: z.literal('parent_task') }).strict(),
  /** Каждое значение поля записи (ссылка или вариант списка): адрес —
   *  внутренний номер атрибута, переименование ничего не ломает. */
  z.object({ kind: z.literal('field'), fieldNumber: z.number().int().min(1) }).strict(),
  /** Каждый тип самой записи: один атрибут у нескольких типов, но у
   *  каждого типа свой счёт («каждого реестра» #636, заявки по видам). */
  z.object({ kind: z.literal('record_type') }).strict(),
]);
export type NumberContainer = z.infer<typeof numberContainerSchema>;
export type NumberContainerKind = NumberContainer['kind'];

/** Ключ условия: 'folder:<id>', 'field:<n>', иначе вид. Одинаковые ключи в
 *  одном правиле запрещены; им же адресуются строки селекта окна. */
export function numberContainerKey(container: NumberContainer): string {
  if (container.kind === 'folder') return `folder:${container.nodeKindId}`;
  if (container.kind === 'field') return `field:${container.fieldNumber}`;
  return container.kind;
}

/** Записи, которые могут получать номер (сторона «Кто получает номер»).
 *  Строка реестра (#636) добавится сюда же. */
export const numberHostKindSchema = z.enum(['task', 'letter', 'node', 'project']);
export type NumberHostKind = z.infer<typeof numberHostKindSchema>;

/** У кого есть кнопки процесса (`processCategorySchema` — task|letter).
 *  Папкам и проектам номер выдаётся при создании (с #448/#634 — правилом). */
export function numberHostHasButtons(host: NumberHostKind): boolean {
  return host === 'task' || host === 'letter';
}

/** Может ли запись этого вида вообще лежать внутри такого условия. «Нет» —
 *  несовместимая привязка: окно её не даёт выбрать, сервер отклоняет 422
 *  `NUMBER_CONTAINER_UNREACHABLE`. Условие всегда СНАРУЖИ записи: проект
 *  сам себя не содержит, папка — сама себя. */
export function numberContainerReachable(
  container: NumberContainer,
  host: NumberHostKind,
): boolean {
  switch (container.kind) {
    case 'portfolio':
    case 'project_type':
    case 'field':
    case 'record_type':
      return true;
    case 'folder':
    case 'parent_folder':
      return host === 'task' || host === 'node';
    case 'project':
      return host !== 'project';
    case 'parent_task':
      return host === 'task';
  }
}

/** Все условия правила достижимы для записи этого вида. */
export function numberContainersReachable(
  containers: readonly NumberContainer[],
  host: NumberHostKind,
): boolean {
  return containers.every((container) => numberContainerReachable(container, host));
}

/** Место записи в дереве — всё, что нужно для поиска значений условий.
 *  Загружает вызывающий (сервер — порты модулей, моки — мок-мир). */
export interface NumberPlace {
  host: NumberHostKind;
  /** Свой тип записи: тип задачи/письма, вид папки, тип проекта. */
  typeId: string | null;
  /** Папки СНАРУЖИ записи от ближайшей вверх: у задачи — её папка и предки;
   *  у папки — только предки (без самой); у письма и проекта — пусто. */
  folders: readonly { id: string; kindId: string }[];
  /** Проект записи (у проекта-хоста — null: сам себя не содержит). */
  projectId: string | null;
  /** Портфель проекта записи (у проекта-хоста — его портфель). */
  portfolioId: string | null;
  /** Тип проекта записи (у проекта-хоста — его собственный тип). */
  projectTypeId: string | null;
  /** Родительская задача (только у задачи). */
  parentTaskId: string | null;
  /** Значение одиночного поля по внутреннему номеру атрибута (uuid ссылки
   *  или варианта); пусто/нет атрибута — null. */
  fieldValue: (fieldNumber: number) => string | null;
}

/** Что за запись стоит за значением условия — по нему сервер находит имя и
 *  путь для «Текущих счетов» (у «папки, где лежит» это папка ИЛИ проект). */
export const numberContainerEntitySchema = z.enum([
  'node',
  'project',
  'project_type',
  'portfolio',
  'task',
  'value',
  'type',
]);
export type NumberContainerEntity = z.infer<typeof numberContainerEntitySchema>;

/** Значение одного условия у конкретной записи (строка `container_refs`). */
export const numberContainerHitSchema = z
  .object({ entity: numberContainerEntitySchema, id: z.uuid() })
  .strict();
export type NumberContainerHit = z.infer<typeof numberContainerHitSchema>;

/** Почему номер не выдан: у записи нет нужного места. */
export const numberContainerMissingReasonSchema = z.enum([
  'unreachable',
  'no_folder',
  'no_project',
  'no_portfolio',
  'no_parent',
  'empty_field',
]);
export type NumberContainerMissingReason = z.infer<typeof numberContainerMissingReasonSchema>;

export type NumberContainerResolution =
  | { ok: true; hits: NumberContainerHit[] }
  | { ok: false; reason: NumberContainerMissingReason; index: number };

function resolveOne(
  container: NumberContainer,
  place: NumberPlace,
): NumberContainerHit | NumberContainerMissingReason {
  if (!numberContainerReachable(container, place.host)) return 'unreachable';
  switch (container.kind) {
    case 'folder': {
      const folder = place.folders.find((entry) => entry.kindId === container.nodeKindId);
      return folder ? { entity: 'node', id: folder.id } : 'no_folder';
    }
    case 'parent_folder': {
      const parent = place.folders[0];
      if (parent) return { entity: 'node', id: parent.id };
      return place.projectId ? { entity: 'project', id: place.projectId } : 'no_project';
    }
    case 'project':
      return place.projectId ? { entity: 'project', id: place.projectId } : 'no_project';
    case 'project_type':
      return place.projectTypeId
        ? { entity: 'project_type', id: place.projectTypeId }
        : 'no_project';
    case 'portfolio':
      if (place.host !== 'project' && !place.projectId) return 'no_project';
      return place.portfolioId ? { entity: 'portfolio', id: place.portfolioId } : 'no_portfolio';
    case 'parent_task':
      return place.parentTaskId ? { entity: 'task', id: place.parentTaskId } : 'no_parent';
    case 'field': {
      const value = place.fieldValue(container.fieldNumber);
      return value ? { entity: 'value', id: value } : 'empty_field';
    }
    case 'record_type':
      return place.typeId ? { entity: 'type', id: place.typeId } : 'unreachable';
  }
}

/** Значения ВСЕХ условий записи в порядке правила или причина первого
 *  отсутствующего (выдача отказывает 409 `NUMBER_CONTAINER_MISSING`, номер не
 *  тратится). Пустой список условий — сквозная нумерация, всегда успех. */
export function resolveNumberContainers(
  containers: readonly NumberContainer[],
  place: NumberPlace,
): NumberContainerResolution {
  const hits: NumberContainerHit[] = [];
  for (const [index, container] of containers.entries()) {
    const hit = resolveOne(container, place);
    if (typeof hit === 'string') return { ok: false, reason: hit, index };
    hits.push(hit);
  }
  return { ok: true, hits };
}
